import { all, one, run } from './database.js';
import {
  dataSourceDefinitions,
  testDataSource,
  type DataCapability,
  type DataSourceId
} from './providers.js';

interface SourceSettingRow {
  source_id: DataSourceId;
  enabled: boolean;
  priority: number;
}

interface SourceStatusRow {
  source_id: DataSourceId;
  last_status: string | null;
  last_capability: string | null;
  last_message: string | null;
  last_latency_ms: number | null;
  last_count: number | null;
  last_test_at: unknown;
  last_success_at: unknown;
  last_failure_at: unknown;
}

export async function ensureSourceSettings(): Promise<void> {
  for (const source of dataSourceDefinitions) {
    const exists = await one<{ source_id: string }>(
      'SELECT source_id FROM data_source_setting WHERE source_id = ?',
      [source.id]
    );

    if (!exists) {
      await run(
        `INSERT INTO data_source_setting
          (source_id, enabled, priority, updated_at)
         VALUES (?, ?, ?, current_timestamp)`,
        [
          source.id,
          source.defaultEnabled,
          source.defaultPriority
        ]
      );
    }
  }
}

export async function getSourceSettings() {
  await ensureSourceSettings();

  const settings = await all<SourceSettingRow>(
    `SELECT source_id, enabled, priority
     FROM data_source_setting
     ORDER BY priority, source_id`
  );

  const statuses = await all<SourceStatusRow>(
    'SELECT * FROM data_source_status'
  );
  const statusMap = new Map(
    statuses.map((row) => [row.source_id, row])
  );
  const settingMap = new Map(
    settings.map((row) => [row.source_id, row])
  );

  return dataSourceDefinitions
    .map((definition) => {
      const setting = settingMap.get(definition.id);
      const status = statusMap.get(definition.id);

      return {
        ...definition,
        enabled:
          setting?.enabled ?? definition.defaultEnabled,
        priority:
          Number(setting?.priority) || definition.defaultPriority,
        available:
          !definition.needsToken ||
          !!String(process.env.TUSHARE_TOKEN || '').trim(),
        status: status
          ? {
              lastStatus: status.last_status,
              lastCapability: status.last_capability,
              lastMessage: status.last_message,
              lastLatencyMs: status.last_latency_ms,
              lastCount: status.last_count,
              lastTestAt: status.last_test_at,
              lastSuccessAt: status.last_success_at,
              lastFailureAt: status.last_failure_at
            }
          : null
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

export async function saveSourceSettings(
  sources: Array<{
    id: DataSourceId;
    enabled: boolean;
    priority: number;
  }>
): Promise<void> {
  const known = new Set(
    dataSourceDefinitions.map((item) => item.id)
  );

  if (sources.length === 0) {
    throw new Error('至少需要保留一个数据源配置');
  }

  for (const item of sources) {
    if (!known.has(item.id)) {
      throw new Error(`未知数据源：${item.id}`);
    }
  }

  await run('BEGIN TRANSACTION');
  try {
    for (const item of sources) {
      await run(
        `INSERT INTO data_source_setting
          (source_id, enabled, priority, updated_at)
         VALUES (?, ?, ?, current_timestamp)
         ON CONFLICT (source_id) DO UPDATE SET
           enabled = excluded.enabled,
           priority = excluded.priority,
           updated_at = current_timestamp`,
        [
          item.id,
          !!item.enabled,
          Math.max(1, Math.floor(item.priority))
        ]
      );
    }
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

export async function getEnabledSources(
  capability: DataCapability,
  override?: string[]
): Promise<DataSourceId[]> {
  const sources = await getSourceSettings();
  const allowed = new Set<DataSourceId>(
    sources
      .filter(
        (source) =>
          source.enabled &&
          source.available &&
          source.capabilities.includes(capability)
      )
      .map((source) => source.id)
  );

  if (override && override.length > 0) {
    const ordered: DataSourceId[] = [];

    for (const raw of override) {
      const source = raw as DataSourceId;
      const definition = dataSourceDefinitions.find(
        (item) => item.id === source
      );

      if (!definition) {
        throw new Error(`未知数据源：${raw}`);
      }
      if (!definition.capabilities.includes(capability)) {
        continue;
      }
      if (definition.needsToken &&
          !String(process.env.TUSHARE_TOKEN || '').trim()) {
        continue;
      }
      if (!ordered.includes(source)) ordered.push(source);
    }

    if (ordered.length === 0) {
      throw new Error(
        `选择的数据源均不支持 ${capability} 或当前不可用`
      );
    }

    return ordered;
  }

  const ordered = sources
    .filter((source) => allowed.has(source.id))
    .map((source) => source.id);

  if (ordered.length === 0) {
    throw new Error(`没有启用可用的 ${capability} 数据源`);
  }

  return ordered;
}

export async function recordSourceResult(
  source: DataSourceId,
  values: {
    status: 'success' | 'failed' | 'cancelled';
    capability: DataCapability;
    message: string;
    latencyMs?: number;
    count?: number;
    tested?: boolean;
  }
): Promise<void> {
  const successAt =
    values.status === 'success' ? new Date() : null;
  const failureAt =
    values.status === 'failed' ? new Date() : null;
  const testAt = values.tested ? new Date() : null;

  await run(
    `INSERT INTO data_source_status (
      source_id,
      last_status,
      last_capability,
      last_message,
      last_latency_ms,
      last_count,
      last_test_at,
      last_success_at,
      last_failure_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
    ON CONFLICT (source_id) DO UPDATE SET
      last_status = excluded.last_status,
      last_capability = excluded.last_capability,
      last_message = excluded.last_message,
      last_latency_ms = excluded.last_latency_ms,
      last_count = excluded.last_count,
      last_test_at = COALESCE(excluded.last_test_at, data_source_status.last_test_at),
      last_success_at = COALESCE(excluded.last_success_at, data_source_status.last_success_at),
      last_failure_at = COALESCE(excluded.last_failure_at, data_source_status.last_failure_at),
      updated_at = current_timestamp`,
    [
      source,
      values.status,
      values.capability,
      values.message,
      values.latencyMs ?? null,
      values.count ?? null,
      testAt,
      successAt,
      failureAt
    ]
  );
}

export async function testSource(
  source: DataSourceId,
  capability?: DataCapability
) {
  const definition = dataSourceDefinitions.find(
    (item) => item.id === source
  );

  if (!definition) {
    throw new Error(`未知数据源：${source}`);
  }

  if (
    definition.needsToken &&
    !String(process.env.TUSHARE_TOKEN || '').trim()
  ) {
    const message = '未配置 TUSHARE_TOKEN';
    await recordSourceResult(source, {
      status: 'failed',
      capability: targetCapability,
      message,
      tested: true
    });
    throw new Error(message);
  }

  if (
    capability &&
    !definition.capabilities.includes(capability)
  ) {
    throw new Error(
      definition.name + ' 不支持 ' + capability
    );
  }

  const targetCapability =
    capability || definition.capabilities[0];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const started = Date.now();

  try {
    const result = await testDataSource(
      source,
      targetCapability,
      controller.signal
    );
    const latencyMs = Date.now() - started;
    const message =
      `测试成功，${result.capability} 返回 ${result.count} 条`;

    await recordSourceResult(source, {
      status: 'success',
      capability: result.capability,
      message,
      latencyMs,
      count: result.count,
      tested: true
    });

    return {
      source,
      sourceName: definition.name,
      success: true,
      latencyMs,
      ...result,
      message
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message =
      error instanceof Error ? error.message : String(error);

    await recordSourceResult(source, {
      status: controller.signal.aborted ? 'cancelled' : 'failed',
      capability: definition.capabilities[0],
      message,
      latencyMs,
      tested: true
    });

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
