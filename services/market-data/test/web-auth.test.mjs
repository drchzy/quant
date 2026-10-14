import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'quant-web-auth-'));
process.env.DATABASE_PATH=path.join(temp,'market.duckdb');
process.env.WEB_USERNAME='admin';
process.env.WEB_PASSWORD='long-unit-test-web-password';
const {webAuthEnabled,verifyWebPassword,createWebSession,validateWebSession}=await import('../dist/web-auth.js');

test('Web auth reads independent configured password and rejects wrong password',()=>{
  assert.equal(webAuthEnabled(),true);
  assert.equal(verifyWebPassword('admin','long-unit-test-web-password'),true);
  assert.equal(verifyWebPassword('admin','wrong-password'),false);
  assert.equal(verifyWebPassword('other','long-unit-test-web-password'),false);
});
test('Signed web session is tamper-resistant and expires after 12 hours',()=>{
  const at=1760400000;
  const signed=createWebSession(at);
  assert.equal(validateWebSession('quant_web_session='+signed,at+1),true);
  assert.equal(validateWebSession('quant_web_session='+signed,at+13*3600),false);
  assert.equal(validateWebSession('quant_web_session='+signed+'x',at+3),false);
  assert.equal(validateWebSession('other_cookie=something',at+3),false);
  assert.equal(validateWebSession(undefined,at+3),false);
  assert.equal(fs.statSync(path.join(temp,'.web-auth-secret')).mode & 0o077,0);
});
test('Invalid or empty web login cannot form authenticated session',()=>{
  assert.equal(validateWebSession('',1760400100),false);
  assert.equal(validateWebSession('quant_web_session=not.a.signature',1760400100),false);
});
process.on('exit',()=>{fs.rmSync(temp,{recursive:true,force:true});});
