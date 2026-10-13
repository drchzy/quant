import { getGddServerAddress, invalidateGddGateway } from './gdd.js';

/**
 * 逆向得到的统一行情插件命令目录；仅供 market-data 服务内部使用。
 * 注意：部分 RequestUtils 构造器的 Data 字段尚未验证，不能按猜测自动生成请求。
 */
export const GDD_PLUGIN_COMMANDS = {
  fundFlow: 1200,
  blockData: 1201,
  blockMerchRank: 1202,
  blockRank: 1203,
  blockSymbolRankingByCycle: 1225,
  chooseStocks: 1207,
  riseFall: 1260,
  dragons: 1264,
  limitUpDown: 1274,
  indexParams: 1279,
  capitalTrend: 1282,
  shortLine: 1287,
  merchAuction: 1403,
  bigStrategy: 1417,
  relatedBlock: 1421,
  statisticsRange: 1427,
  lhbList: 3002,
  lhbDetail: 3003
} as const;

export type GddPluginCommand = keyof typeof GDD_PLUGIN_COMMANDS;

export function buildGddPluginRequest(command: GddPluginCommand, data: Record<string, unknown> | Array<Record<string, unknown>>, reqId = 1) {
  const reqtype = GDD_PLUGIN_COMMANDS[command];
  if (!Number.isSafeInteger(reqId) || reqId < 0) throw new Error('GDD 插件 ReqID 无效');
  if (data === null || typeof data !== 'object' ||
      (Array.isArray(data) && (data.length === 0 || data.length > 20 ||
       data.some((row) => !row || Array.isArray(row) || typeof row !== 'object')))) {
    throw new Error('GDD 插件 Data 必须为 JSON 对象或非空对象数组');
  }
  // 插件使用大写 ReqType/ReqID/Data，与 reqtype=150/152 不同。
  return { ReqType: reqtype, ReqID: reqId, Data: data };
}

/**
 * 不提供未授权 HTTP 代理。只有代码明确知道该命令 Data 结构时才在服务内部调用。
 * 网关永远来自自动登录后的 serverType=36；不使用硬编码行情地址。
 */
export async function callGddPlugin(
  command: GddPluginCommand,
  data: Record<string, unknown> | Array<Record<string, unknown>>,
  signal?: AbortSignal
): Promise<unknown> {
  if (!(command in GDD_PLUGIN_COMMANDS)) throw new Error('GDD 插件命令未登记');
  const envelope = buildGddPluginRequest(command, data);
  const serialized = JSON.stringify(envelope);
  if (serialized.length > 32_768) throw new Error('GDD 插件请求过大');
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = await getGddServerAddress(command === 'lhbList' || command === 'lhbDetail' ? 35 : 36, signal);
    const controller = new AbortController();
    const listener = () => controller.abort();
    signal?.addEventListener('abort', listener, { once: true });
    const raw = Number(process.env.GDD_TIMEOUT_MS || 12_000);
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number.isFinite(raw) ? raw : 12_000));
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: serialized,
        signal: controller.signal
      });
      if (!response.ok) {
        if ([502, 503, 504].includes(response.status) && attempt === 0) {
          invalidateGddGateway();
          continue;
        }
        throw new Error('GDD 插件 HTTP ' + response.status);
      }
      // 限制上游返回大小，避免一次查询拖垮单容器 Node 进程。
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('GDD 插件响应超出 2MB 限额');
      try { return JSON.parse(text); } catch { throw new Error('GDD 插件响应不是 JSON'); }
    } catch (error) {
      if (attempt === 0 && !signal?.aborted &&
          (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError'))) {
        invalidateGddGateway();
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', listener);
    }
  }
  throw new Error('GDD 插件动态网关重试失败');
}
