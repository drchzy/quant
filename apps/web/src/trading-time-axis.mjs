/**
 * 沪深股票交易分时固定时间轴。
 * 开盘集合竞价09:15-09:25、上午09:30-11:30、下午13:00-15:00。
 * 插入空白隔断避免用折线跨越竞价间隔或午休，也不填充未来分钟。
 */
function range(startHour,startMinute,endHour,endMinute){
  const points=[];
  for(let n=startHour*60+startMinute;n<=endHour*60+endMinute;n++){
    points.push(String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'));
  }
  return points;
}
export const GDD_SESSION_TIMES=[
  ...range(9,15,9,25),'竞价间隔',...range(9,30,11,30),
  '午休',...range(13,0,15,0)
];
export const GDD_SESSION_TICKS=new Set(['09:15','09:25','09:30','10:30','11:30','13:00','14:00','15:00']);
function cleanTime(value){
  const found=String(value??'').match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if(!found)return null;
  const hour=Number(found[1]),min=Number(found[2]);
  if(hour>23||min>59)return null;
  return String(hour).padStart(2,'0')+':'+String(min).padStart(2,'0');
}
function finiteOrNull(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
export function buildGddSessionAxis(items){
  const map=new Map();
  for(const item of items){
    const time=cleanTime(item.time??item.datetime);
    const price=finiteOrNull(item.price);
    if(!time||price===null||!GDD_SESSION_TIMES.includes(time))continue;
    map.set(time,{price,average:finiteOrNull(item.avgPrice??item.average),
      volume:finiteOrNull(item.volume)});
  }
  const morning=[],afternoon=[],auction=[],average=[],volume=[];
  for(const t of GDD_SESSION_TIMES){
    const r=map.get(t);
    const a=t>='09:15'&&t<='09:25';
    const m=t>='09:30'&&t<='11:30';
    const p=t>='13:00'&&t<='15:00';
    auction.push(a&&r?r.price:null);
    morning.push(m&&r?r.price:null);
    afternoon.push(p&&r?r.price:null);
    average.push(!a&&r?r.average:null);
    volume.push(r?.volume??null);
  }
  return {labels:GDD_SESSION_TIMES,auction,morning,afternoon,average,volume,
    fixedTicks:GDD_SESSION_TIMES.map((t,i)=>GDD_SESSION_TICKS.has(t)?i:-1).filter(i=>i>=0),
    actualMinutes:map.size};
}
