import { randomUUID } from 'node:crypto';
import { all, one, run } from './database.js';
import {
  fetchDailyBySource,
  fetchSectorsBySource,
  fetchSnapshotBySource,
  type DataCapability,
  type DataSourceId
} from './providers.js';
import {
  getEnabledSources,
  recordSourceResult
} from './source-manager.js';
import { syncMarketIndexes } from './market.js';
import type { SectorType } from './types.js';

type JobStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';

// DuckDB 仍然只允许一个重型同步任务写入，避免并发事务抢同一个文件。
let syncQueue: Promise<void> = Promise.resolve();

// 创建任务时立刻分配 AbortController。
// 即使任务还在队列里，“停止全部”也能先把它标记为已取消。
const jobControllers = new Map<string, AbortController>();

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' ||
        /aborted|取消|cancel/i.test(error.message)))
  );
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('同步任务已取消', 'AbortError');
  }
}

function enqueueSync(
  jobId: string,
  controller: AbortController,
  task: () => Promise<void>
): void {
  syncQueue = syncQueue
    .then(async () => {
      if (controller.signal.aborted) {
        await updateJob(jobId, {
          status: 'cancelled',
          message: '任务在开始前已取消',
          finish: true
        });
        return;
      }

      await updateJob(jobId, {
        status: 'running',
        message: '任务开始执行'
      });

      await task();
    })
    .catch((error) => {
      console.error('同步任务执行失败', error);
    })
    .finally(() => {
      jobControllers.delete(jobId);
    });
}

async function createJob(
  jobType: string,
  sources: DataSourceId[]
): Promise<{ id: string; controller: AbortController }> {
  const id = randomUUID();
  const controller = new AbortController();
  jobControllers.set(id, controller);

  await run(
    `INSERT INTO sync_job
      (id, job_type, status, total, done, message, started_at, finished_at)
     VALUES (?, ?, 'queued', 0, 0, ?, now(), NULL)`,
    [
      id,
      jobType,
      sources.length > 0
        ? `等待执行；数据源：${sources.join(' → ')}`
        : '等待执行'
    ]
  );

  for (let index = 0; index < sources.length; index += 1) {
    await run(
      `INSERT INTO sync_job_source
        (job_id, source_id, priority, status, message, started_at, finished_at)
       VALUES (?, ?, ?, 'waiting', '', NULL, NULL)`,
      [id, sources[index], index + 1]
    );
  }

  return { id, controller };
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
  const current = await one<any>(
    'SELECT * FROM sync_job WHERE id = ?',
    [id]
  );
  if (!current) return;

  // 已取消的任务不允许后续异步回调重新改成 success/failed。
  if (
    current.status === 'cancelled' &&
    values.status !== 'cancelled'
  ) {
    return;
  }

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

async function updateJobSource(
  jobId: string,
  source: DataSourceId,
  values: {
    status:
      | 'waiting'
      | 'running'
      | 'success'
      | 'failed'
      | 'cancelled'
      | 'skipped';
    message?: string;
    start?: boolean;
    finish?: boolean;
  }
) {
  const current = await one<any>(
    `SELECT * FROM sync_job_source
     WHERE job_id = ? AND source_id = ?`,
    [jobId, source]
  );
  if (!current) return;

  await run(
    `UPDATE sync_job_source SET
      status = ?,
      message = ?,
      started_at = ?,
      finished_at = ?
     WHERE job_id = ? AND source_id = ?`,
    [
      values.status,
      values.message ?? current.message ?? '',
      values.start ? new Date() : current.started_at,
      values.finish ? new Date() : current.finished_at,
      jobId,
      source
    ]
  );
}

async function trySources<T>(
  jobId: string,
  capability: DataCapability,
  sources: DataSourceId[],
  signal: AbortSignal,
  request: (source: DataSourceId) => Promise<T>,
  validate: (value: T) => boolean = () => true
): Promise<{ source: DataSourceId; data: T }> {
  const errors: string[] = [];

  for (const source of sources) {
    ensureNotAborted(signal);
    const started = Date.now();

    await updateJobSource(jobId, source, {
      status: 'running',
      message: `正在请求 ${capability}`,
      start: true
    });

    try {
      const data = await request(source);
      ensureNotAborted(signal);

      if (!validate(data)) {
        throw new Error('返回数据为空或不完整');
      }

      const latencyMs = Date.now() - started;
      const count = Array.isArray(data) ? data.length : undefined;
      const message =
        `成功，耗时 ${latencyMs}ms` +
        (count === undefined ? '' : `，${count} 条`);

      await updateJobSource(jobId, source, {
        status: 'success',
        message,
        finish: true
      });

      await recordSourceResult(source, {
        status: 'success',
        capability,
        message,
        latencyMs,
        count
      });

      const sourceIndex = sources.indexOf(source);
      for (
        let index = sourceIndex + 1;
        index < sources.length;
        index += 1
      ) {
        await updateJobSource(
          jobId,
          sources[index],
          {
            status: 'skipped',
            message: '前面的数据源已成功，本次未请求',
            finish: true
          }
        );
      }

      return { source, data };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message =
        error instanceof Error ? error.message : String(error);

      if (isAbortError(error) || signal.aborted) {
        await updateJobSource(jobId, source, {
          status: 'cancelled',
          message: '请求已取消',
          finish: true
        });
        await recordSourceResult(source, {
          status: 'cancelled',
          capability,
          message: '请求已取消',
          latencyMs
        });
        throw new DOMException('同步任务已取消', 'AbortError');
      }

      errors.push(`${source}: ${message}`);

      await updateJobSource(jobId, source, {
        status: 'failed',
        message,
        finish: true
      });

      await recordSourceResult(source, {
        status: 'failed',
        capability,
        message,
        latencyMs
      });
    }
  }

  throw new Error(
    `所有 ${capability} 数据源均失败：${errors.join('；')}`
  );
}

function getMarketName(code: string, market: number): string {
  if (/^(4|8|92)/.test(code)) return '北京';
  return market === 1 ? '上海' : '深圳';
}

async function saveStock(item: {
  code: string;
  name: string;
  market: number;
}): Promise<void> {
  await run(
    `INSERT OR REPLACE INTO stock
      (code, name, market, market_name, updated_at)
     VALUES (?, ?, ?, ?, now())`,
    [
      item.code,
      item.name,
      item.market,
      getMarketName(item.code, item.market)
    ]
  );
}

async function saveDaily(
  item: any,
  tradeDate: string,
  source: string
): Promise<void> {
  await run(
    `INSERT INTO daily_price (
      code, trade_date, open, close, high, low, pre_close,
      volume, amount, pct, change, amplitude, turnover,
      pe, pb, volume_ratio, total_market_cap, float_market_cap,
      source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
    ON CONFLICT (code, trade_date) DO UPDATE SET
      open = COALESCE(excluded.open, daily_price.open),
      close = COALESCE(excluded.close, daily_price.close),
      high = COALESCE(excluded.high, daily_price.high),
      low = COALESCE(excluded.low, daily_price.low),
      pre_close = COALESCE(excluded.pre_close, daily_price.pre_close),
      volume = COALESCE(excluded.volume, daily_price.volume),
      amount = COALESCE(excluded.amount, daily_price.amount),
      pct = COALESCE(excluded.pct, daily_price.pct),
      change = COALESCE(excluded.change, daily_price.change),
      amplitude = COALESCE(excluded.amplitude, daily_price.amplitude),
      turnover = COALESCE(excluded.turnover, daily_price.turnover),
      pe = COALESCE(excluded.pe, daily_price.pe),
      pb = COALESCE(excluded.pb, daily_price.pb),
      volume_ratio = COALESCE(excluded.volume_ratio, daily_price.volume_ratio),
      total_market_cap = COALESCE(excluded.total_market_cap, daily_price.total_market_cap),
      float_market_cap = COALESCE(excluded.float_market_cap, daily_price.float_market_cap),
      source = excluded.source,
      updated_at = now()`,
    [
      item.code,
      tradeDate,
      item.open ?? null,
      item.close ?? item.price ?? null,
      item.high ?? null,
      item.low ?? null,
      item.preClose ?? item.pre_close ?? null,
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

async function resolveSources(
  capability: DataCapability,
  override?: string[]
): Promise<DataSourceId[]> {
  return getEnabledSources(capability, override);
}

/**
 * 同步当天全市场快照。
 * 多数据源按用户排序逐个尝试，第一个成功即写入，不会重复覆盖同一批数据。
 */
export async function syncDailyMarket(
  sourceOverride: string[] = []
): Promise<string> {
  const sources = await resolveSources(
    'snapshot',
    sourceOverride
  );
  const { id: jobId, controller } = await createJob(
    'daily',
    sources
  );

  enqueueSync(jobId, controller, async () => {
    try {
      ensureNotAborted(controller.signal);

      const result = await trySources(
        jobId,
        'snapshot',
        sources,
        controller.signal,
        (source) =>
          fetchSnapshotBySource(
            source,
            controller.signal
          ),
        (rows) => Array.isArray(rows) && rows.length > 100
      );

      ensureNotAborted(controller.signal);

      let tradeDate: string;
      try {
        // 使用启用的日K数据源判断交易日，禁止暗中访问东财。
        const dailySources = await getEnabledSources('daily');
        let resolvedDate: string | null = null;
        for (const source of dailySources) {
          try {
            const bars = await fetchDailyBySource(source, '600000', 5, controller.signal);
            const date = bars.at(-1)?.date?.slice(0, 10);
            if (date) {
              resolvedDate = date;
              break;
            }
          } catch (error) {
            if (controller.signal.aborted) throw error;
          }
        }
        if (!resolvedDate) throw new Error('已启用的数据源无法确定交易日');
        tradeDate = resolvedDate;
      } catch {
        // 快照源已经成功时，即使交易日日历接口临时失败，也允许按上海时区当天落库。
        tradeDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai'
        }).format(new Date());
      }

      const stocks = result.data;

      await updateJob(jobId, {
        total: stocks.length,
        message:
          `使用 ${result.source}；交易日 ${tradeDate}；准备保存 ${stocks.length} 条`
      });

      let done = 0;
      await run('BEGIN TRANSACTION');

      try {
        for (const item of stocks) {
          ensureNotAborted(controller.signal);
          await saveStock(item);
          await saveDaily(
            item,
            tradeDate,
            result.source
          );
          done += 1;

          if (done % 100 === 0 || done === stocks.length) {
            await updateJob(jobId, {
              done,
              message:
                `使用 ${result.source}，正在保存 ${done}/${stocks.length}`
            });
          }
        }
        await run('COMMIT');
      } catch (error) {
        await run('ROLLBACK');
        throw error;
      }

      ensureNotAborted(controller.signal);
      await syncIndexes(controller.signal);

      await updateJob(jobId, {
        status: 'success',
        done,
        message:
          `完成 ${tradeDate} 全市场同步；数据源 ${result.source}`,
        finish: true
      });
    } catch (error) {
      const cancelled =
        isAbortError(error) || controller.signal.aborted;

      await updateJob(jobId, {
        status: cancelled ? 'cancelled' : 'failed',
        message: cancelled
          ? '已停止同步'
          : error instanceof Error
            ? error.message
            : String(error),
        finish: true
      });
    }
  });

  return jobId;
}

/**
 * 板块源目前只有东财行情接口具备完整行业/概念列表。
 * 仍通过统一数据源配置管理，未来增加新板块源不需要改页面。
 */
export async function syncSectors(
  sourceOverride: string[] = []
): Promise<string> {
  const sources = await resolveSources(
    'sector',
    sourceOverride
  );
  const { id: jobId, controller } = await createJob(
    'sector',
    sources
  );

  enqueueSync(jobId, controller, async () => {
    try {
      const result = await trySources(
        jobId,
        'sector',
        sources,
        controller.signal,
        async (source) => {
          const types: SectorType[] = [
            'industry',
            'concept'
          ];
          const rows: any[] = [];

          for (const type of types) {
            ensureNotAborted(controller.signal);
            rows.push(
              ...(await fetchSectorsBySource(
                source,
                type,
                controller.signal
              ))
            );
          }

          return rows;
        },
        (rows) => Array.isArray(rows) && rows.length > 0
      );

      const rows = result.data;
      await updateJob(jobId, {
        total: rows.length,
        message:
          `使用 ${result.source}；准备保存 ${rows.length} 个板块`
      });

      let done = 0;
      await run('BEGIN TRANSACTION');

      try {
        for (const item of rows) {
          ensureNotAborted(controller.signal);
          await run(
            `INSERT OR REPLACE INTO sector
              (type, code, name, price, pct, main_inflow, up_count, down_count, lead_stock, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
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

        await run('COMMIT');
      } catch (error) {
        await run('ROLLBACK');
        throw error;
      }

      await updateJob(jobId, {
        status: 'success',
        done,
        message:
          `完成 ${done} 个板块同步；数据源 ${result.source}`,
        finish: true
      });
    } catch (error) {
      const cancelled =
        isAbortError(error) || controller.signal.aborted;

      await updateJob(jobId, {
        status: cancelled ? 'cancelled' : 'failed',
        message: cancelled
          ? '已停止同步'
          : error instanceof Error
            ? error.message
            : String(error),
        finish: true
      });
    }
  });

  return jobId;
}

/**
 * 历史日K逐只股票同步。
 * 每只股票都按同一数据源优先级尝试，例如：
 * 腾讯 → 东财历史 → Tushare。
 */
export async function syncHistory(
  days = 120,
  codes: string[] = [],
  sourceOverride: string[] = []
): Promise<string> {
  const sources = await resolveSources(
    'daily',
    sourceOverride
  );
  const { id: jobId, controller } = await createJob(
    'history',
    sources
  );

  enqueueSync(jobId, controller, async () => {
    try {
      let stocks = codes.length
        ? codes.map((code) => ({ code }))
        : await all<{ code: string }>(
            'SELECT code FROM stock ORDER BY code'
          );

      if (stocks.length === 0) {
        const snapshotSources = await resolveSources(
          'snapshot'
        );
        const snapshot = await trySources(
          jobId,
          'snapshot',
          snapshotSources,
          controller.signal,
          (source) =>
            fetchSnapshotBySource(
              source,
              controller.signal
            ),
          (rows) => Array.isArray(rows) && rows.length > 100
        );

        for (const item of snapshot.data) {
          ensureNotAborted(controller.signal);
          await saveStock(item);
        }

        stocks = snapshot.data.map((item) => ({
          code: item.code
        }));
      }

      await updateJob(jobId, {
        total: stocks.length,
        message:
          `初始化最近 ${days} 个交易日日K；顺序 ${sources.join(' → ')}`
      });

      let done = 0;
      let failed = 0;
      const sourceStats = new Map<
        DataSourceId,
        { success: number; failed: number }
      >(
        sources.map((source) => [
          source,
          { success: 0, failed: 0 }
        ])
      );

      for (const source of sources) {
        await updateJobSource(jobId, source, {
          status: 'running',
          message: '历史日K任务进行中',
          start: true
        });
      }

      for (const stock of stocks) {
        ensureNotAborted(controller.signal);

        let selectedSource: DataSourceId | null = null;
        let rows: any[] = [];
        const errors: string[] = [];

        for (const source of sources) {
          ensureNotAborted(controller.signal);
          const started = Date.now();

          try {
            rows = await fetchDailyBySource(
              source,
              stock.code,
              days,
              controller.signal
            );

            if (rows.length === 0) {
              throw new Error('日K返回为空');
            }

            selectedSource = source;
            const stat = sourceStats.get(source);
            if (stat) stat.success += 1;

            await recordSourceResult(source, {
              status: 'success',
              capability: 'daily',
              message: `${stock.code} 日K成功`,
              latencyMs: Date.now() - started,
              count: rows.length
            });
            break;
          } catch (error) {
            if (
              isAbortError(error) ||
              controller.signal.aborted
            ) {
              throw new DOMException(
                '同步任务已取消',
                'AbortError'
              );
            }

            const message =
              error instanceof Error
                ? error.message
                : String(error);
            errors.push(`${source}: ${message}`);
            const stat = sourceStats.get(source);
            if (stat) stat.failed += 1;

            await recordSourceResult(source, {
              status: 'failed',
              capability: 'daily',
              message,
              latencyMs: Date.now() - started
            });
          }
        }

        if (!selectedSource) {
          failed += 1;
          console.warn(
            `${stock.code} 所有日K数据源失败：${errors.join('；')}`
          );
        } else {
          await run('BEGIN TRANSACTION');
          try {
            for (const item of rows) {
              ensureNotAborted(controller.signal);
              await saveDaily(
                {
                  code: stock.code,
                  open: item.open,
                  close: item.close,
                  high: item.high,
                  low: item.low,
                  preClose: item.preClose,
                  volume: item.volume,
                  amount: item.amount,
                  pct: item.pct,
                  change: item.change,
                  amplitude: item.amplitude,
                  turnover: item.turnover
                },
                item.date.slice(0, 10),
                selectedSource
              );
            }
            await run('COMMIT');
          } catch (error) {
            await run('ROLLBACK');
            throw error;
          }
        }

        done += 1;

        if (done % 20 === 0 || done === stocks.length) {
          await updateJob(jobId, {
            done,
            message:
              `历史日K ${done}/${stocks.length}；失败 ${failed}；顺序 ${sources.join(' → ')}`
          });
        }

        // 如果开头连续大面积失败，尽早终止，避免所有外部源异常时仍扫完整市场。
        if (done >= 10 && failed === done) {
          throw new Error(
            '前10只股票所有历史数据源均失败，已停止任务，请先在数据源管理中逐个测试'
          );
        }
      }

      for (const source of sources) {
        const stat = sourceStats.get(source)!;
        await updateJobSource(jobId, source, {
          status:
            stat.success > 0
              ? 'success'
              : stat.failed > 0
                ? 'failed'
                : 'skipped',
          message:
            `成功 ${stat.success} 只，失败 ${stat.failed} 只`,
          finish: true
        });
      }

      await updateJob(jobId, {
        status: 'success',
        done,
        message:
          `历史日K初始化完成，共处理 ${done} 只，失败 ${failed} 只`,
        finish: true
      });
    } catch (error) {
      const cancelled =
        isAbortError(error) || controller.signal.aborted;

      await updateJob(jobId, {
        status: cancelled ? 'cancelled' : 'failed',
        message: cancelled
          ? '已停止同步'
          : error instanceof Error
            ? error.message
            : String(error),
        finish: true
      });
    }
  });

  return jobId;
}

export async function syncIndexes(signal?: AbortSignal): Promise<void> {
  await syncMarketIndexes(signal);
}

/**
 * 立即取消所有排队和运行中的同步。
 * AbortController 会中止当前 HTTP 请求，任务循环也会在下一步立即停止。
 */
export async function stopAllSyncs() {
  const ids = [...jobControllers.keys()];

  for (const controller of jobControllers.values()) {
    controller.abort();
  }

  await run(
    `UPDATE sync_job
     SET status = 'cancelled',
         message = '用户一键停止全部同步',
         finished_at = now()
     WHERE status IN ('queued', 'running')`
  );

  await run(
    `UPDATE sync_job_source
     SET status = 'cancelled',
         message = CASE
           WHEN message IS NULL OR message = '' THEN '用户一键停止全部同步'
           ELSE message
         END,
         finished_at = now()
     WHERE status IN ('waiting', 'running')`
  );

  return {
    stopped: ids.length,
    jobIds: ids
  };
}

export async function getJobs(limit = 50) {
  const jobs = await all<any>(
    `SELECT * FROM sync_job
     ORDER BY started_at DESC
     LIMIT ?`,
    [limit]
  );

  for (const job of jobs) {
    job.sources = await all<any>(
      `SELECT source_id, priority, status, message, started_at, finished_at
       FROM sync_job_source
       WHERE job_id = ?
       ORDER BY priority`,
      [job.id]
    );
  }

  return jobs;
}
