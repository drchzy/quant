import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import {
  closeDatabase,
  initDatabase
} from './database.js';
import { registerRoutes } from './routes.js';
import { getMarketDataSourceStatus } from './eastmoney.js';
import { startScheduler } from './scheduler.js';
import { serveGddMcp } from './gdd-mcp.js';
import { gddRealtime } from './gdd-realtime.js';
import { registerWebAuth } from './web-auth.js';

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

// 健康检查不访问外部数据源，只判断本服务是否正常运行。
app.get('/health', async () => ({
  status: 'ok',
  service: 'market-data',
  dataSource: 'eastmoney + tencent fallback',
  sourceStatus: getMarketDataSourceStatus(),
  database: config.databasePath,
  time: new Date().toISOString()
}));

// MCP 使用同一个 market-data Node 进程，POST原始流在 onRequest 阶段交给SDK。
// 认证默认关闭；/mcp 仅由 Nginx 8088 反向代理对外暴露。
app.route({
  method: ['GET', 'POST', 'DELETE'],
  url: '/mcp',
  onRequest: (request, reply) => {
    reply.hijack();
    void serveGddMcp(request.raw, reply.raw).catch(() => {
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.end(JSON.stringify({error:'GDD MCP 内部错误'}));
      } else if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  },
  handler: async () => {}
});

await initDatabase();
registerWebAuth(app);
await registerRoutes(app);
startScheduler();

async function stop() {
  gddRealtime.close();
  await app.close();
  await closeDatabase();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
