import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';

const COOKIE = 'quant_web_session';
const TTL_SECONDS = 12 * 3600;
const USER = String(process.env.WEB_USERNAME || 'admin').trim();
const PASSWORD = String(process.env.WEB_PASSWORD || '');
const MAX_FAILED = 8;
const failures = new Map<string, { count:number; until:number }>();
let cachedKey:Buffer|undefined;

export function webAuthEnabled():boolean {return PASSWORD.length >= 8 && USER.length > 0;}
function secret():Buffer {
  if(cachedKey)return cachedKey;
  const file=path.join(path.dirname(config.databasePath),'.web-auth-secret');
  try{
    cachedKey=fs.readFileSync(file);
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const bytes=randomBytes(32);
    try{fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});cachedKey=bytes;}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;cachedKey=fs.readFileSync(file);}
  }
  if(cachedKey.length!==32)throw new Error('Quant Web session key 格式错误');
  return cachedKey;
}
function sessionKey():Buffer {
  // 密码变更自动使现有所有会话失效。
  return createHmac('sha256',secret()).update(PASSWORD,'utf8').digest();
}
function sign(value:string) {return createHmac('sha256',sessionKey()).update(value).digest('base64url');}
export function createWebSession(now=Math.floor(Date.now()/1000)):string {
  if(!webAuthEnabled())throw Error('WEB_PASSWORD 至少需8位；请先在 web/.env 配置');
  const payload=Buffer.from(JSON.stringify({u:USER,t:now,n:randomBytes(12).toString('hex')})).toString('base64url');
  return payload+'.'+sign(payload);
}
export function validateWebSession(cookie:string|undefined,now=Math.floor(Date.now()/1000)):boolean {
  if(!webAuthEnabled()||!cookie||cookie.length>1024)return false;
  const token=cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token||!/^[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(token))return false;
  const [payload,mac]=token.split('.');
  const a=Buffer.from(mac),b=Buffer.from(sign(payload));
  if(a.length!==b.length||!timingSafeEqual(a,b))return false;
  try{
    const obj=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return obj.u===USER&&Number.isInteger(obj.t)&&obj.t<=now+60&&obj.t>now-TTL_SECONDS;
  }catch{return false;}
}
export function verifyWebPassword(user:string,password:string):boolean {
  if(!webAuthEnabled())return false;
  const a=createHash('sha256').update(String(password)).digest();
  const b=createHash('sha256').update(PASSWORD).digest();
  return timingSafeEqual(a,b) && user===USER;
}
export function registerWebAuth(app:FastifyInstance) {
  app.get('/api/v1/web-auth/check',async(req,reply)=>{
    reply.header('Cache-Control','no-store');
    if(!webAuthEnabled())return reply.code(503).send({error:'请先设置 WEB_PASSWORD（至少8位）'});
    if(!validateWebSession(req.headers.cookie))return reply.code(401).send({error:'需要登录'});
    return {authenticated:true};
  });
  app.post('/api/v1/web-auth/login',{bodyLimit:4096},async(req,reply)=>{
    reply.header('Cache-Control','no-store');
    if(!webAuthEnabled())return reply.code(503).send({error:'请在宿主机 web/.env 配置 WEB_PASSWORD，至少8位'});
    const ip=String(req.headers['x-real-ip']||req.ip).slice(0,80);
    const now=Date.now();
    if(failures.size>1000)for(const [key,v] of failures)if(v.until<now)failures.delete(key);
    const hit=failures.get(ip);
    if(hit&&hit.until>now&&hit.count>=MAX_FAILED)return reply.code(429).send({error:'密码尝试次数过多，1分钟后重试'});
    const body=req.body as {username?:unknown;password?:unknown}|null;
    const user=typeof body?.username==='string'?body.username:'';
    const password=typeof body?.password==='string'?body.password:'';
    if(password.length>256||!verifyWebPassword(user,password)){
      failures.set(ip,{count:(hit&&hit.until>now?hit.count:0)+1,until:now+60000});
      return reply.code(401).send({error:'账号或密码错误'});
    }
    failures.delete(ip);
    const token=createWebSession();
    const forwarded=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim();
    const secure=forwarded==='https';
    reply.header('Set-Cookie',COOKIE+'='+token+'; Path=/; Max-Age='+TTL_SECONDS+'; HttpOnly; SameSite=Strict'+(secure?'; Secure':''));
    return {authenticated:true,username:USER};
  });
  app.post('/api/v1/web-auth/logout',async(_req,reply)=>{
    reply.header('Set-Cookie',COOKIE+'=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
    reply.header('Cache-Control','no-store');
    return {authenticated:false};
  });
}
