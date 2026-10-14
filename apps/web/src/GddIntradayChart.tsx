import {useEffect,useRef} from 'react';
import * as echarts from 'echarts';
import {buildGddSessionAxis,GDD_SESSION_TICKS} from './trading-time-axis.mjs';

export interface IntradayPoint {time:string;datetime?:string;price:number;avgPrice:number;volume:number}
export function GddIntradayChart({rows}:{rows:IntradayPoint[]}) {
  const node=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!node.current)return;
    const chart=echarts.init(node.current,undefined,{renderer:'canvas'});
    const session=buildGddSessionAxis(rows);
    const prices=[...session.auction,...session.morning,...session.afternoon].filter((v):v is number=>v!==null);
    const min=prices.length?Math.min(...prices):0,max=prices.length?Math.max(...prices):0;
    const pad=Math.max((max-min)*0.18,(max||1)*0.003);
    chart.setOption({
      animation:false,
      legend:{top:0,left:8,itemHeight:2,itemWidth:14,textStyle:{color:'#8fa5be',fontSize:11}},
      tooltip:{trigger:'axis',axisPointer:{type:'cross'},confine:true,
        backgroundColor:'#12283d',borderColor:'#466076',textStyle:{color:'#e0effc'}},
      grid:[{left:44,right:65,top:38,height:'59%'},{left:44,right:65,top:'78%',height:'13%'}],
      xAxis:[
        {type:'category',data:session.labels,boundaryGap:false,
          axisLabel:{show:false},axisLine:{lineStyle:{color:'#38516b'}},
          splitLine:{show:true,lineStyle:{color:'#27384f'}}},
        {type:'category',gridIndex:1,data:session.labels,boundaryGap:false,
          axisTick:{show:false},axisLine:{lineStyle:{color:'#38516b'}},
          axisLabel:{interval:0,hideOverlap:false,fontSize:10,color:'#98aec8',
            formatter:(v:string)=>GDD_SESSION_TICKS.has(v)?v:''}}
      ],
      yAxis:[
        {type:'value',scale:true,position:'right',
          min:prices.length?Math.max(0,min-pad):undefined,max:prices.length?max+pad:undefined,
          axisLabel:{color:'#98aec8'},splitLine:{lineStyle:{color:'#27384f'}}},
        {type:'value',gridIndex:1,scale:true,
          axisLabel:{color:'#98aec8'},splitLine:{lineStyle:{color:'#27384f'}}}
      ],
      // 三条曲线分别属于集合竞价、早盘和午盘，永远不跨越未交易时段。
      series:[
        {name:'竞价',type:'line',showSymbol:false,connectNulls:false,
          data:session.auction,xAxisIndex:0,yAxisIndex:0,
          lineStyle:{color:'#d6a95d',width:2},areaStyle:{color:'#d6a95d25'}},
        {name:'上午',type:'line',showSymbol:false,connectNulls:false,
          data:session.morning,xAxisIndex:0,yAxisIndex:0,
          lineStyle:{color:'#63baff',width:2},areaStyle:{color:'#2c77b324'}},
        {name:'下午',type:'line',showSymbol:false,connectNulls:false,
          data:session.afternoon,xAxisIndex:0,yAxisIndex:0,
          lineStyle:{color:'#63baff',width:2},areaStyle:{color:'#2c77b324'}},
        {name:'均价',type:'line',showSymbol:false,connectNulls:false,
          data:session.average,xAxisIndex:0,yAxisIndex:0,lineStyle:{color:'#deb961',width:1,type:'dashed'}},
        {name:'成交量',type:'bar',data:session.volume,xAxisIndex:1,yAxisIndex:1,
          itemStyle:{color:'#4b89b4'}}
      ]
    });
    const resize=new ResizeObserver(()=>chart.resize());
    resize.observe(node.current);
    return()=>{resize.disconnect();chart.dispose();};
  },[rows]);
  return <div className="gdd-chart-canvas" ref={node}
    role="img" aria-label="A股分时固定交易时间轴，竞价9点15到9点25、上午9点30到11点30、下午13点到15点"/>;
}
