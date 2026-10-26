import { readLimitedJson, validRateKey } from '../../server/interest-rate-limit.mjs';

const answer = (status,value) => new Response(JSON.stringify(value), {
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if (url.origin !== 'https://interest-limiter.internal' || url.pathname !== '/check' || url.search || url.hash) return answer(404,{error:'not_found'});
    if (request.method !== 'POST') return answer(405,{error:'method_not_allowed'});
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return answer(415,{error:'json_required'});
    if (typeof env.INTEREST_RATE_LIMITER?.limit !== 'function') return answer(503,{error:'unavailable'});
    let body;
    try { body = await readLimitedJson(request,256,AbortSignal.timeout(2000)); }
    catch { return answer(400,{error:'invalid_key'}); }
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 1 || !validRateKey(body.key)) return answer(400,{error:'invalid_key'});
    try {
      const result = await env.INTEREST_RATE_LIMITER.limit({key:'interest:'+body.key});
      if (typeof result?.success !== 'boolean') return answer(503,{error:'unavailable'});
      return answer(200,{success:result.success});
    } catch { return answer(503,{error:'unavailable'}); }
  }
};
