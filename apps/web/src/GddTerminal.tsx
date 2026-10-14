import {useEffect,useRef,useState} from 'react';
import * as echarts from 'echarts';
import {apiGet,apiPost} from './api';
import {GddIntradayChart} from './GddIntradayChart';

type Bar={date:string;open:number;close:number;low:number;high:number;volume:number};
type Trend={datetime:string;time:string;price:number;avgPrice:number;volume:number};
type Depth={level:number;price:number|null;volume:number|null};
type Profile={code:string;name:string|null;previousClose:number|null;open:number|null;high:number|null;low:number|null;
  close:number|null;asOf:string|null;sessionDay:string;priceSource:string;historyError:string|null};
type Live={
  code:string;connected:boolean;
  quote:{subscribed:boolean;latest:{receivedAt:string;payload:Record<string,unknown>}|null;stale:boolean;lastError:string|null};
  lastPrice:number|null;previousClose:number|null;open:number|null;high:number|null;low:number|null;
  volume:number|null;amount:number|null;riseRate:number|null;
  depth:{levelCount:number;l2Available:boolean;bids:Depth[];asks:Depth[];
    bookSubscribed:boolean;bookReceived:boolean;lastReceivedAt:string|null;source:string};
  diagnostics?:{connected:boolean;subscribedTypes:number[];lastMessage:string|null;lastReqtype:number|null;
    pushCounts:Record<string,number>;droppedRows:number;lastError:string|null;
    quoteFields:string[];bookFields:string[]};
  deals:Array<Record<string,unknown>>
};
type Mode='trend'|'10'|'11'|'20'|'2'|'5'|'6'|'3';
const periods:Array<[Mode,string]>=[['trend','分时'],['10','日K'],['11','周K'],['20','月K'],['2','5分'],['5','15分'],['6','30分'],['3','60分']];
const today=()=>new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
const fmt=(v:unknown,n=2)=>v===null||v===undefined||v===''?'—':Number.isFinite(Number(v))?Number(v).toFixed(n):'—';
const qty=(v:unknown)=>v===null||v===undefined?'—':Number.isFinite(Number(v))?
  Math.abs(Number(v))>=1e8?(Number(v)/1e8).toFixed(2)+'亿':
  Math.abs(Number(v))>=1e4?(Number(v)/1e4).toFixed(2)+'万':Number(v).toFixed(0):'—';
const errText=(e:unknown)=>{const s=e instanceof Error?e.message:String(e);try{return JSON.parse(s).error||s;}catch{return s;}};
const delta=(p:number|null,prev:number|null)=>p===null||prev===null?'':p>prev?'q-up':p<prev?'q-down':'';

function MarketGraph({mode,items,candle,livePrice,showMarker}:{mode:Mode;items:Array<Bar|Trend>;candle:boolean;livePrice:number|null;showMarker:boolean}){
 const el=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!el.current)return;
  const graph=echarts.init(el.current,undefined,{renderer:'canvas'});
  const isTrend=mode==='trend';
  const xs=items.map(r=>isTrend?String((r as Trend).time):String((r as Bar).date).replace('T',' ').slice(0,16));
  const ys=items.map(r=>Number(isTrend?(r as Trend).price:(r as Bar).close));
  const vol=items.map(r=>Number(r.volume||0));
  const values=ys.filter(Number.isFinite);
  const lo=values.length?Math.min(...values):0,hi=values.length?Math.max(...values):0;
  const pad=Math.max((hi-lo)*.16,(hi||1)*.003);
  const series:any[]=[];
  if(!isTrend&&candle)series.push({name:'K线',type:'candlestick',xAxisIndex:0,yAxisIndex:0,
    data:items.map(r=>{const b=r as Bar;return [b.open,b.close,b.low,b.high];}),
    itemStyle:{color:'#ed5966',color0:'#16ae91',borderColor:'#ed5966',borderColor0:'#16ae91'}});
  else series.push({name:isTrend?'分时':'收盘价',type:'line',xAxisIndex:0,yAxisIndex:0,showSymbol:false,
    data:ys,lineStyle:{width:2,color:'#58b9ff'},itemStyle:{color:'#58b9ff'},
    areaStyle:isTrend?{color:'#174b7d33'}:undefined,
    markLine:showMarker&&livePrice!==null?{silent:true,symbol:'none',data:[{yAxis:livePrice,
      lineStyle:{color:'#e4bd64',type:'dashed'},label:{formatter:'WS {c}',color:'#e4bd64'}}]}:undefined});
  if(isTrend)series.push({name:'均价',type:'line',xAxisIndex:0,yAxisIndex:0,
    data:items.map(r=>Number((r as Trend).avgPrice)),showSymbol:false,
    lineStyle:{color:'#d8b968',type:'dashed',width:1}});
  else{
    for(const [i,days] of [5,10,20].entries()){
      const ma=ys.map((_,j)=>j<days-1?null:ys.slice(j-days+1,j+1).reduce((a,b)=>a+b,0)/days);
      series.push({name:'MA'+days,type:'line',data:ma,xAxisIndex:0,yAxisIndex:0,showSymbol:false,
        lineStyle:{width:1,color:['#d8b968','#c697d9','#72cfba'][i]}});
    }
  }
  series.push({name:'成交量',type:'bar',xAxisIndex:1,yAxisIndex:1,data:vol,
    itemStyle:{color:'#477c9c'}});
  graph.setOption({
    animation:false,backgroundColor:'transparent',
    legend:{top:0,left:8,itemWidth:14,itemHeight:3,textStyle:{color:'#93a8c0'}},
    tooltip:{trigger:'axis',axisPointer:{type:'cross'},backgroundColor:'#102238',
      borderColor:'#39536d',textStyle:{color:'#e9f2fa'},confine:true},
    grid:[{left:44,right:65,top:36,height:'60%'},{left:44,right:65,top:'78%',height:'15%'}],
    xAxis:[
      {type:'category',data:xs,boundaryGap:!isTrend,axisLabel:{show:false},axisLine:{lineStyle:{color:'#3c4e65'}},
        splitLine:{show:true,lineStyle:{color:'#26364a'}}},
      {type:'category',gridIndex:1,data:xs,boundaryGap:!isTrend,
        axisLabel:{color:'#8da1b5',fontSize:10},axisLine:{lineStyle:{color:'#3c4e65'}}}
    ],
    yAxis:[
      {type:'value',scale:true,position:'right',min:values.length?Math.max(0,lo-pad):undefined,max:values.length?hi+pad:undefined,
        axisLabel:{color:'#93a8c0'},splitLine:{lineStyle:{color:'#26364a'}}},
      {type:'value',gridIndex:1,scale:true,axisLabel:{color:'#93a8c0'},splitLine:{lineStyle:{color:'#26364a'}}}
    ],
    dataZoom:[{type:'inside',xAxisIndex:[0,1],start:Math.max(0,100-8000/Math.max(1,items.length)),end:100}],
    series
  });
  const observer=new ResizeObserver(()=>graph.resize());observer.observe(el.current);
  return()=>{observer.disconnect();graph.dispose();};
 },[mode,items,candle,livePrice,showMarker]);
 return <div ref={el} className="gdd-chart-canvas" role="img" aria-label="价格趋势和成交量折线图"/>;
}

export default function GddTerminal(){
 const [codeInput,setCodeInput]=useState('300505');
 const [code,setCode]=useState('300505');
 const [mode,setMode]=useState<Mode>('trend');
 const [date,setDate]=useState(today);
 const [candle,setCandle]=useState(false);
 const [history,setHistory]=useState<Array<Bar|Trend>>([]);
 const [live,setLive]=useState<Live|null>(null);
 const [profile,setProfile]=useState<Profile|null>(null);
 const [loading,setLoading]=useState(false);
 const [historyError,setHistoryError]=useState('');
 const [wsError,setWsError]=useState('');
 const seq=useRef(0);
 useEffect(()=>{
   let active=true;setProfile(null);
   void apiGet<Profile>('/gdd/terminal/profile/'+code).then(x=>{if(active)setProfile(x);}).catch(()=>{});
   return()=>{active=false;};
 },[code]);
 useEffect(()=>{
  let active=true;const id=++seq.current;
  setHistory([]);setLoading(true);setHistoryError('');
  const url=mode==='trend'?'/gdd/trend/'+code+'?day='+date+'&auction=1':'/gdd/kline/'+code+'?period='+mode+'&count=180';
  void apiGet<{data:Array<Bar|Trend>}>(url).then(r=>{if(active&&id===seq.current)setHistory(r.data||[]);})
    .catch(e=>{if(active&&id===seq.current)setHistoryError(errText(e));})
    .finally(()=>{if(active&&id===seq.current)setLoading(false);});
  return()=>{active=false;};
 },[code,mode,date]);
 useEffect(()=>{
  let active=true;setLive(null);setWsError('');
  void apiPost<{errors?:{tick?:string;depth?:string}}>('/gdd/terminal/subscribe',{code})
    .then(r=>{if(active&&r.errors) {
      const messages=[r.errors.tick&&('逐笔订阅：'+r.errors.tick),
        r.errors.depth&&('盘口订阅：'+r.errors.depth)].filter(Boolean);
      if(messages.length)setWsError(messages.join('；'));
    }})
    .catch(e=>{if(active)setWsError(errText(e));});
  const poll=async()=>{
   try{const r=await apiGet<Live>('/gdd/terminal/'+code);if(active)setLive(r);}
   catch(e){if(active)setWsError(errText(e));}
  };
  void poll();const timer=window.setInterval(()=>void poll(),2000);
  return()=>{active=false;window.clearInterval(timer);
    void apiPost('/gdd/terminal/unsubscribe',{code}).catch(()=>{});};
 },[code]);

 // WS优先；无最新推送时显示最后的已知价格并保留来源标签，不能伪装为实时。
 const now=live?.lastPrice??profile?.close??null;
 const prev=live?.previousClose??profile?.previousClose??null;
 const opening=live?.open??profile?.open??null;
 const high=live?.high??profile?.high??null;
 const low=live?.low??profile?.low??null;
 const pct=now!==null&&prev!==null&&prev>0?(now-prev)/prev*100:live?.riseRate??null;
 const validLive=!!live?.connected&&!!live.quote.latest&&!live.quote.stale;
 const levels=(items:Depth[],side:'sell'|'buy')=>items.map(r=><div key={side+r.level} className="q-depth-row">
  <span className={side==='buy'?'q-up':'q-down'}>{side==='sell'?'卖':'买'}{r.level}</span>
  <strong className={delta(r.price,prev)}>{fmt(r.price)}</strong><span>{qty(r.volume)}</span>
 </div>);
 const blanks=(reverse:boolean)=>Array.from({length:10},(_,i)=>({level:reverse?10-i:i+1,price:null,volume:null}));
 return <div className="gdd-terminal">
  <div className="q-header"><form onSubmit={e=>{e.preventDefault();
    if(!/^\d{6}$/.test(codeInput)){setHistoryError('请输入正确的6位股票代码');return;}
    setCode(codeInput);}} className="q-search">
    <span className="q-logo">个股行情</span><input value={codeInput} maxLength={6} inputMode="numeric" onChange={e=>setCodeInput(e.target.value)}
      placeholder="股票代码 300505" aria-label="股票代码"/><button type="submit">查询</button>
  </form><span className={validLive?'q-connection connected':'q-connection'}>
    <i/>{validLive?'WS 实时推送':'等待实时数据'} <small>{live?.quote.latest?.receivedAt?new Date(live.quote.latest.receivedAt).toLocaleTimeString('zh-CN',{hour12:false}):'—'}</small></span></div>
  <div className="q-summary">
    <div className="q-lead"><span><b className="q-stock-name">{profile?.name||'名称待同步'}</b>　{code}</span><strong className={delta(now,prev)}>{fmt(now)}</strong>
      <b className={delta(now,prev)}>{pct===null?'—':(pct>0?'+':'')+pct.toFixed(2)+'%'}</b></div>
    {([['昨收',prev],['今开',opening],['最高',high],['最低',low]] as Array<[string,unknown]>).map(([label,value])=>
      <div key={label} className="q-stat"><span>{label}</span><strong>{fmt(value)}</strong></div>)}
    <div className="q-stat"><span>成交量</span><strong>{qty(live?.volume)}</strong></div>
    <div className="q-stat"><span>成交额</span><strong>{qty(live?.amount)}</strong></div>
  </div>
  <div className="q-source-label">行情来源：{live?.quote.latest&&!live.quote.stale?'GDD WS快照':profile?.priceSource||'未取得'} 
   {profile?.asOf?' · 历史数据日期 '+profile.asOf:''}
   {!live?.quote.latest&&' · 顶部字段为历史参考值，并非实时行情'}</div>
  <div className="q-columns">
   <section className="q-price-panel">
    <div className="q-tabs"><div>{periods.map(([id,label])=>
      <button key={id} className={mode===id?'active':''} onClick={()=>setMode(id)}>{label}</button>)}</div>
      <div className="q-chart-options">
        {mode==='trend'?<input type="date" value={date} onChange={e=>setDate(e.target.value)}/>:
          <><button className={!candle?'active':''} onClick={()=>setCandle(false)}>折线</button>
            <button className={candle?'active':''} onClick={()=>setCandle(true)}>蜡烛图</button></>}
      </div></div>
    <div className="q-chart-title"><span>{mode==='trend'?'分时（09:15–09:25竞价 / 09:30–11:30 / 13:00–15:00）':'历史行情 · MA5 / MA10 / MA20'}</span>
      <span>{loading?'加载中…':history.length+' 条'}</span></div>
    {historyError&&<div className="q-error">{historyError}</div>}
    {mode==='trend'?<><GddIntradayChart rows={history as Trend[]}/>
      {!history.length&&<div className="q-blank-note">{loading?'正在读取分时…':'本交易日暂无可验证的分时点位，未来分钟保持空白。'}</div>}
    </>:history.length?<MarketGraph mode={mode} items={history} candle={candle} livePrice={now} showMarker/>:
      <div className="q-empty">{loading?'读取历史行情…':'暂无可展示的历史行情数据'}</div>}
    <div className="q-foot"><span>分时轴始终到15:00，午休断开，无报价的分钟留空</span><span>源 GDD</span></div>
   </section>
   <aside className="q-sidebar">
    <div className="q-section"><strong>实时盘口</strong><span>{live?.depth.l2Available?'Level-2 十档已返回':live?.depth.levelCount?'仅'+live.depth.levelCount+'档报价':'盘口等待推送'}</span></div>
    <div className="q-depth-status">
      {live?.depth.bookSubscribed?'已订阅盘口 type=4':'盘口 type=4 未订阅'} ·
      {live?.depth.bookReceived?' 已收到盘口推送':' 尚未收到盘口数据'}
    </div>
    <div className="q-depth-head"><span>档位</span><span>价格</span><span>委托量</span></div>
    {levels(live?.depth.asks?[...live.depth.asks].reverse():blanks(true),'sell')}
    <div className="q-depth-last"><span>最新价</span><strong className={delta(now,prev)}>{fmt(now)}</strong>
      <b className={delta(now,prev)}>{pct===null?'—':(pct>0?'+':'')+pct.toFixed(2)+'%'}</b></div>
    {levels(live?.depth.bids||blanks(false),'buy')}
    <p className="q-l2-note">{live?.depth.l2Available?
      '已收到超过五档的盘口数据；以下为GDD原始报价。':
      '十档盘口尚未确认可用；缺失档位显示 —，不生成模拟L2。'}</p>
    <div className="q-section"><strong>逐笔成交</strong><span>WS 251</span></div>
    <div className="q-depth-head"><span>时间</span><span>价格</span><span>量</span></div>
    <div className="q-deals">{live?.deals.length?live.deals.map((r,i)=>{
      const p=Number(r.price);
      return <div className="q-depth-row" key={i}><span>{String(r.time??r.receivedAt??'').slice(-8)||'—'}</span>
        <strong className={Number.isFinite(p)?delta(p,prev):''}>{fmt(r.price)}</strong><span>{qty(r.volume)}</span></div>;
    }):<div className="q-no-deals">暂无逐笔推送</div>}</div>
   </aside>
  </div>
  {wsError&&<div className="q-error">WS：{wsError}</div>}
  <details className="q-debug"><summary>实时行情诊断（点击展开，便于核对L2）</summary>
    <p>WS连接：{live?.diagnostics?.connected?'正常':'未连接'}；
      订阅类型：{live?.diagnostics?.subscribedTypes?.join(', ')||'无'}；
      最近推送 ReqType：{live?.diagnostics?.lastReqtype??'无'}；
      盘口来源：{live?.depth.source||'无'}；买卖有效档数：{live?.depth.levelCount??0}</p>
    <p>消息计数：{JSON.stringify(live?.diagnostics?.pushCounts||{})}；
      无法关联的数据包：{live?.diagnostics?.droppedRows??0}；
      最近错误：{live?.diagnostics?.lastError||'无'}</p>
    <p>快照字段：{live?.diagnostics?.quoteFields?.join(', ')||'无'}</p>
    <p>盘口字段：{live?.diagnostics?.bookFields?.join(', ')||'无'}</p>
  </details>
  <p className="q-disclaimer">上游业务是否提供完整L2十档由GDD实际返回决定。历史HTTP和实时WS数据分开标识；休市时不会有新推送。仅供行情研究。</p>
 </div>;
}
