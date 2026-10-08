import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import {
  closeDatabase,
  initDatabase
} from './database.js';
import { registerRoutes } from './routes.js';
import { startScheduler } from './scheduler.js';

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

app.get('/health', async () => ({
  status: 'ok',
  service: 'trade-manager',
  marketDataUrl: config.marketDataUrl,
  stockSelectUrl: config.stockSelectUrl,
  database: config.databasePath,
  autoOrder: false,
  time: new Date().toISOString()
}));

await initDatabase();
await registerRoutes(app);
startScheduler();

async function stop() {
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
