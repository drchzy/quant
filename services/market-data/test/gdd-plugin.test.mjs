import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGddPluginRequest, callGddPlugin, GDD_PLUGIN_COMMANDS } from '../dist/gdd-plugin.js';
import { invalidateGddGateway } from '../dist/gdd.js';

test('plugin builds exact PascalCase protocol envelope', () => {
  assert.equal(GDD_PLUGIN_COMMANDS.blockData, 1201);
  assert.equal(GDD_PLUGIN_COMMANDS.chooseStocks, 1207);
  assert.deepEqual(buildGddPluginRequest('riseFall', { example: true }, 5), {
    ReqType: 1260, ReqID: 5, Data: { example: true }
  });
  assert.throws(() => buildGddPluginRequest('riseFall', null), /JSON 对象/);
});

test('plugin sends PascalCase envelope to freshly discovered gateway', async () => {
  const old = globalThis.fetch;
  const env = Object.fromEntries(['GDD_ACCOUNT','GDD_PASSWORD','GDD_DEVICE'].map(k => [k,process.env[k]]));
  process.env.GDD_ACCOUNT = 'mock-account';
  process.env.GDD_PASSWORD = 'mock-secret';
  process.env.GDD_DEVICE = 'mock-android-device-id';
  invalidateGddGateway();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({url: String(url), payload: JSON.parse(options.body)});
    if (String(url).endsWith('/customer/login')) {
      return new Response(JSON.stringify({code:0,result:{sessionCode:'mock-session'}}));
    }
    if (String(url).endsWith('/config/query_server_info')) {
      return new Response(JSON.stringify({code:0,result:{sers:[{serverType:36,ip:'10.11.12.13',serverPort:19920}]}}));
    }
    return new Response(JSON.stringify({ReqType:1201,status:0,Data:{data:[]}}));
  };
  try {
    const result = await callGddPlugin('blockData', {market:1008});
    assert.equal(result.ReqType, 1201);
    assert.equal(requests.length, 3);
    assert.equal(requests[2].url, 'http://10.11.12.13:19920/');
    assert.deepEqual(requests[2].payload, {ReqType:1201,ReqID:1,Data:{market:1008}});
  } finally {
    globalThis.fetch = old;
    invalidateGddGateway();
    for (const [k,v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
