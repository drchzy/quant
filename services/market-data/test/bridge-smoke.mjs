import assert from 'node:assert/strict';

const base = process.env.BRIDGE_TEST_BASE || 'http://127.0.0.1:18088';
const token = process.env.BRIDGE_TEST_TOKEN || 'ci-bridge-secret-1234567890';
async function check(method, path, payload, providedToken = token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': providedToken },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

const denied = await check('POST', '/api/v1/bridge/import', {
  type: 'index', rows: [{ code: '000001', name: '上证指数', price: 4000 }]
}, 'invalid');
assert.equal(denied.status, 401, '错误令牌必须被拒绝');

const records = [
  { type: 'snapshot', row: { code: '600186', name: '莲花控股', tradeDate: '2026-10-08', close: 12.5, open: 12.2, pct: 2.46 } },
  { type: 'daily', row: { code: '600186', name: '莲花控股', date: '2026-10-07', open: 12, close: 12.4, high: 12.7, low: 11.9 } },
  { type: 'minute', row: { code: '600186', name: '莲花控股', period: 5, tradeTime: '2026-10-08 14:55', open: 12.4, close: 12.5, high: 12.5, low: 12.3 } },
  { type: 'intraday', row: { code: '600186', tradeTime: '2026-10-08 14:55', price: 12.5, avgPrice: 12.4 } },
  { type: 'sector', row: { type: 'industry', code: 'BK0001', name: '行业示例', price: 123, pct: 1.23 } },
  { type: 'index', row: { code: '000001', name: '上证指数', price: 4000, pct: 1.2 } }
];

for (const record of records) {
  const response = await check('POST', '/api/v1/bridge/import', {
    type: record.type, rows: [record.row]
  });
  assert.equal(response.status, 200, record.type + ': ' + JSON.stringify(response.body));
  assert.equal(response.body.count, 1);
  // 重复上报必须 UPSERT 而非制造重复记录。
  const again = await check('POST', '/api/v1/bridge/import', { type: record.type, rows: [record.row] });
  assert.equal(again.status, 200, '幂等性 ' + record.type + ': ' + JSON.stringify(again.body));
}

const counts = await check('GET', '/api/v1/bridge/status');
assert.equal(counts.status, 200);
for (const name of ['daily_price', 'minute_price', 'intraday_trend', 'sector', 'market_index']) {
  assert.ok(counts.body.counts[name] >= 1, name + ' 未入库');
}
const market = await fetch(base + '/api/v1/market/overview?live=false').then(x => x.json());
assert.ok(market.indexes.find(x => x.code === '000001')?.quote?.price === 4000, '导入指数必须被市场总览读取');
const page = await fetch(base + '/bridge.html');
assert.equal(page.status, 200);
assert.match(await page.text(), /外部行情采集桥接/);

const bad = await check('POST', '/api/v1/bridge/import', {
  type: 'daily', rows: [{ code: '600186', date: '2026-20-99', close: 12.5 }]
});
assert.equal(bad.status, 400, '非法日期必须被拒绝');
console.log('PASS: token / 6 formats / idempotent UPSERT / DuckDB / invalid input / HTML');
