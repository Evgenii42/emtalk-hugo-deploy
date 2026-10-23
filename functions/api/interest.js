import { validateInterest } from '../../server/interest-policy.mjs';
import registry from '../../server/interest-registry.mjs';
import { checkInterestRateLimit } from '../../server/interest-rate-limit.mjs';

const reply = (status, body) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const unavailable = () => reply(503, {ok:false,code:'temporarily_unavailable'});
const ALLOWED_ORIGINS = new Set(['https://www.emtalk.org','https://interest032.emtalk-hugo-deploy.pages.dev']);
function allowedOrigin(env) {
  const value=env.INTEREST_ALLOWED_ORIGIN === undefined ? 'https://www.emtalk.org' : env.INTEREST_ALLOWED_ORIGIN;
  return ALLOWED_ORIGINS.has(value) ? value : null;
}
function configured(env) {
  return env.INTEREST_ENABLED === 'true' && env.INTEREST_RELEASE_READY === 'true'
    && !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY
    && !!env.INTEREST_WEBHOOK_SECRET && !!env.INTEREST_WEBHOOK_URL
    && typeof env.INTEREST_LIMITER_SERVICE?.fetch === 'function';
}
async function readBounded(request, maximum = 8192) {
  if (Number(request.headers.get('Content-Length')) > maximum) throw Error('Too large');
  const reader=request.body?.getReader();
  if (!reader) throw Error('Missing body');
  const chunks=[]; let length=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>maximum) {await reader.cancel(); throw Error('Too large');}
      chunks.push(value);
    }
    const bytes=new Uint8Array(length);let offset=0;
    for(const value of chunks){bytes.set(value,offset);offset+=value.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } finally {reader.releaseLock();}
}
export async function onRequest({request,env}) {
  const url=new URL(request.url);
  const expectedOrigin=allowedOrigin(env);
  if(!expectedOrigin)return unavailable();
  if(url.origin!==expectedOrigin)return reply(403,{ok:false,code:'origin_not_allowed'});
  if(request.method==='GET')return reply(200,configured(env)?{enabled:true,sitekey:env.TURNSTILE_SITE_KEY}:{enabled:false});
  if(request.method!=='POST')return reply(405,{ok:false,code:'method_not_allowed'});
  if(!configured(env))return unavailable();
  if(request.headers.get('Origin')!==expectedOrigin)return reply(403,{ok:false,code:'origin_not_allowed'});
  if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return reply(415,{ok:false,code:'json_required'});
  let body,token;
  try {body=await readBounded(request);token=body.turnstileToken;delete body.turnstileToken;} catch {return reply(400,{ok:false,code:'invalid_submission'});}
  if(typeof token!=='string'||token.length<1||token.length>2048)return reply(400,{ok:false,code:'security_check_required'});
  const validation=validateInterest(body,registry);
  if(!validation.valid)return reply(400,{ok:false,code:'invalid_submission'});
  try {
    const allowed=await checkInterestRateLimit(env.INTEREST_LIMITER_SERVICE,request.headers.get('CF-Connecting-IP'));
    if(!allowed)return reply(429,{ok:false,code:'too_many_requests'});
    const check=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token}),redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!check.ok)return unavailable();
    const proof=await check.json();
    if(proof.success!==true||proof.hostname!==url.hostname||proof.action!=='interest')return reply(403,{ok:false,code:'security_check_failed'});
    const destination=new URL(env.INTEREST_WEBHOOK_URL);
    if(destination.origin!=='https://contentfactory.emtalk.org'||destination.pathname!=='/webhook/emtalk-interest032-private'||destination.search||destination.hash||destination.username||destination.password)return unavailable();
    const response=await fetch(destination.href,{method:'POST',headers:{'Content-Type':'application/json','X-EmTalk-Interest-Key':env.INTEREST_WEBHOOK_SECRET},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(!response.ok)return unavailable();
    const resultBody=await readBounded(response,2048);
    if(resultBody.ok!==true||resultBody.submissionId!==body.submissionId.toLowerCase())return unavailable();
    return reply(200,{ok:true,submissionId:body.submissionId});
  } catch {return unavailable();}
}
