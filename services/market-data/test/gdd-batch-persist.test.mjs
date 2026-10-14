import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('GDD batch persist writes to DuckDB with prior-close derived percent and no phantom rows', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quant-gdd-bulk-'));
  process.env.DATABASE_PATH=path.join(dir,'test.duckdb');
  process.env.GDD_ACCOUNT='mock';
  process.env.GDD_PASSWORD='mock';
  process.env.GDD_DEVICE='mock-batch-device-id';
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk.toString();
    let payload={};try{payload=JSON.parse(text);}catch{}
    res.setHeader('Content-Type','application/json');
    if(req.url?.endsWith('/customer/login')) {res.end(JSON.stringify({code:0,result:{sessionCode:'fake-session'}}));return;}
    if(req.url?.endsWith('/config/query_server_info')) {res.end(JSON.stringify({code:0,result:{sers:[{serverType:36,ip:'127.0.0.1',serverPort:server.address().port}]}}));return;}
    res.end(JSON.stringify({reqtype:150,status:0,data:{kline:[
      ['time','open','high','low','close','volume','amount'],
      ['2026-10-12 0:0:0',10,10.3,9.7,10.2,10000,20000],
      ['2026-10-13 0:0:0',10.2,11,10,10.7,12000,30000]
    ]}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.GDD_BUSINESS_URL='http://127.0.0.1:'+server.address().port;
  const {initDatabase,all,closeDatabase}=await import('../dist/database.js');
  const {batchGddHistory}=await import('../dist/gdd-batch.js');
  try{
    await initDatabase();
    const preview=await batchGddHistory(['300505'],10,2,false);
    assert.equal(preview.totalPersisted,0);
    const empty=await all("SELECT code FROM daily_price WHERE code='300505'");
    assert.equal(empty.length,0);
    const result=await batchGddHistory(['300505'],10,2,true);
    assert.equal(result.totalPersisted,2);
    const saved=await all("SELECT code,source,pct,pre_close,close FROM daily_price WHERE code='300505' ORDER BY trade_date");
    assert.equal(saved.length,2);
    assert.equal(saved[1].source,'gdd');
    assert.equal(saved[1].pre_close,10.2);
    assert.ok(Math.abs(saved[1].pct-(10.7-10.2)/10.2*100)<0.001);
  }finally {
    await closeDatabase();
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
