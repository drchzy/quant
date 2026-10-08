import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

test('bridge static client script syntax and required endpoints', () => {
  const html = readFileSync('apps/web/public/bridge.html', 'utf8');
  const script = html.match(/<script>([\s\S]+?)<\/script>/);
  assert.ok(script, '未找到采集页面脚本');
  assert.doesNotThrow(() => new Script(script[1], { filename: 'bridge.html' }));
  for (const endpoint of ['/api/qt/clist/get', '/api/qt/stock/kline/get',
    '/api/qt/stock/trends2/get', '/api/qt/ulist.np/get']) {
    assert.ok(html.includes(endpoint), endpoint + ' 未提供');
  }
  assert.match(html, /BRIDGE_IMPORT_TOKEN/);
  assert.match(html, /请求间隔/);
  assert.match(html, /暂停/);
});
