export const LIMITER_URL = 'https://interest-limiter.internal/check';
export const LIMITER_TIMEOUT_MS = 2000;

export function validRateKey(key) {
  if (typeof key !== 'string' || key.length > 64 || !/^[0-9a-fA-F:.]+$/.test(key)) return false;
  if (!key.includes(':')) return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(key) && key.split('.').every(part => Number(part) <= 255);
  try { return new URL('http://[' + key + ']/').hostname.startsWith('['); } catch { return false; }
}

export async function readLimitedJson(input, maximum, signal) {
  if (Number(input.headers.get('Content-Length')) > maximum) throw Error('Oversize response');
  const reader = input.body?.getReader();
  if (!reader) throw Error('Missing body');
  const chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, {once:true});
  try {
    while (true) {
      if (signal?.aborted) throw Error('Aborted');
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { cancel(); throw Error('Oversize response'); }
      chunks.push(value);
    }
    if (signal?.aborted) throw Error('Aborted');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } finally {
    signal?.removeEventListener('abort',cancel);
    reader.releaseLock();
  }
}

export async function checkInterestRateLimit(service, key) {
  if (typeof service?.fetch !== 'function' || !validRateKey(key)) throw Error('Unavailable rate check');
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_,reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error('Rate check timed out')); }, LIMITER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([deadline,(async () => {
      const response = await service.fetch(new Request(LIMITER_URL, {
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),
        redirect:'manual',signal:controller.signal
      }));
      if (response.status !== 200) throw Error('Unavailable rate check');
      const result = await readLimitedJson(response,256,controller.signal);
      if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || typeof result.success !== 'boolean') throw Error('Invalid rate decision');
      return result.success;
    })()]);
  } finally { clearTimeout(timer); controller.abort(); }
}
