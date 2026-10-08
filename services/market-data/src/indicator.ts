interface DailyRow {
  close: number;
  high: number;
  volume: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

/**
 * 计算页面和 AI 常用的简单技术指标。
 * 这里只返回客观指标，不在数据服务中直接生成买卖结论。
 */
export function calculateIndicators(rows: DailyRow[]) {
  const valid = rows.filter((row) => Number.isFinite(Number(row.close)));
  if (valid.length === 0) {
    return {
      ma5: null,
      ma10: null,
      ma20: null,
      return5: null,
      return20: null,
      high20: null,
      volumeRate5: null,
      closeToMa5: null
    };
  }

  const closes = valid.map((row) => Number(row.close));
  const volumes = valid.map((row) => Number(row.volume || 0));
  const close = closes.at(-1)!;

  const ma5 = average(closes.slice(-5));
  const ma10 = average(closes.slice(-10));
  const ma20 = average(closes.slice(-20));

  const return5 =
    closes.length >= 6
      ? (close / closes[closes.length - 6] - 1) * 100
      : null;

  const return20 =
    closes.length >= 21
      ? (close / closes[closes.length - 21] - 1) * 100
      : null;

  const last20 = valid.slice(-20);
  const high20 =
    last20.length > 0
      ? Math.max(...last20.map((row) => Number(row.high)))
      : null;

  const previous5Volume = average(volumes.slice(-6, -1));
  const volumeRate5 =
    previous5Volume && previous5Volume > 0
      ? volumes.at(-1)! / previous5Volume
      : null;

  const closeToMa5 =
    ma5 && ma5 > 0 ? (close / ma5 - 1) * 100 : null;

  return {
    ma5: round(ma5),
    ma10: round(ma10),
    ma20: round(ma20),
    return5: round(return5),
    return20: round(return20),
    high20: round(high20),
    volumeRate5: round(volumeRate5),
    closeToMa5: round(closeToMa5)
  };
}
