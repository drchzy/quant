import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GDD_FEATURES, prepareGddFeature, queryGddFeature } from '../dist/gdd-features.js';
import { buildGddPluginRequest } from '../dist/gdd-plugin.js';
import { fetchGddTicks, invalidateGddGateway } from '../dist/gdd.js';

test('all GDD plugin features are registered with bounded typed fields', () => {
  assert.equal(GDD_FEATURES.length,18);
  for (const def of GDD_FEATURES) {
    const { request } = prepareGddFeature(def.id, {});
    const envelope = buildGddPluginRequest(def.id, request);
    assert.equal(envelope.ReqType,def.reqtype);
    assert.ok(envelope.Data);
  }
  assert.deepEqual(prepareGddFeature('blockData', {block:'54000'}).request, [{BlockID:54000}]);
  assert.deepEqual(prepareGddFeature('fundFlow', {code:'300505'}).request, [{Market:1008,Code:'300505'}]);
  assert.deepEqual(prepareGddFeature('relatedBlock',{code:'300505'}).request, {type:[1],sym_list:[{market:1008,code:'300505'}]});
  assert.deepEqual(prepareGddFeature('lhbDetail', {id:'333'}).request, {ID:333});
  assert.equal(prepareGddFeature('limitUpDown',{}).request.Count,30);
});
test('GDD query features reject unsafe query fields, invalid parameters and unknown commands', () => {
  assert.throws(()=>prepareGddFeature('unknown',{}),/不支持/);
  assert.throws(()=>prepareGddFeature('fundFlow',{code:'300505 OR 1=1'}),/六位/);
  assert.throws(()=>prepareGddFeature('blockRank',{block:'-1'}),/非负整数/);
  assert.throws(()=>prepareGddFeature('limitUpDown',{count:'10000'}),/超出允许范围/);
  assert.throws(()=>prepareGddFeature('lhbList',{date:'2026-02-30'}),/日期无效/);
});

test('LHB commands choose serverType=35; normal plugin uses serverType=36', async () => {
  invalidateGddGateway();
  const oldFetch=globalThis.fetch;
  const previous=Object.fromEntries(['GDD_ACCOUNT','GDD_PASSWORD','GDD_DEVICE'].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{GDD_ACCOUNT:'fake',GDD_PASSWORD:'fake',GDD_DEVICE:'mock-device-for-tests'});
  const calls=[];
  globalThis.fetch=async (url,options) => {
    calls.push({url:String(url),body:JSON.parse(options.body)});
    if(String(url).endsWith('/customer/login')) return new Response(JSON.stringify({code:0,result:{sessionCode:'abc-test'}}));
    if(String(url).endsWith('/config/query_server_info')) return new Response(JSON.stringify({code:0,result:{sers:[
      {serverType:36,ip:'10.1.1.36',serverPort:19920},
      {serverType:35,ip:'10.1.1.35',serverPort:9906}
    ]}}));
    return new Response(JSON.stringify({status:0,result:{body:[{code:'300505',riseRate:2.5}]}}));
  };
  try {
    const a=await queryGddFeature('blockData',{block:54000});
    const b=await queryGddFeature('lhbList',{date:'2026-10-13'});
    assert.equal(a.reqtype,1201);
    assert.equal(b.reqtype,3002);
    assert.equal(calls[2].url,'http://10.1.1.36:19920/');
    assert.equal(calls[3].url,'http://10.1.1.35:9906/');
    assert.deepEqual(calls[2].body.Data,[{BlockID:54000}]);
    assert.deepEqual(calls[3].body.Data,{Time:'2026-10-13'});
  }finally{
    globalThis.fetch=oldFetch;
    invalidateGddGateway();
    for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});

test('GDD tick 151 sends the historical time window and validates fixed column layout',async()=>{
  invalidateGddGateway();
  const oldFetch=globalThis.fetch;
  const previous=Object.fromEntries(['GDD_ACCOUNT','GDD_PASSWORD','GDD_DEVICE'].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{GDD_ACCOUNT:'fake',GDD_PASSWORD:'fake',GDD_DEVICE:'mock-device-for-tests'});
  const calls=[];
  globalThis.fetch=async (url,options) => {
    calls.push(JSON.parse(options.body));
    if(String(url).endsWith('/customer/login'))return new Response(JSON.stringify({code:0,result:{sessionCode:'abc'}}));
    if(String(url).endsWith('/config/query_server_info'))return new Response(JSON.stringify({code:0,result:{sers:[{serverType:36,ip:'10.1.1.36',serverPort:19920}]}}));
    return new Response(JSON.stringify({reqtype:151,status:0,data:{tick:[
      ['time','millisecond','flag','price','volume','amount','type'],
      ['09:31:02',123,1,10.2,200,2040,2]
    ]}}));
  };
  try {
    const bars=await fetchGddTicks('300505','2026-10-13');
    assert.equal(bars.length,1);
    assert.equal(bars[0].price,10.2);
    assert.equal(calls[2].reqtype,151);
    assert.equal(calls[2].data.market,1008);
    assert.equal(calls[2].data.timevalue0,90);
    assert.equal(calls[2].data.timevalue1,420);
  }finally{
    globalThis.fetch=oldFetch;invalidateGddGateway();
    for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});
