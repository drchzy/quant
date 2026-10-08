import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataSourceDefinitions,
  fetchIndexesBySource,
  fetchStockQuoteBySource
} from '../dist/providers.js';

const item = { code: '000001', secid: '1.000001' };

async function withMock(body, check) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status: 200 });
  try {
    await check();
  } finally {
    globalThis.fetch = previous;
  }
}

test('source capabilities filter snapshot from K-line and include index/quote', () => {
  const sina = dataSourceDefinitions.find((x) => x.id === 'sina');
  const tencent = dataSourceDefinitions.find((x) => x.id === 'tencent');
  assert.ok(sina.capabilities.includes('snapshot'));
  assert.ok(!tencent.capabilities.includes('snapshot'));
  for (const source of [sina, tencent]) {
    assert.ok(source.capabilities.includes('index'));
    assert.ok(source.capabilities.includes('quote'));
  }
  assert.ok(sina.defaultPriority < tencent.defaultPriority);
});

test('Sina index quote parses price, change and pct', async () => {
  await withMock('var hq_str_s_sh000001="上证指数,4000.50,10.50,0.26,12345,67890";', async () => {
    const result = await fetchIndexesBySource('sina', [item]);
    assert.equal(result.get('000001')?.price, 4000.5);
    assert.equal(result.get('000001')?.pct, 0.26);
  });
});

test('Tencent index quote parses realtime quote fields', async () => {
  const fields = Array(39).fill('0');
  fields[3] = '4001.25';
  fields[4] = '3990.00';
  await withMock('v_sh000001="1~上证指数~000001~' + fields.slice(3).join('~') + '";', async () => {
    const result = await fetchIndexesBySource('tencent', [item]);
    assert.equal(result.get('000001')?.price, 4001.25);
    assert.ok((result.get('000001')?.pct || 0) > 0);
  });
});

test('Tencent individual quote has valid price and percent', async () => {
  const fields = Array(40).fill('0');
  fields[0] = '1';
  fields[1] = '股票';
  fields[2] = '600186';
  fields[3] = '12.50';
  fields[4] = '12.00';
  const response = 'v_sh600186="' + fields.join('~') + '";';
  await withMock(response, async () => {
    const result = await fetchStockQuoteBySource('tencent', '600186');
    assert.equal(result.price, 12.5);
    assert.ok(result.pct > 4);
  });
});

test('Sina individual quote has valid price and percent', async () => {
  const response = 'var hq_str_sh600186="股票,12.0,12.0,12.5,12.8,11.9,0,0,1000,12500";';
  await withMock(response, async () => {
    const result = await fetchStockQuoteBySource('sina', '600186');
    assert.equal(result.price, 12.5);
    assert.ok(result.pct > 4);
  });
});
