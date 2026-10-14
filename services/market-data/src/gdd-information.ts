import { gddMarketCode } from './gdd.js';

/**
 * 旧服务路径由 APK ServerManager.getServerPath() 决定，尚无法从当前
 * query_server_info 中唯一确认。只有配置真实 GDD_INFO_BASE_URL 才请求，
 * 不猜测内部服务器地址，也不把会话发往不明域名。
 */
export const GDD_F10_PATHS = {
  profile: '/f10/profile/query_profile',
  balance: '/f10/feature/balance_info',
  cash: '/f10/feature/cash_info',
  ratio: '/f10/feature/rate_info',
  income: '/f10/feature/income_info',
  summary: '/f10/feature/summary_info'
} as const;
export const GDD_NEWS_PATHS = {
  categories: '/news/getCategory',
  news: '/news/getNews',
  detail: '/news/getNewsDetail',
  group: '/news/getGroupNews'
} as const;

function validatedBase() {
  const raw=String(process.env.GDD_INFO_BASE_URL||'').trim();
  if(!raw)throw Error('GDD 旧资讯/F10服务地址尚未从客户端确定：请配置 GDD_INFO_BASE_URL');
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
    url.search||url.hash)throw Error('GDD_INFO_BASE_URL 必须为可信 HTTP(S) 基址');
  return url.toString().replace(/\/+$/,'');
}

async function callLegacy(path:string, params:Record<string,string|number>):Promise<unknown> {
  const base=validatedBase();
  const content=JSON.stringify(params);
  if(content.length>3000)throw Error('GDD旧接口参数过长');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    // 逆向文档仅提供方法路径，HTTP Method与body结构需真实抓包核实。
    // 首先POST传统JSON，405时才尝试GET；全部白名单只读路径。
    let response=await fetch(base+path,{method:'POST',
      headers:{'Content-Type':'application/json; charset=utf-8'},body:content,signal:controller.signal});
    if(response.status===405){
      const uri=new URL(base+path);
      for(const [key,value] of Object.entries(params))uri.searchParams.set(key,String(value));
      response=await fetch(uri.toString(),{signal:controller.signal});
    }
    if(!response.ok)throw Error('GDD旧接口 HTTP '+response.status);
    const text=await response.text();
    if(text.length>300000)throw Error('GDD旧接口返回体过大');
    try{
      return {protocolVerified:false,source:'GDD legacy endpoint',path,result:JSON.parse(text)};
    }catch {
      throw Error('GDD旧接口不是JSON格式（返回内容未予展示）');
    }
  }finally{clearTimeout(timeout);}
}

export async function fetchGddF10(code:string, section:keyof typeof GDD_F10_PATHS) {
  gddMarketCode(code);
  const path=GDD_F10_PATHS[section];
  if(!path)throw Error('未知F10功能');
  // "market" 用下发的 marketCode，而非交易所marketId。
  return callLegacy(path,{market:gddMarketCode(code),code});
}
export async function fetchGddNews(
  section:keyof typeof GDD_NEWS_PATHS,
  params:{category?:string;page?:number;pageSize?:number;id?:string}={}
) {
  const path=GDD_NEWS_PATHS[section];
  if(!path)throw Error('未知GDD资讯功能');
  const page=params.page??1, pageSize=params.pageSize??20;
  if(!Number.isInteger(page)||page<1||page>500||
     !Number.isInteger(pageSize)||pageSize<1||pageSize>50)throw Error('资讯分页参数不合法');
  if(params.category && !/^[\w-]{1,40}$/.test(params.category))throw Error('category 不合法');
  if(params.id && !/^[\w-]{1,64}$/.test(params.id))throw Error('资讯ID不合法');
  return callLegacy(path,{page,pageSize,...(params.category?{category:params.category}:{}),...(params.id?{id:params.id}:{})});
}
