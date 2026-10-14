import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { GddRealtimeFeed, parseGddWsMessage } from '../dist/gdd-realtime.js';
import { validateGddBatch, paperTradePlan } from '../dist/gdd-batch.js';

test('GDD WS parser understands quote/tick and bounds payload', () => {
  const q=parseGddWsMessage(JSON.stringify({reqtype:250,data:{symbol:[{
    market:1008,code:'300505',price:22,volume:10
  }]}}));
  assert.equal(q.rows.length,1);
  assert.equal(q.rows[0].type,250);
  const withoutMarket=parseGddWsMessage(JSON.stringify({reqtype:250,data:{symbol:[{code:'300505',price:23}]}}));
  assert.equal(withoutMarket.rows.length,1);
  assert.equal(withoutMarket.rows[0].market,1008);
  const t=parseGddWsMessage(JSON.stringify({reqtype:251,data:{tick:[{
    marketId:1008,code:'300505',price:22.1,time:'09:32'
  }]}}));
  assert.equal(t.rows[0].type,251);
  assert.deepEqual(parseGddWsMessage(JSON.stringify({reqtype:200,status:0})).rows,[]);
  assert.throws(()=>parseGddWsMessage('x'.repeat(1024*1024+10)),/过大/);
});

test('One backend WS socket multiplexes subscriptions and keeps latest pushed quote',async()=>{
  const server=createServer();
  const wss=new WebSocketServer({server,path:'/'});
  const commands=[];
  let sockets=0;
  wss.on('connection',ws=>{
    sockets++;
    ws.on('message',buff=>{
      const msg=JSON.parse(buff.toString());
      commands.push(msg);
      if(msg.reqtype===200||msg.reqtype===202){
        for(const sub of msg.data||[]){
          if(sub.code==='300505')ws.send(JSON.stringify({reqtype:250,data:{
            symbol:[{market:1008,code:sub.code,price:30.12,volume:200}]
          }}));
        }
      }
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port;
  const feed=new GddRealtimeFeed(async()=>`http://127.0.0.1:${port}/`);
  try{
    await feed.subscribe('300505',1);
    await feed.subscribe('300605',1);
    await feed.subscribe('300505',4);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(sockets,1);
    const current=feed.read('300505',1);
    assert.equal(current.connected,true);
    assert.equal(current.latest.payload.price,30.12);
    assert.ok(commands.some(m=>m.reqtype===200));
    assert.ok(commands.some(m=>m.data.some(sub=>sub.type===4)));
    assert.ok(commands.some(m=>m.reqtype===202));
    const unsub=feed.unsubscribe('300505',1);
    await new Promise(r=>setTimeout(r,30));
    assert.equal(unsub.removed,true);
    assert.ok(commands.some(m=>m.reqtype===201));
    assert.equal(feed.status().subscriptions.length,2);
    assert.equal(feed.events().length>0,true);
  }finally{
    feed.close();
    for(const c of wss.clients)c.terminate();
    await new Promise((resolve,reject)=>wss.close(e=>e?reject(e):resolve()));
    await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  }
});

test('Batch import validates bounded stock pool; trade plans are simulation only', () => {
  assert.deepEqual(validateGddBatch(['300505','300505','600186'],10,80),['300505','600186']);
  assert.throws(()=>validateGddBatch(['bad'],10,80),/股票代码/);
  assert.throws(()=>validateGddBatch(Array.from({length:11},(_,i)=>'300'+String(i).padStart(3,'0')),10,80),/1～10/);
  assert.throws(()=>validateGddBatch(['300505'],11,80),/入库/);
  assert.throws(()=>validateGddBatch(['300505'],10,500),/最多200/);
  const plan=paperTradePlan({code:'300505',entry:10,stop:9.7,target:10.6,capital:20000,maxPositionPct:50});
  assert.equal(plan.noOrderSubmitted,true);
  assert.equal(plan.shares,1000);
  assert.equal(plan.riskAmount,300);
  assert.equal(plan.mode,'simulation_only');
  assert.throws(()=>paperTradePlan({code:'300505',entry:10,stop:11,target:12,capital:20000,maxPositionPct:50}),/止损价/);
});
