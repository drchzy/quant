import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { GDD_FEATURES, queryGddFeature } from './gdd-features.js';
import { fetchGddKline, fetchGddTrend, fetchGddTicks, getGddServerAddress } from './gdd.js';
import { getSourceSettings } from './source-manager.js';

// GDD MCP 仅提供只读查询；MCP 不暴露用户凭据或 GDD sessionCode，也不提供任意HTTP转发。
const MAX_MCP_TEXT = 45_000;
const rateTimes: number[] = [];

function checkToken(value: string | undefined): boolean {
  const token = String(process.env.GDD_MCP_TOKEN || '');
  if (token.length < 32 || !value?.startsWith('Bearer ')) return false;
  const supplied = value.slice(7);
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyOrigin(value: string | undefined): boolean {
  if (!value) return true; // 原生MCP客户端通常无Origin请求头。
  const allowed = String(process.env.GDD_MCP_ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  // 有浏览器 Origin 时拒绝默认跨站请求；需要明确列出可信来源。
  return allowed.includes(value);
}

export function mcpAccessStatus(tokenHeader?: string, origin?: string): 200 | 401 | 403 | 503 {
  const token = String(process.env.GDD_MCP_TOKEN || '');
  if (token.length < 32) return 503;
  if (!checkToken(tokenHeader)) return 401;
  if (!verifyOrigin(origin)) return 403;
  return 200;
}

function countRequest(): void {
  const now = Date.now();
  while (rateTimes.length && rateTimes[0] < now - 60_000) rateTimes.shift();
  if (rateTimes.length >= 30) throw new Error('GDD MCP 限速：每分钟最多30次数据请求');
  rateTimes.push(now);
}

async function ensureGdd(): Promise<void> {
  const item = (await getSourceSettings()).find((source) => source.id === 'gdd');
  if (!item?.enabled || !item.available) {
    throw new Error('GDD 未启用：请设置 web/.env 中的账号密码，并在数据源管理启用 GDD');
  }
}

function result(value: unknown) {
  let text = JSON.stringify(value);
  if (text.length > MAX_MCP_TEXT) {
    text = JSON.stringify({
      truncated: true,
      message: '返回体过大，当前仅展示前45000个字符。请缩小查询条数或过滤范围。',
      preview: text.slice(0, MAX_MCP_TEXT - 300)
    });
  }
  return { content: [{ type: 'text' as const, text }] };
}

function registerReadTool(
  server: McpServer,
  name: string,
  description: string,
  schema: any,
  query: (args: any) => Promise<unknown>
) {
  server.registerTool(name, {
    description, title: name,
    inputSchema: schema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  }, async (args: any) => {
    try {
      countRequest();
      await ensureGdd();
      return result(await query(args));
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'GDD 查询失败' }]
      };
    }
  });
}

function createGddMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'quant-gdd-market', version: '1.0.0' },
    { instructions: '只读A股行情查询。先用 gdd_list_features 获取可用插件，然后使用对应的 featureId 查询。所有行情只供研究，不构成交易建议。' }
  );

  registerReadTool(
    server, 'gdd_get_connection',
    '检测GDD账号自动登录和动态发现的行情网关/龙虎榜网关；只返回公开的行情网关地址，不返回令牌或密码。',
    z.object({}), async () => {
      const gateway = await getGddServerAddress(36);
      let lhb: string | null = null;
      try { lhb = await getGddServerAddress(35); } catch { /* 可能未下发龙虎榜服务 */ }
      return { gateway, lhb, checkedAt: new Date().toISOString(), authentication: 'configured' };
    }
  );

  registerReadTool(
    server, 'gdd_list_features',
    '列出18类GDD行情插件功能，包括板块排行、涨跌停、资金流向、龙虎榜、龙头模型等，以及各功能请求参数。',
    z.object({}), async () => GDD_FEATURES.map(({id,title,description,group,reqtype,fields}) =>
      ({ id,title,description,group,reqtype,fields }))
  );

  registerReadTool(
    server, 'gdd_get_kline',
    '查询指定A股股票的GDD日K/周K/月K或5/15/30/60分钟K线；code是6位证券代码，period=10为日K，2为5分钟。',
    z.object({
      code: z.string().regex(/^\d{6}$/).describe('六位A股证券代码，例如300505'),
      period: z.number().int().refine((n) => [2,3,4,5,6,7,10,11,20,21,30].includes(n), '不支持该K线周期').default(10),
      count: z.number().int().min(1).max(200).default(60)
    }), async ({ code,period,count }: any) => ({
      source: 'gdd', code,period, data: await fetchGddKline(code,period,count)
    })
  );

  registerReadTool(
    server, 'gdd_get_trend',
    '查询指定股票某个交易日的GDD分时走势，包括价格、均价、成交量。day格式为YYYY-MM-DD。',
    z.object({
      code: z.string().regex(/^\d{6}$/),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    }), async ({code,day}:any) => ({source:'gdd',code,day:day||null,data:await fetchGddTrend(code,day)})
  );

  registerReadTool(
    server, 'gdd_get_ticks',
    '查询指定股票某交易日的历史逐笔成交。仅用于研究与复盘，不提供下单功能。',
    z.object({
      code: z.string().regex(/^\d{6}$/),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }), async ({code,day}:any) => ({source:'gdd',code,day,data:await fetchGddTicks(code,day)})
  );

  registerReadTool(
    server, 'gdd_query_feature',
    '按GDD功能ID查询受控插件：包括 riseFall、limitUpDown、blockRank、fundFlow、capitalTrend、chooseStocks、dragons、lhbList、lhbDetail 等18类。先调用 gdd_list_features 获取该功能对应参数。',
    z.object({
      featureId: z.string().min(1).max(45).describe('已登记功能ID，不是任意ReqType'),
      params: z.record(z.string(),z.union([z.string(),z.number()])).default({})
    }), async ({ featureId, params }: any) => queryGddFeature(featureId,params)
  );

  registerReadTool(
    server, 'gdd_get_sector_rank',
    '查询GDD板块排行（ReqType 1203），适合市场热点板块、行业概念强弱研究。',
    z.object({
      block: z.number().int().min(0).max(9999999).default(54000),
      type: z.number().int().min(0).max(10000).default(0),
      count: z.number().int().min(1).max(100).default(30)
    }), async ({block,type,count}:any) => queryGddFeature('blockRank',{block,type,count})
  );

  registerReadTool(
    server, 'gdd_get_money_flow',
    '查询单只股票的GDD商品资金流向，包括大单净流入等字段（ReqType 1200）。',
    z.object({ code: z.string().regex(/^\d{6}$/) }),
    async ({code}:any) => queryGddFeature('fundFlow',{code})
  );

  registerReadTool(
    server, 'gdd_get_limit_board',
    '查询GDD涨跌停股票榜单（ReqType 1274），参数updown和count可调整。',
    z.object({
      updown:z.number().int().min(0).max(10).default(1),
      count:z.number().int().min(1).max(100).default(30),
      st:z.number().int().min(0).max(1).default(0)
    }), async ({updown,count,st}:any) => queryGddFeature('limitUpDown',{updown,count,st})
  );

  registerReadTool(
    server, 'gdd_get_dragon_pool',
    '查询GDD龙头列表（ReqType 1264），此功能可能受上游账户权限限制。',
    z.object({block:z.number().int().min(0).max(9999999).default(0)}),
    async ({block}:any) => queryGddFeature('dragons',{block})
  );

  registerReadTool(
    server, 'gdd_get_lhb',
    '查询GDD龙虎榜列表或榜单详情（ReqType 3002/3003），自动使用serverType=35的龙虎榜网关。',
    z.object({
      day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      id:z.number().int().min(1).max(999999999).optional()
    }), async ({day,id}:any) => {
      if(id !== undefined) return queryGddFeature('lhbDetail',{id});
      return queryGddFeature('lhbList',{date:day || new Date(Date.now()+8*3600_000).toISOString().slice(0,10)});
    }
  );

  return server;
}

const handler = createMcpHandler(createGddMcpServer, { responseMode: 'json' });
const nodeHandler = toNodeHandler(handler);

/**
 * Node请求由Fastify onRequest阶段转交（未读取POST body）。
 * MCP响应由官方SDK写入原始ServerResponse。
 */
export async function serveGddMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const status = mcpAccessStatus(req.headers.authorization, req.headers.origin);
  if (status !== 200) {
    res.statusCode = status;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    if (status === 401) res.setHeader('WWW-Authenticate','Bearer realm="quant-gdd-mcp"');
    res.end(JSON.stringify({ error: status===503 ? 'GDD MCP 未启用：需配置长度至少32字符的GDD_MCP_TOKEN'
      : status===403 ? 'Origin 未被允许' : 'GDD MCP 访问令牌无效' }));
    return;
  }
  res.setHeader('Cache-Control','no-store');
  await nodeHandler(req,res);
}
