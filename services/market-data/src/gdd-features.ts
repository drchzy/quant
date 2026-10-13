import { gddMarketCode } from './gdd.js';
import { callGddPlugin, type GddPluginCommand } from './gdd-plugin.js';

export type FeatureField = {
  key: string;
  label: string;
  kind: 'stock' | 'integer' | 'date' | 'datetime';
  default?: string;
  min?: number;
  max?: number;
};

export type Feature = {
  id: GddPluginCommand;
  title: string;
  group: 'market' | 'sectors' | 'stocks' | 'strategy' | 'lhb';
  description: string;
  reqtype: number;
  fields: FeatureField[];
};

const stock: FeatureField = { key: 'code', label: '股票代码', kind: 'stock', default: '300505' };
const market: FeatureField = { key: 'market', label: '市场号（默认自动推断）', kind: 'integer', min: 0, max: 65535 };
const block: FeatureField = { key: 'block', label: '板块 ID', kind: 'integer', default: '54000', min: 0, max: 9999999 };
const count: FeatureField = { key: 'count', label: '数量', kind: 'integer', default: '30', min: 1, max: 100 };
const start: FeatureField = { key: 'start', label: '起始位置', kind: 'integer', default: '0', min: 0, max: 5000 };
const type: FeatureField = { key: 'type', label: '类型', kind: 'integer', default: '0', min: 0, max: 10000 };
const desc: FeatureField = { key: 'desc', label: '降序', kind: 'integer', default: '1', min: 0, max: 1 };
const time: FeatureField = { key: 'time', label: '时间参数', kind: 'integer', default: '0', min: 0, max: 9999999999999 };

export const GDD_FEATURES: Feature[] = [
  { id:'riseFall', title:'市场涨跌家数', group:'market', reqtype:1260, description:'全市场上涨、平盘、下跌家数和统计分布', fields:[market,{key:'code',label:'指数/市场代码',kind:'stock',default:'000001'},type,time]},
  { id:'limitUpDown', title:'涨跌停榜单', group:'market', reqtype:1274, description:'涨停/跌停个股与板块', fields:[{key:'st',label:'包含 ST（0/1）',kind:'integer',default:'0',min:0,max:1},type,{key:'updown',label:'上涨/下跌类型',kind:'integer',default:'1',min:0,max:10},start,count,{key:'sort',label:'排序类型',kind:'integer',default:'0',min:0,max:30},desc]},
  { id:'shortLine', title:'短线精灵', group:'market', reqtype:1287, description:'行情异动提醒和短线事件', fields:[type,start,count]},
  { id:'bigStrategy', title:'大盘策略', group:'market', reqtype:1417, description:'市场趋势策略指标', fields:[stock,market,time]},
  { id:'blockData', title:'板块详情', group:'sectors', reqtype:1201, description:'热门板块及板块所属股票', fields:[block]},
  { id:'blockRank', title:'板块排行', group:'sectors', reqtype:1203, description:'板块涨跌与资金排名', fields:[block,type,desc,start,count]},
  { id:'blockMerchRank', title:'板块个股排行', group:'sectors', reqtype:1202, description:'板块内商品/股票排序', fields:[{key:'category',label:'分类',kind:'integer',default:'1',min:0,max:100},market,type,desc,start,count]},
  { id:'blockSymbolRankingByCycle', title:'周期板块排行', group:'sectors', reqtype:1225, description:'指定周期的板块个股排行', fields:[block,type,desc,start,count,{key:'timebase',label:'周期',kind:'integer',default:'1',min:0,max:100}]},
  { id:'relatedBlock', title:'个股所属板块', group:'sectors', reqtype:1421, description:'查询股票的行业、概念板块归属', fields:[stock,market,{key:'relatedType',label:'板块类型',kind:'integer',default:'1',min:0,max:100}]},
  { id:'fundFlow', title:'商品资金流向', group:'stocks', reqtype:1200, description:'个股主力及大单资金流向', fields:[stock,market]},
  { id:'capitalTrend', title:'资金走势', group:'stocks', reqtype:1282, description:'当日资金流向时序数据', fields:[stock,market]},
  { id:'merchAuction', title:'集合竞价', group:'stocks', reqtype:1403, description:'个股集合竞价数据', fields:[stock,market]},
  { id:'indexParams', title:'技术指标参数', group:'stocks', reqtype:1279, description:'个股相关指标参数', fields:[stock,market,{key:'p1',label:'Param1',kind:'integer',default:'0',min:0,max:1000000},{key:'p2',label:'Param2',kind:'integer',default:'0',min:0,max:1000000}]},
  { id:'statisticsRange', title:'区间统计', group:'stocks', reqtype:1427, description:'指定时间区间涨跌与板块统计', fields:[stock,market,{key:'begin',label:'开始日期',kind:'date',default:'2026-10-01'},{key:'end',label:'结束日期',kind:'date',default:'2026-10-13'}]},
  { id:'chooseStocks', title:'智能选股池', group:'strategy', reqtype:1207, description:'GDD 龙头模型选股池，具体权限由上游判定', fields:[type,time,{key:'intraday',label:'盘中模式',kind:'integer',default:'0',min:0,max:1},desc,{key:'sort',label:'排序类别',kind:'integer',default:'0',min:0,max:100},start,count]},
  { id:'dragons', title:'龙头列表', group:'strategy', reqtype:1264, description:'龙头题材、分数与记录', fields:[{key:'block',label:'板块 ID',kind:'integer',default:'0',min:0,max:9999999}]},
  { id:'lhbList', title:'龙虎榜列表', group:'lhb', reqtype:3002, description:'按日期查询龙虎榜列表（动态查找 serverType=35）', fields:[{key:'date',label:'查询日期',kind:'date',default:'2026-10-13'}]},
  { id:'lhbDetail', title:'龙虎榜详情', group:'lhb', reqtype:3003, description:'指定榜单 ID 的营业部买卖详情', fields:[{key:'id',label:'榜单 ID',kind:'integer',default:'1',min:1,max:999999999}]}
];

const featureMap = new Map(GDD_FEATURES.map((f) => [f.id, f]));

function cleanParams(id: string, params: Record<string, unknown>): { def: Feature; args: Record<string, string | number> } {
  const def = featureMap.get(id as GddPluginCommand);
  if (!def) throw new Error('不支持的 GDD 功能');
  const args: Record<string, string | number> = {};
  for (const item of def.fields) {
    const raw = params[item.key] === undefined ? (item.default ?? '') : String(params[item.key]);
    if (raw.length > 48) throw new Error(item.label + '长度超限');
    if (!raw && item.key === 'market') continue;
    if (!raw) throw new Error(item.label + '不能为空');
    if (item.kind === 'stock') {
      if (!/^\d{6}$/.test(raw)) throw new Error(item.label + '必须为六位数字');
      args[item.key] = raw;
    } else if (item.kind === 'integer') {
      if (!/^\d+$/.test(raw)) throw new Error(item.label + '必须为非负整数');
      const n = Number(raw);
      if (!Number.isSafeInteger(n) || n < (item.min ?? 0) || n > (item.max ?? 9999999999999)) {
        throw new Error(item.label + '超出允许范围');
      }
      args[item.key] = n;
    } else if (item.kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw)) ||
          new Date(raw + 'T00:00:00Z').toISOString().slice(0,10) !== raw) throw new Error(item.label + '日期无效');
      args[item.key] = raw;
    } else {
      args[item.key] = raw;
    }
  }
  return { def, args };
}

function requestData(id: GddPluginCommand, a: Record<string, string | number>): Record<string, unknown> | Array<Record<string, unknown>> {
  const code = String(a.code ?? '300505');
  const m = Number(a.market ?? (id === 'riseFall' ? 0 : gddMarketCode(code)));
  const stock = { Market:m, Code: code };
  switch (id) {
    case 'riseFall': return { ...stock, Type:a.type, Time:a.time };
    case 'limitUpDown': return { IsST:a.st, Type:a.type, UpDown:a.updown, StartPos:a.start, Count:a.count, SortType:a.sort, Desc:a.desc };
    case 'shortLine': return { Type:a.type, StartPos:a.start, Count:a.count };
    case 'bigStrategy': return { ...stock, Time:a.time };
    case 'blockData': return [{ BlockID:a.block }];
    case 'blockRank': return { BlockID:a.block, Desc:a.desc, StartPos:a.start, Count:a.count, Type:a.type, Level:0 };
    case 'blockMerchRank': return { Category:a.category, Market:m, Desc:a.desc, Count:a.count, Type:a.type, StartPos:a.start };
    case 'blockSymbolRankingByCycle': return { BlockID:a.block, Type:a.type, Desc:a.desc, StartPos:a.start, Count:a.count, TimeBase:a.timebase };
    case 'relatedBlock': return { type:[a.relatedType], sym_list:[{ market:m, code }] };
    case 'fundFlow': return [stock];
    case 'capitalTrend':
    case 'merchAuction': return stock;
    case 'indexParams': return { ...stock, Param1:a.p1, Param2:a.p2, Type:0 };
    case 'statisticsRange': return { Code:code, Market:m, Begin:a.begin, End:a.end };
    case 'chooseStocks': return { Type:a.type, Time:a.time, Intraday:a.intraday, Desc:a.desc, SortType:a.sort, StartPos:a.start, Count:a.count };
    case 'dragons': return { Block:a.block, Type:0 };
    case 'lhbList': return { Time:a.date };
    case 'lhbDetail': return { ID:a.id };
  }
}

export function prepareGddFeature(id: string, params: Record<string, unknown>) {
  const { def, args } = cleanParams(id, params);
  return { feature: def, request: requestData(def.id, args) };
}

export async function queryGddFeature(id: string, params: Record<string, unknown>, signal?: AbortSignal) {
  const { feature, request } = prepareGddFeature(id, params);
  const response: any = await callGddPlugin(feature.id, request, signal);
  if (!response || typeof response !== 'object') throw new Error('GDD 插件响应格式错误');
  const status = Number(response.status ?? response.Status ?? 0);
  if (!Number.isFinite(status) || status !== 0) {
    throw new Error('GDD 插件返回状态=' + (Number.isFinite(status) ? status : '未知'));
  }
  const payload = response.result ?? response.Result ?? response.data ?? response.Data ?? null;
  return { id: feature.id, title: feature.title, reqtype: feature.reqtype, receivedAt: new Date().toISOString(), result: payload };
}
