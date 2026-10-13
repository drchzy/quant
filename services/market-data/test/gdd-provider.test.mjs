import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  gddMarketCode, parseGddKline, parseGddTrend, fetchGddDaily,
  getGddDeviceId, invalidateGddGateway
} from '../dist/gdd.js';
import { config } from '../dist/config.js';
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

test('GDD automatically creates a stable device ID on the persistent data volume', () => {
  const previous = config.databasePath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdd-device-test-'));
  const originalDevice = process.env.GDD_DEVICE;
  try {
    delete process.env.GDD_DEVICE;
    config.databasePath = path.join(dir, 'market.duckdb');
    const first = getGddDeviceId();
    const second = getGddDeviceId();
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9-]{36}-dz_astock_gdd$/);
    assert.equal(fs.readFileSync(path.join(dir, '.gdd-device-id'), 'utf8').trim(), first);
  } finally {
    config.databasePath = previous;
    if (originalDevice === undefined) delete process.env.GDD_DEVICE;
    else process.env.GDD_DEVICE = originalDevice;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GDD rejects missing credentials without ever trying the old static gateway', async () => {
  invalidateGddGateway();
  const original = [process.env.GDD_ACCOUNT, process.env.GDD_PASSWORD, process.env.GDD_GATEWAY_URL];
  process.env.GDD_ACCOUNT = '';
  process.env.GDD_PASSWORD = '';
  process.env.GDD_GATEWAY_URL = 'http://127.0.0.1:19920/';
  try {
    await assert.rejects(fetchGddDaily('300505', 2), /未配置账号密码/);
  } finally {
    ['GDD_ACCOUNT', 'GDD_PASSWORD', 'GDD_GATEWAY_URL'].forEach((k,i) => {
      if(original[i] === undefined) delete process.env[k]; else process.env[k] = original[i];
    });
    invalidateGddGateway();
  }
});

test('GDD logs in with account/password, discovers type=36, and uses only the returned gateway', async () => {
  invalidateGddGateway();
  const originalFetch = globalThis.fetch;
  const originals = Object.fromEntries(['GDD_ACCOUNT','GDD_PASSWORD','GDD_DEVICE','GDD_GATEWAY_URL','GDD_SESSION_CODE']
    .map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    GDD_ACCOUNT: 'mock-user', GDD_PASSWORD: 'mock-password',
    GDD_DEVICE: 'mock-persisted-device-1234',
    // Even if legacy hardcoded variables remain on the host, ignore them.
    GDD_GATEWAY_URL: 'http://127.0.0.1:19920/',
    GDD_SESSION_CODE: 'stale-test-token'
  });
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    seen.push({ url: String(url), payload, headers: options.headers });
    if (String(url).endsWith('/customer/login')) {
      return new Response(JSON.stringify({ code: 0, result: { sessionCode: 'new-test-session' } }), { status: 200 });
    }
    if (String(url).endsWith('/config/query_server_info')) {
      return new Response(JSON.stringify({ code: 0, result: { sers: [
        { serverType: 1, ip: '127.0.0.2', serverPort: 4000 },
        { serverType: 36, ip: '10.20.30.40', serverPort: 19921 }
      ] } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      reqtype: 150, reqid: 1, status: 0, data: { kline: table }
    }), { status: 200 });
  };
  try {
    const rows = await fetchGddDaily('300505', 2);
    assert.equal(rows.length, 2);
    assert.equal(seen.length, 3);
    assert.match(seen[0].url, /customer\/login$/);
    assert.equal(seen[0].payload.account, 'mock-user');
    assert.equal(seen[0].payload.password, 'mock-password');
    assert.equal(seen[0].payload.device, 'mock-persisted-device-1234');
    assert.match(seen[1].url, /config\/query_server_info$/);
    assert.equal(seen[1].payload.sessionCode, 'new-test-session');
    assert.equal(seen[1].headers.sessionCode, 'new-test-session');
    assert.equal(seen[2].url, 'http://10.20.30.40:19921/');
    assert.equal(seen[2].payload.data.market, 1008);
    assert.equal(seen[2].payload.reqtype, 150);
    assert.equal(seen[2].payload.session, '');
    // The gateway is cached, so repeated requests do not re-login immediately.
    await fetchGddDaily('300505', 2);
    assert.equal(seen.filter(item => /customer\/login/.test(item.url)).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key,value] of Object.entries(originals)) {
      if(value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    invalidateGddGateway();
  }
});

test('GDD network failure triggers new login, fresh discovery and retry on the new IP', async () => {
  invalidateGddGateway();
  const originalFetch = globalThis.fetch;
  const originals = Object.fromEntries(['GDD_ACCOUNT','GDD_PASSWORD','GDD_DEVICE']
    .map(k => [k, process.env[k]]));
  process.env.GDD_ACCOUNT = 'mock-user';
  process.env.GDD_PASSWORD = 'mock-password';
  process.env.GDD_DEVICE = 'mock-persisted-device-1234';
  let logins = 0, quoteOld = 0, quoteNew = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/customer/login')) {
      logins++;
      return new Response(JSON.stringify({ code: 0, result: { sessionCode: 'new-session-' + logins } }), { status: 200 });
    }
    if (String(url).endsWith('/config/query_server_info')) {
      const ip = logins === 1 ? '10.10.10.1' : '10.10.10.2';
      return new Response(JSON.stringify({ code: 0, result: { sers: [
        { serverType: 36, ip, serverPort: 19920 }
      ] } }), { status: 200 });
    }
    if (String(url).includes('10.10.10.1')) {
      quoteOld++;
      throw new TypeError('fetch failed');
    }
    quoteNew++;
    return new Response(JSON.stringify({ reqtype: 150, status: 0, data: { kline: table } }), { status: 200 });
  };
  try {
    const rows = await fetchGddDaily('300505', 2);
    assert.equal(rows.length, 2);
    assert.equal(logins, 2);
    assert.equal(quoteOld, 1);
    assert.equal(quoteNew, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for(const [key,value] of Object.entries(originals)) {
      if(value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    invalidateGddGateway();
  }
});
