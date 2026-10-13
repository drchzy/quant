import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gddMarketCode, parseGddKline, parseGddTrend, fetchGddDaily
} from '../dist/gdd.js';
import { dataSourceDefinitions } from '../dist/providers.js';

const table = [
  ['date', 'open', 'high', 'low', 'close', 'volume', 'amount'],
  ['2026-10-13 0:0:0', 10, 11, 9, 10.5, 12345, 456789],
  ['2026-10-12 0:0:0', 9.5, 10, 9, 9.8, 1000, 23456]
];

test('GDD defaults disabled without disrupting Sina / Tencent priority', () => {
  const gdd = dataSourceDefinitions.find((x) => x.id === 'gdd');
  assert.ok(gdd);
  assert.equal(gdd.defaultEnabled, false);
  assert.deepEqual(gdd.capabilities, ['daily', 'minute']);
  const sina = dataSourceDefinitions.find((x) => x.id === 'sina');
  const tencent = dataSourceDefinitions.find((x) => x.id === 'tencent');
  assert.ok(sina.defaultPriority < tencent.defaultPriority);
  assert.ok(tencent.defaultPriority < gdd.defaultPriority);
});

test('GDD uses marketCode not marketId and disallows unverified BSE codes', () => {
  assert.equal(gddMarketCode('300505'), 1008);
  assert.equal(gddMarketCode('300605'), 1008);
  assert.equal(gddMarketCode('000001'), 1001);
  assert.equal(gddMarketCode('600000'), 1);
  assert.throws(() => gddMarketCode('830799'), /暂不支持/);
});

test('GDD parses K line header, sorts and validates before persisting', () => {
  const bars = parseGddKline(table, 10);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].date, '2026-10-12');
  assert.equal(bars[1].close, 10.5);
  assert.equal(bars[1].volume, 12345);
  assert.throws(() => parseGddKline([
    ['date', 'open', 'high', 'low', 'close', 'volume'],
    ['2026-10-13', 10, 9, 8, 11, 100]
  ], 5), /OHLC/);
  assert.throws(() => parseGddKline([
    ['date', 'close'], ['2026-10-13', 10]
  ], 5), /表头/);
});

test('GDD parses verified trend envelope and preserves previous close', () => {
  const rows = parseGddTrend({
    prevclose: 10,
    trend: [['time', 'price', 'avgPrice', 'volume', 'amount'],
      ['09:30:00', 10.5, 10.2, 30, 300]]
  }, '2026-10-13');
  assert.equal(rows[0].datetime, '2026-10-13 09:30:00');
  assert.equal(rows[0].pct, 5);
  assert.equal(rows[0].avgPrice, 10.2);
  // 返回为整数分钟时，老协议采用 UTC 日期分钟偏移（90即北京时间09:30）。
  const numericRows = parseGddTrend({
    prevclose: 10,
    trend: [['time', 'price', 'avg', 'volume', 'amount'],
      [90, 10.5, 10.2, 30, 300], [420, 10.6, 10.3, 45, 600]]
  }, '2026-10-13');
  assert.equal(numericRows[0].datetime, '2026-10-13 09:30:00');
  assert.equal(numericRows[1].datetime, '2026-10-13 15:00:00');
});

test('GDD discovers type=36 gateway, then sends reqtype=150 with session empty', async () => {
  const original = globalThis.fetch;
  process.env.GDD_SESSION_CODE = 'test-only-session';
  process.env.GDD_GATEWAY_URL = 'http://127.0.0.1:19920/';
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    seen.push({ url: String(url), payload, headers: options.headers });
    if (String(url).includes('query_server_info')) {
      return new Response(JSON.stringify({ code: 0, result: { sers: [
        { serverType: 1, ip: '127.0.0.2', serverPort: 4000 },
        { serverType: 36, ip: '8.129.13.151', serverPort: 19920 }
      ] } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      reqtype: 150, reqid: 1, status: 0, data: { kline: table }
    }), { status: 200 });
  };
  try {
    const rows = await fetchGddDaily('300505', 2);
    assert.equal(rows.length, 2);
    assert.match(seen[0].url, /config\/query_server_info$/);
    assert.equal(seen[0].headers.sessionCode, 'test-only-session');
    assert.equal(seen[1].url, 'http://8.129.13.151:19920/');
    assert.equal(seen[1].payload.data.market, 1008);
    assert.equal(seen[1].payload.reqtype, 150);
    assert.equal(seen[1].payload.session, '');
  } finally {
    globalThis.fetch = original;
    delete process.env.GDD_SESSION_CODE;
    delete process.env.GDD_GATEWAY_URL;
  }
});
