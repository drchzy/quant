import { fetchGddKline, gddMarketCode } from './gdd.js';
import { run } from './database.js';

export const GDD_BATCH_PERIODS = [2,3,4,5,6,7,10] as const;
const MINUTES: Record<number,number> = {2:5,3:60,4:3,5:15,6:30,7:120};
let busy=false;

export function validateGddBatch(codes:string[],period:number,count:number) {
  if(!Array.isArray(codes)||codes.length<1||codes.length>10)throw Error('每批允许1～10只股票');
  const unique=[...new Set(codes)];
  for(const code of unique)gddMarketCode(code);
  if(!GDD_BATCH_PERIODS.includes(period as any))throw Error('批量入库目前只支持日K及3/5/15/30/60/120分钟K');
  if(!Number.isInteger(count)||count<1||count>200)throw Error('单只股票最多200根K线');
  return unique;
}

/**
 * MCP批量任务默认只读取；只有 persist=true 才写DuckDB。
 * 不进行拆单/自动交易。错误票独立汇报，不能用空数据冒充同步成功。
 */
export async function batchGddHistory(codes:string[],period=10,count=120,persist=false) {
  const selected=validateGddBatch(codes,period,count);
  if(busy)throw Error('上一批GDD历史数据任务尚未完成');
  busy=true;
  const out:Array<{code:string;received:number;persisted:number;sample?:unknown;error?:string}>=[];
  try{
    for(const code of selected){
      try{
        const rows=await fetchGddKline(code,period,count);
        if(!rows.length)throw Error('GDD未返回有效K线');
        let persisted=0;
        if(persist){
          // 只处理已经通过GDD表头映射/OHLC验证的行。
          // upsert不触碰stock表的名称或额外估值信息。
          for(const row of rows){
            if(period===10){
              await run(`INSERT INTO daily_price
                (code,trade_date,open,close,high,low,volume,amount,pct,change,amplitude,turnover,source,updated_at)
                VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'gdd',now())
                ON CONFLICT(code,trade_date) DO UPDATE SET
                  open=excluded.open,close=excluded.close,high=excluded.high,low=excluded.low,
                  volume=excluded.volume,amount=excluded.amount,pct=NULL,change=NULL,
                  amplitude=NULL,turnover=NULL,source='gdd',updated_at=now()`,
                [code,row.date.slice(0,10),row.open,row.close,row.high,row.low,row.volume,row.amount]);
            }else{
              await run(`INSERT INTO minute_price
                (code,period,trade_time,open,close,high,low,volume,amount,pct,change,turnover,source,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,'gdd',now())
                ON CONFLICT(code,period,trade_time) DO UPDATE SET
                  open=excluded.open,close=excluded.close,high=excluded.high,low=excluded.low,
                  volume=excluded.volume,amount=excluded.amount,
                  pct=NULL,change=NULL,turnover=NULL,source='gdd',updated_at=now()`,
                [code,MINUTES[period],row.date,row.open,row.close,row.high,row.low,row.volume,row.amount]);
            }
            persisted++;
          }
        }
        out.push({code,received:rows.length,persisted,sample:rows.at(-1)});
      }catch(e){
        out.push({code,received:0,persisted:0,error:e instanceof Error?e.message:'未知错误'});
      }
      // 限速：即使是批量任务也不要连续高频打上游。
      await new Promise(r=>setTimeout(r,250));
    }
  }finally{busy=false;}
  return {source:'gdd',mode:persist?'persist':'preview',period,requested:selected.length,
    ok:out.filter(x=>!x.error).length,failed:out.filter(x=>!!x.error).length,
    totalPersisted:out.reduce((a,b)=>a+b.persisted,0),items:out};
}

/** MCP低风险交易辅助只负责出计划，不接触券商真实资金或提交订单。 */
export function paperTradePlan(input:{
  code:string;entry:number;stop:number;target:number;capital:number;maxPositionPct:number
}){
  gddMarketCode(input.code);
  const {entry,stop,target,capital,maxPositionPct}=input;
  if(![entry,stop,target,capital,maxPositionPct].every(Number.isFinite)||
    entry<=0||stop<=0||target<=0||capital<=0||maxPositionPct<=0||maxPositionPct>50)throw Error('交易计划参数无效');
  if(!(stop<entry&&entry<target))throw Error('只支持做多交易计划：止损价 < 入场价 < 止盈价');
  const budget=capital*maxPositionPct/100;
  const shares=Math.floor(budget/entry/100)*100;
  const cost=shares*entry;
  return {mode:'simulation_only',noOrderSubmitted:true,code:input.code,
    entry,stop,target,shares,plannedCost:cost,
    riskAmount:Number((shares*(entry-stop)).toFixed(2)),
    potentialProfit:Number((shares*(target-entry)).toFixed(2)),
    rewardRiskRatio:Number(((target-entry)/(entry-stop)).toFixed(2)),
    requiresNextDaySellForNewBuy:true,
    conditions:['A股T+1','未考虑交易费用和滑点','仅供计划与复盘，不构成实盘交易']};
}
