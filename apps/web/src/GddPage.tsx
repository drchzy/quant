import { useEffect, useMemo, useState } from 'react';
import { apiGet } from './api';

type Field = { key:string; label:string; kind:'integer'|'stock'|'date'|'datetime'; default?:string; min?:number; max?:number };
type Feature = {id:string;title:string;description:string;group:string;reqtype:number;fields:Field[]};
type QueryResponse = {id?:string;title?:string;reqtype?:number;receivedAt?:string;result?:unknown;data?:unknown;count?:number;source?:string};
const groups = [
  ['market','市场情绪'],
  ['sectors','热门板块'],
  ['stocks','个股资金'],
  ['strategy','选股策略'],
  ['lhb','龙虎榜'],
  ['timeline','分时与逐笔']
] as const;

function chinaDate(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0,10);
}
function formatted(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value).slice(0,110);
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(3);
  return String(value);
}
function getRecords(payload: unknown): Record<string, unknown>[] {
  const unwrap = (value: unknown, depth: number): unknown[] => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object' || depth > 3) return [];
    const data = value as Record<string,unknown>;
    for (const key of ['body','data','list','rows','items','result','current','today','staticList','stocks','trend','tick']) {
      const next = unwrap(data[key], depth+1);
      if (next.length) return next;
    }
    return [];
  };
  const results = unwrap(payload,0).slice(0,150);
  if (results.length) return results.map((r, i) => Array.isArray(r)
    ? Object.fromEntries(r.map((v, j) => ['字段'+j,v]))
    : r && typeof r === 'object' ? r as Record<string, unknown> : {序号:i+1,数值:r});
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return [payload as Record<string,unknown>];
  return [];
}
function valueSummary(result: unknown) {
  const rows = getRecords(result);
  const flat: Array<[string,string]> = [];
  if (result && !Array.isArray(result) && typeof result === 'object') {
    for (const [key,val] of Object.entries(result).slice(0,25)) {
      if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') flat.push([key, formatted(val)]);
    }
  }
  return {rows,stats:flat.slice(0,6)};
}
function showError(e: unknown) {
  if (!(e instanceof Error)) return String(e);
  try { const obj = JSON.parse(e.message); return String(obj.error || e.message); }
  catch {return e.message;}
}

export default function GddPage() {
  const [catalog,setCatalog] = useState<Feature[]>([]);
  const [configured,setConfigured] = useState(false);
  const [enabled,setEnabled] = useState(false);
  const [group,setGroup] = useState<string>('market');
  const [selected,setSelected] = useState<string>('riseFall');
  const [params,setParams] = useState<Record<string,string>>({});
  const [code,setCode] = useState('300505');
  const [day,setDay] = useState(chinaDate);
  const [timelineMode,setTimelineMode] = useState<'trend'|'ticks'>('trend');
  const [response,setResponse] = useState<QueryResponse|null>(null);
  const [working,setWorking] = useState(false);
  const [message,setMessage] = useState('');
  const feature = catalog.find((f) => f.id === selected);
  const visible = useMemo(()=>catalog.filter(f=>f.group===group),[catalog,group]);

  useEffect(()=>{
    void Promise.all([
      apiGet<{features:Feature[];configured:boolean}>('/gdd/features'),
      apiGet<{data:Array<{id:string;enabled:boolean;available:boolean}>}>('/data-sources')
    ]).then(([result,sources])=>{
      setCatalog(result.features);
      setConfigured(result.configured);
      setEnabled(!!sources.data.find(s=>s.id==='gdd')?.enabled);
    }).catch(e=>setMessage(showError(e)));
  },[]);

  useEffect(()=>{
    if(!feature) return;
    const next:Record<string,string>={};
    for(const f of feature.fields) next[f.key]=f.kind === 'date' ? chinaDate() : (f.default || '');
    setParams(next);
    setResponse(null);
    setMessage('');
  },[feature?.id]);

  const run = async () => {
    setWorking(true);setResponse(null);setMessage('');
    try {
      if(group==='timeline') {
        if(!/^\d{6}$/.test(code)) throw Error('股票代码必须为6位数字');
        const path = '/gdd/'+timelineMode+'/'+encodeURIComponent(code)+'?day='+encodeURIComponent(day);
        const data = await apiGet<QueryResponse>(path);
        setResponse({ ...data, title:timelineMode==='trend'?'历史分时':'历史逐笔', result:data.data });
      } else if(feature) {
        const query = new URLSearchParams();
        for (const f of feature.fields) {
          const val=params[f.key];
          if (val !== undefined && val !== '') query.set(f.key,val);
        }
        setResponse(await apiGet<QueryResponse>('/gdd/features/'+feature.id+'?'+query.toString()));
      }
    } catch(e) {setMessage(showError(e));}
    finally {setWorking(false);}
  };
  const summary = response ? valueSummary(response.result) : null;
  const keys = summary?.rows.length ? [...new Set(summary.rows.slice(0,20).flatMap(r=>Object.keys(r)))].slice(0,10) : [];

  return <div className="gdd-page">
    <div className="page-title">
      <div>
        <h2>GDD 行情工作台</h2>
        <p>市场情绪 · 板块资金 · 龙头策略 · 龙虎榜 · 历史分时 · 逐笔成交</p>
      </div>
      <span className="gdd-readonly">只读接口 · 动态网关</span>
    </div>
    <div className="gdd-status-line">
      <div className="gdd-status-card"><span>账号配置</span><strong className={configured?'gdd-good':'gdd-warn'}>{configured?'已设置':'未配置'}</strong></div>
      <div className="gdd-status-card"><span>数据源管理</span><strong className={enabled?'gdd-good':'gdd-warn'}>{enabled?'已启用':'未启用'}</strong></div>
      <div className="gdd-status-card"><span>插件功能</span><strong>{catalog.length} 项</strong></div>
      <div className="gdd-status-card"><span>来源状态</span><strong>实际请求时验证</strong></div>
    </div>
    {(!configured||!enabled)&&<div className="notice">
      先在宿主机 web/.env 中设置 GDD_ACCOUNT / GDD_PASSWORD，然后到「数据同步 → 数据源管理」启用 GDD。
      这里不展示、不保存账号密码。
    </div>}
    <div className="gdd-groups">
      {groups.map(([key,label])=><button key={key} className={group===key?'selected':''} onClick={()=>{
        setGroup(key);setResponse(null);setMessage('');
        const first=catalog.find(f=>f.group===key);if(first)setSelected(first.id);
      }}>{label}</button>)}
    </div>
    <div className="gdd-workspace">
      <aside className="gdd-feature-nav">
        <h3>{groups.find(g=>g[0]===group)?.[1]}</h3>
        {group==='timeline'
          ? <><button className={timelineMode==='trend'?'selected':''} onClick={()=>{setTimelineMode('trend');setResponse(null);}}>历史分时 · 152</button>
               <button className={timelineMode==='ticks'?'selected':''} onClick={()=>{setTimelineMode('ticks');setResponse(null);}}>逐笔成交 · 151</button></>
          : visible.map(f=><button key={f.id} className={selected===f.id?'selected':''} onClick={()=>setSelected(f.id)}>
              <span>{f.title}</span><small>ReqType {f.reqtype}</small></button>)}
      </aside>
      <section className="panel gdd-query-panel">
        <div className="gdd-panel-head"><div>
          <h3>{group==='timeline'?(timelineMode==='trend'?'历史分时':'历史逐笔'):feature?.title||'行情查询'}</h3>
          <p>{group==='timeline'?'可指定证券与交易日期；数据显示于下方':feature?.description||'选择左侧功能'}</p>
        </div><span className="gdd-flag">上游实测状态以返回结果为准</span></div>
        <div className="gdd-form">
          {group==='timeline'?<>
            <label>股票代码<input inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></label>
            <label>交易日期<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label>
          </>:feature?.fields.map(field=><label key={field.key}>{field.label}
            <input type={field.kind==='date'?'date': 'text'}
              inputMode={field.kind==='integer'||field.kind==='stock'?'numeric':undefined}
              value={params[field.key]??''}
              placeholder={field.kind==='stock'?'六位股票代码':undefined}
              onChange={e=>setParams(p=>({...p,[field.key]:e.target.value}))}/>
          </label>)}
        </div>
        <div className="gdd-actions">
          <button disabled={working||!enabled||!configured} className="gdd-run" onClick={()=>void run()}>
            {working?'正在向行情服务器查询…':'查询实时/历史数据'}
          </button>
          <span>登录、获取服务器 IP、请求行情全部在 Quant 后端完成</span>
        </div>
        {message && <div className="error">{message}</div>}
        {response && <>
          <div className="gdd-results-header">
            <h3>{response.title||'行情'} · 查询结果</h3>
            <span>ReqType {response.reqtype??(group==='timeline'?(timelineMode==='trend'?152:151):'-')}</span>
          </div>
          <div className="gdd-metrics">
            <div><span>展示记录数</span><b>{summary?.rows.length??0}</b></div>
            <div><span>返回时间</span><b>{response.receivedAt?new Date(response.receivedAt).toLocaleTimeString('zh-CN'):'—'}</b></div>
            {summary?.stats.map(([key,val])=><div key={key}><span>{key}</span><b>{val}</b></div>)}
          </div>
          {summary && summary.rows.length>0?<div className="gdd-table-scroll"><table>
            <thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead>
            <tbody>{summary.rows.map((item,i)=><tr key={i}>{keys.map(k=><td key={k} title={formatted(item[k])}>{formatted(item[k])}</td>)}</tr>)}</tbody>
          </table></div>:<div className="notice">请求成功，但没有可展示的数据行。可展开原始返回查看结构。</div>}
          <details className="gdd-json"><summary>查看原始返回数据（仅展示，不修改）</summary>
            <pre>{JSON.stringify(response.result,null,2)}</pre>
          </details>
        </>}
      </section>
    </div>
    <p className="gdd-footnote">提示：部分插件参数与响应类型来自 APK 静态逆向，尚未全部经过生产服务器联调。查询失败会显示上游错误，不会用模拟行情替代，也不会直接改变 Quant 选股仓库。</p>
  </div>;
}
