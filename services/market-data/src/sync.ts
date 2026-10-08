import { randomUUID } from 'node:crypto';
import { all, one, run } from './database.js';
import {
  buildSecid,
  eastmoney,
  getLatestTradeDate,
  getMarketStocks,
  getSectors,
  mainIndexes
} from './eastmoney.js';
import type { SectorType } from './types.js';

type JobStatus = 'running' | 'success' | 'failed';

async function createJob(jobType: string): Promise<string> {
  const id = randomUUID();
  await run(
    `INSERT INTO sync_job
      (id, job_type, status, total, done, message, started_at, finished_at)
     VALUES (?, ?, 'running', 0, 0, '', current_timestamp, NULL)`,
    [id, jobType]
  );
  return id;
}

async function updateJob(
  id: string,
  values: {
    status?: JobStatus;
    total?: number;
    done?: number;
    message?: string;
    finish?: boolean;
  }
): Promise<void> {
  const current = await one<any>('SELECT * FROM sync_job WHERE id = ?', [id]);
  if (!current) return;

  await run(
    `UPDATE sync_job SET
      status = ?,
      total = ?,
      done = ?,
      message = ?,
      finished_at = ?
     WHERE id = ?`,
    [
      values.status ?? current.status,
      values.total ?? current.total,
      values.done ?? current.done,
      values.message ?? current.message ?? '',
      values.finish ? new Date() : current.finished_at,
      id
    ]
  );
}

async function saveStock(item: {
  code: string;
  name: string;
  market: number;
}): Promise<void> {
  await run(
    `INSERT OR REPLACE INTO stock
      (code, name, market, market_name, updated_at)
     VALUES (?, ?, ?, ?, current_timestamp)`,
    [item.code, item.name, item.market, item.market === 1 ? '上海' : '深圳']
  );
}

async function saveDaily(
  item: any,
  tradeDate: string,
  source = 'eastmoney'
): Promise<void> {
  await run(
    `INSERT OR REPLACE INTO daily_price (
      code, trade_date, open, close, high, low, pre_close,
      volume, amount, pct, change, amplitude, turnover,
      pe, pb, volume_ratio, total_market_cap, float_market_cap,
      source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)`,
    [
      item.code,
      tradeDate,
      item.open ?? null,
      item.close ?? item.price ?? null,
      item.high ?? null,
      item.low ?? null,
      item.preClose ?? null,
      item.volume ?? null,
      item.amount ?? null,
      item.pct ?? null,
      item.change ?? null,
      item.amplitude ?? null,
      item.turnover ?? null,
      item.pe ?? null,
      item.pb ?? null,
      item.volumeRatio ?? null,
      item.totalMarketCap ?? null,
      item.floatMarketCap ?? null,
      source
    ]
  );
}

/**
 * 同步当天全市场基础行情。
 * 这一步用东财分页列表，不会逐只请求 5000 多只股票。
 */
export async function syncDailyMarket(): Promise<string> {
  const jobId = await createJob('daily');

  void (async () => {
    try {
      const [stocks, tradeDate] = await Promise.all([
        getMarketStocks(),
        getLatestTradeDate()
      ]);

      await updateJob(jobId, {
        total: stocks.length,
        message: `最新交易日 ${tradeDate}`
      });

      let done = 0;
      for (const item of stocks) {
        await saveStock(item);
        await saveDaily(item, tradeDate);
        done += 1;

        if (done % 100 === 0 || done === stocks.length) {
          await updateJob(jobId, {
            done,
            message: `正在保存 ${done}/${stocks.length}`
          });
        }
      }

      await syncIndexes();

      await updateJob(jobId, {
        status: 'success',
        done,
        message: `完成 ${tradeDate} 全市场同步`,
        finish: true
      });
    } catch (error) {
      await updateJob(jobId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        finish: true
      });
    }
  })();

  return jobId;
}

export async function syncSectors(): Promise<string> {
  const jobId = await createJob('sector');

  void (async () => {
    try {
      const types: SectorType[] = ['industry', 'concept'];
      const groups = await Promise.all(types.map((type) => getSectors(type)));
      const total = groups.reduce((sum, rows) => sum + rows.length, 0);

      await updateJob(jobId, { total });

      let done = 0;
      for (const rows of groups) {
        for (const item of rows) {
          await run(
            `INSERT OR REPLACE INTO sector
              (type, code, name, price, pct, main_inflow, up_count, down_count, lead_stock, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)`,
            [
              item.type,
              item.code,
              item.name,
              item.price,
              item.pct,
              item.mainInflow,
              item.upCount,
              item.downCount,
              item.leadStock
            ]
          );
          done += 1;
        }
      }

      await updateJob(jobId, {
        status: 'success',
        done,
        message: `完成 ${done} 个板块同步`,
        finish: true
      });
    } catch (error) {
      await updateJob(jobId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        finish: true
      });
    }
  })();

  return jobId;
}

/**
 * 第一次初始化历史日 K 时逐只股票执行。
 * 默认顺序执行，速度会慢一些，但更不容易触发东财限流。
 */
export async function syncHistory(
  days = 120,
  codes: string[] = []
): Promise<string> {
  const jobId = await createJob('history');

  void (async () => {
    try {
      let stocks = codes.length
        ? codes.map((code) => ({ code }))
        : await all<{ code: string }>('SELECT code FROM stock ORDER BY code');

      if (stocks.length === 0) {
        const marketStocks = await getMarketStocks();
        for (const item of marketStocks) await saveStock(item);
        stocks = marketStocks.map((item) => ({ code: item.code }));
      }

      await updateJob(jobId, {
        total: stocks.length,
        message: `初始化最近 ${days} 个交易日日 K`
      });

      let done = 0;

      for (const stock of stocks) {
        try {
          const rows = await eastmoney.dailyKline(
            buildSecid(stock.code),
            days,
            1
          );

          for (const item of rows) {
            await saveDaily(
              {
                code: stock.code,
                open: item.open,
                close: item.close,
                high: item.high,
                low: item.low,
                volume: item.volume,
                amount: item.amount,
                pct: item.pct,
                change: item.change,
                amplitude: item.amplitude,
                turnover: item.turnover
              },
              item.date.slice(0, 10),
              'eastmoney-kline'
            );
          }
        } catch (error) {
          // 单只股票失败不终止全市场任务，避免一次网络抖动导致前功尽弃。
          console.error(`同步 ${stock.code} 历史日 K 失败`, error);
        }

        done += 1;
        if (done % 20 === 0 || done === stocks.length) {
          await updateJob(jobId, {
            done,
            message: `正在同步 ${done}/${stocks.length}`
          });
        }
      }

      await updateJob(jobId, {
        status: 'success',
        done,
        message: `历史日 K 初始化完成，共处理 ${done} 只股票`,
        finish: true
      });
    } catch (error) {
      await updateJob(jobId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        finish: true
      });
    }
  })();

  return jobId;
}

export async function syncIndexes(): Promise<void> {
  for (const item of mainIndexes) {
    const quote = await eastmoney.quote(item.secid);
    if (!quote) continue;

    await run(
      `INSERT OR REPLACE INTO market_index
        (code, name, price, open, high, low, pre_close, pct, change, volume, amount, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)`,
      [
        item.code,
        item.name,
        quote.price,
        quote.open,
        quote.high,
        quote.low,
        quote.preClose,
        quote.pct,
        quote.change,
        quote.volume,
        quote.amount
      ]
    );
  }
}

export async function getJobs(limit = 50) {
  return all(
    `SELECT * FROM sync_job
     ORDER BY started_at DESC
     LIMIT ?`,
    [limit]
  );
}
