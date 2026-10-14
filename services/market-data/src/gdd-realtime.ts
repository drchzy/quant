import WebSocket from 'ws';
import { gddMarketCode, getGddServerAddress, invalidateGddGateway } from './gdd.js';

/**
 * 一个进程共用一条上游WS连接，订阅/取消/重连不会把GDD账号或动态网关暴露给MCP调用方。
 * 只保存受限内存缓存，不把未经校准的实时数据直接覆盖DuckDB日K。
 */
type QuoteType = 1 | 2 | 4;
type PushType = 250 | 251 | 252;

type Subscription = { market: number; code: string; type: QuoteType; language: 0 };
export type LiveEntry = { market: number; code: string; type: PushType; payload: unknown; receivedAt: string };

const KEY = (code:string,type:QuoteType) => code + ':' + type;
const MAX_SUBSCRIPTIONS=30;
const RECONNECT_BASE_MS=1500;
const MAX_RECONNECT_MS=30000;
const CACHE_TTL_MS=300000;
const MAX_INCOMING_BYTES=1024*1024;

export function parseGddWsMessage(raw: string): { reqtype:number; rows: Array<{ code:string; market:number; type:PushType; payload:unknown }> } {
  if (Buffer.byteLength(raw,'utf8')>MAX_INCOMING_BYTES) throw Error('WS 消息过大');
  const obj=JSON.parse(raw) as any;
  const reqtype=Number(obj.reqtype);
  if (![250,251,252].includes(reqtype)) return {reqtype,rows:[]};
  // QUOTE(250) -> symbol[]; TICK(251)->tick[]。
  // BROKER(252) 数据模型尚未从实测校验，不能绑定具体股票，避免误归属。
  const values = reqtype===250 ? obj.data?.symbol : reqtype===251 ? obj.data?.tick : null;
  if (!Array.isArray(values)) return {reqtype,rows:[]};
  const rows: Array<{code:string;market:number;type:PushType;payload:unknown}>=[];
  for(const item of values.slice(0,200)){
    if(!item || typeof item!=='object')continue;
    const code=String(item.code??item.Code??'');
    const market=Number(item.market??item.marketId??item.Market??-1);
    if(!/^\d{6}$/.test(code) || !Number.isFinite(market))continue;
    rows.push({code,market,type:reqtype as PushType,payload:item});
  }
  return {reqtype,rows};
}

export class GddRealtimeFeed {
  private ws: WebSocket | undefined;
  private connecting: Promise<void> | undefined;
  private subscriptions=new Map<string,Subscription>();
  private latest=new Map<string,LiveEntry>();
  private recent:LiveEntry[]=[];
  private reconnectTimer:ReturnType<typeof setTimeout>|undefined;
  private heartbeat:ReturnType<typeof setInterval>|undefined;
  private backoff=RECONNECT_BASE_MS;
  private stopped=false;
  private serial=1;
  private lastError:string|null=null;
  private lastConnected:string|null=null;
  private lastMessage:string|null=null;
  private lastReqtype:number|null=null;
  private lastPushCounts:Record<number,number>={};
  private droppedRows=0;
  private alive=true;
  constructor(private resolver:()=>Promise<string>=()=>getGddServerAddress(36)) {}

  private envelope(reqtype:200|201|202,data:Subscription[]) {
    return JSON.stringify({reqtype,reqid:this.serial++,session:'',data});
  }
  private send(reqtype:200|201|202,data:Subscription[]) {
    if(!this.ws||this.ws.readyState!==WebSocket.OPEN)return;
    this.ws.send(this.envelope(reqtype,data));
  }
  private armHeartbeat(ws:WebSocket) {
    this.clearHeartbeat();
    this.alive=true;
    ws.on('pong',()=>{this.alive=true;});
    this.heartbeat=setInterval(()=>{
      if(ws.readyState!==WebSocket.OPEN)return;
      if(!this.alive){ws.terminate();return;}
      this.alive=false;
      ws.ping();
    },20000);
    this.heartbeat.unref?.();
  }
  private clearHeartbeat() {
    if(this.heartbeat)clearInterval(this.heartbeat);
    this.heartbeat=undefined;
  }
  private laterReconnect() {
    if(this.stopped||this.reconnectTimer||this.subscriptions.size===0)return;
    invalidateGddGateway();
    const delay=this.backoff;
    this.backoff=Math.min(MAX_RECONNECT_MS, this.backoff*2);
    this.reconnectTimer=setTimeout(()=>{
      this.reconnectTimer=undefined;
      void this.ensureConnection().catch((error)=>{
        this.lastError=error instanceof Error?error.message:'WS 重连失败';
        this.laterReconnect();
      });
    },delay);
    this.reconnectTimer.unref?.();
  }
  private consume(raw: string) {
    let event: ReturnType<typeof parseGddWsMessage>;
    try { event=parseGddWsMessage(raw); } catch { this.droppedRows++; return; }
    this.lastMessage=new Date().toISOString();
    this.lastReqtype=event.reqtype;
    this.lastPushCounts[event.reqtype]=(this.lastPushCounts[event.reqtype] || 0) + 1;
    if([250,251,252].includes(event.reqtype) && !event.rows.length) this.droppedRows++;
    for(const row of event.rows){
      // type=4 是盘口/Level-2订阅；它可能收到 250快照或252经纪队列。
      // type=4 的250也入库，避免“明明订阅了盘口却被当成type=1丢弃”。
      const relevant:QuoteType[] = event.reqtype===250?[1,4]:event.reqtype===251?[2]:[4];
      for(const type of relevant){
        if(!this.subscriptions.has(KEY(row.code,type)))continue;
        const entry:LiveEntry={...row,receivedAt:this.lastMessage};
        this.latest.set(KEY(row.code,type),entry);
      }
      if(this.subscriptions.has(KEY(row.code,event.reqtype===251?2:1)) ||
         this.subscriptions.has(KEY(row.code,4))) {
        this.recent.push({ ...row,receivedAt:this.lastMessage });
      }
    }
    if(this.recent.length>100)this.recent.splice(0,this.recent.length-100);
  }

  async ensureConnection():Promise<void> {
    if(this.stopped)throw Error('GDD WebSocket已停止');
    if(this.ws?.readyState===WebSocket.OPEN)return;
    if(this.connecting)return this.connecting;
    this.connecting=(async()=>{
      const address=await this.resolver();
      const origin=new URL(address);
      if(origin.protocol!=='http:'&&origin.protocol!=='https:')throw Error('非法上游网关协议');
      origin.protocol=origin.protocol==='https:'?'wss:':'ws:';
      origin.pathname='/';
      origin.search='';
      // ws默认不会携带任何敏感GDD session。
      const ws=new WebSocket(origin.toString(),{handshakeTimeout:10000,maxPayload:MAX_INCOMING_BYTES});
      this.ws=ws;
      await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>{ws.terminate();reject(new Error('GDD WS连接超时'));},12000);
        const onError=(error:Error)=>{clearTimeout(timeout);reject(error);};
        ws.once('error',onError);
        ws.once('open',()=>{
          clearTimeout(timeout);
          ws.off('error',onError);
          resolve();
        });
      });
      this.backoff=RECONNECT_BASE_MS;
      this.lastError=null;
      this.lastConnected=new Date().toISOString();
      this.armHeartbeat(ws);
      ws.on('message',(data,isBinary)=>{
        if(isBinary)return;
        if(Buffer.isBuffer(data) && data.length>MAX_INCOMING_BYTES)return;
        this.consume(data.toString());
      });
      ws.on('error',(e)=>{this.lastError=e.message.slice(0,140);});
      ws.on('close',()=>{
        if(this.ws!==ws)return; // 旧socket的close不能影响重连后的新socket
        this.ws=undefined;
        this.clearHeartbeat();
        this.laterReconnect();
      });
      // 重连后发送同步(202)，用完整订阅清单恢复实时流。
      if(this.subscriptions.size)this.send(202,[...this.subscriptions.values()]);
    })().catch((err)=>{
      this.lastError=err instanceof Error?err.message:'WS连接失败';
      this.ws?.terminate();
      this.ws=undefined;
      this.laterReconnect();
      throw err;
    }).finally(()=>{this.connecting=undefined;});
    return this.connecting;
  }

  async subscribe(code:string,type:QuoteType=1) {
    const market=gddMarketCode(code);
    if(![1,2,4].includes(type))throw Error('不支持的GDD订阅类型');
    const key=KEY(code,type);
    const existing=this.subscriptions.has(key);
    if(!existing && this.subscriptions.size>=MAX_SUBSCRIPTIONS)throw Error('GDD最多支持30项订阅');
    const sub:Subscription={market,code,type,language:0};
    const previouslyOpen=this.ws?.readyState===WebSocket.OPEN;
    this.subscriptions.set(key,sub);
    try {
      await this.ensureConnection();
      // 只有已建立的WS连接使用200追加。新连接内会用202一次性同步全部订阅。
      if(!existing && previouslyOpen)this.send(200,[sub]);
    } catch(error) {
      if(!existing)this.subscriptions.delete(key);
      if(!this.subscriptions.size)this.stopConnection();
      throw error;
    }
    return this.read(code,type);
  }
  unsubscribe(code:string,type:QuoteType=1) {
    const key=KEY(code,type);
    const sub=this.subscriptions.get(key);
    if(sub){
      this.subscriptions.delete(key);
      this.send(201,[sub]);
      this.latest.delete(key);
      if(!this.subscriptions.size)this.stopConnection();
    }
    return {code,type,removed:!!sub,subscriptions:this.subscriptions.size};
  }
  read(code:string,type:QuoteType=1) {
    const item=this.latest.get(KEY(code,type));
    const age=item?Date.now()-Date.parse(item.receivedAt):null;
    return {
      code,type,subscribed:this.subscriptions.has(KEY(code,type)),
      connected:this.ws?.readyState===WebSocket.OPEN,
      latest:age!==null&&age<CACHE_TTL_MS?item:null,
      stale:age!==null&&age>=CACHE_TTL_MS,
      ageMs:age,
      lastError:this.lastError
    };
  }
  events(limit=20) {
    const max=Math.min(Math.max(Math.floor(limit),1),100);
    return this.recent.slice(-max).reverse();
  }
  status() {
    return {
      connected:this.ws?.readyState===WebSocket.OPEN,
      connecting:!!this.connecting, subscriptions:[...this.subscriptions.values()],
      lastConnected:this.lastConnected,lastMessage:this.lastMessage,
      lastError:this.lastError, cacheEntries:this.latest.size,
      lastReqtype:this.lastReqtype, pushCounts:{...this.lastPushCounts},
      droppedRows:this.droppedRows
    };
  }
  private stopConnection(){
    if(this.reconnectTimer)clearTimeout(this.reconnectTimer);
    this.reconnectTimer=undefined;
    this.ws?.close();
    this.ws=undefined;
    this.clearHeartbeat();
  }
  close() {
    this.stopped=true;
    this.subscriptions.clear();
    this.stopConnection();
  }
}

export const gddRealtime=new GddRealtimeFeed();
