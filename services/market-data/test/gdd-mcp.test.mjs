import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mcpAccessStatus, serveGddMcp } from '../dist/gdd-mcp.js';

test('MCP is disabled without a long standalone bearer token', () => {
  const prior = process.env.GDD_MCP_TOKEN;
  try {
    delete process.env.GDD_MCP_TOKEN;
    assert.equal(mcpAccessStatus(),503);
    process.env.GDD_MCP_TOKEN = 'too-short';
    assert.equal(mcpAccessStatus('Bearer too-short'),503);
  }finally {
    if(prior === undefined)delete process.env.GDD_MCP_TOKEN;
    else process.env.GDD_MCP_TOKEN = prior;
  }
});

test('MCP rejects bad bearer tokens and unapproved browser Origin', () => {
  const token = 'mock-ci-long-gdd-mcp-token-1234567890';
  const prior = process.env.GDD_MCP_TOKEN;
  const priorOrigins = process.env.GDD_MCP_ALLOWED_ORIGINS;
  process.env.GDD_MCP_TOKEN = token;
  delete process.env.GDD_MCP_ALLOWED_ORIGINS;
  try {
    assert.equal(mcpAccessStatus('Bearer wrong'),401);
    assert.equal(mcpAccessStatus('Basic '+token),401);
    assert.equal(mcpAccessStatus('Bearer '+token),200);
    assert.equal(mcpAccessStatus('Bearer '+token,'https://untrusted.example'),403);
    process.env.GDD_MCP_ALLOWED_ORIGINS='https://allowed.example';
    assert.equal(mcpAccessStatus('Bearer '+token,'https://allowed.example'),200);
  } finally {
    if(prior===undefined)delete process.env.GDD_MCP_TOKEN;else process.env.GDD_MCP_TOKEN=prior;
    if(priorOrigins===undefined)delete process.env.GDD_MCP_ALLOWED_ORIGINS;else process.env.GDD_MCP_ALLOWED_ORIGINS=priorOrigins;
  }
});

test('Streamable HTTP: initialize + tools/list with valid bearer; invalid request is 401', async () => {
  const prev=process.env.GDD_MCP_TOKEN;
  const token='test-gdd-mcp-token-0123456789-abcdef';
  process.env.GDD_MCP_TOKEN=token;
  const server=createServer((req,res) => {void serveGddMcp(req,res).catch(()=>{
    if(!res.headersSent)res.statusCode=500;
    res.end();
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  const url='http://127.0.0.1:'+address.port+'/mcp';
  const call=async(method,params,id,authorized=true)=>{
    const response=await fetch(url,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json, text/event-stream',
        ...(authorized?{Authorization:'Bearer '+token}:{})
      },
      body:JSON.stringify({jsonrpc:'2.0',id,method,params})
    });
    const value=await response.text();
    return { status:response.status, value };
  };
  try {
    const denied=await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'mcp-ci',version:'1.0'}},1,false);
    assert.equal(denied.status,401);
    const initialized=await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'mcp-ci',version:'1.0'}},2);
    assert.equal(initialized.status,200);
    assert.match(initialized.value,/quant-gdd-market/);
    const listing=await call('tools/list',{},3);
    assert.equal(listing.status,200);
    assert.match(listing.value,/gdd_get_kline/);
    assert.match(listing.value,/gdd_query_feature/);
    assert.match(listing.value,/gdd_get_lhb/);
  } finally {
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    if(prev===undefined)delete process.env.GDD_MCP_TOKEN;else process.env.GDD_MCP_TOKEN=prev;
  }
});
