// Shared schemaVersion=1 contract. Versions are opaque strings.
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v) => typeof v === "string" && v.length > 0 && v.length <= 8000;
const duration = (v) => Number.isFinite(v) && v > 0 && v <= 86400000;
export function contentUrl(path, base) {
  if (!str(path) || !path.startsWith("/") || path.startsWith("//") || /[\\\s]/.test(path)) throw Error("Invalid content URL");
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin || !/^https?:$/.test(url.protocol)) throw Error("Invalid content origin");
  return url.href;
}
export function checkIndex(v, base) {
  if (!record(v) || v.schemaVersion !== 1 || !str(v.version) || !Array.isArray(v.meditations) || v.meditations.length > 500) throw Error("Invalid catalogue");
  const ids = new Set();
  for (const m of v.meditations) {
    if (!record(m) || !str(m.id) || ids.has(m.id) || !str(m.version) || !str(m.title) || !str(m.description) || !duration(m.durationMs)) throw Error("Invalid meditation");
    ids.add(m.id);
    contentUrl(m.jsonUrl, base); contentUrl(m.thumbnailUrl, base);
  }
  if (v.categories !== undefined && (!Array.isArray(v.categories) || v.categories.length > 50 || v.categories.some(c => !record(c) || !str(c.id) || !str(c.title)) || new Set(v.categories.map(c => c.id)).size !== v.categories.length)) throw Error("Invalid categories");
  if (v.categories !== undefined) {
    const categoryIds = new Set(v.categories.map(c => c.id));
    // Missing fields in legacy v1 caches still permit the unfiltered catalogue.
    if (v.meditations.some(m => m.categoryId !== undefined && (!str(m.categoryId) || !categoryIds.has(m.categoryId)))) throw Error("Unknown meditation category");
  }
  return v;
}
export function checkDetail(v, item, base) {
  if (!record(v) || v.schemaVersion !== 1 || v.id !== item.id || v.version !== item.version || v.durationMs !== item.durationMs || v.categoryId !== item.categoryId || !str(v.title) || !str(v.description) || v.language !== "en" || !Array.isArray(v.instructions) || v.instructions.length > 30 || v.instructions.some(x => !str(x))) throw Error("This practice has changed. Refresh the library.");
  for (const key of ["audioUrl", "backgroundImageUrl", "thumbnailUrl", "subtitlesUrl"]) contentUrl(v[key], base);
  // Published delivery is Opus only. The player checks Ogg Opus support before
  // downloading; absence of a decoder is an explicit unsupported-browser state.
  if (!new URL(v.audioUrl, base).pathname.endsWith(".opus")) throw Error("Unsupported audio contract");
  return v;
}
export function checkCaptions(v, id) {
  if (!record(v) || v.meditationId !== id || v.timebase !== "ms" || !Array.isArray(v.cues) || v.cues.length > 10000) throw Error("Invalid subtitles");
  let previous = -1;
  for (const c of v.cues) {
    if (!Number.isFinite(c.startMs) || !Number.isFinite(c.endMs) || c.startMs < previous || c.endMs <= c.startMs || !str(c.text)) throw Error("Invalid subtitle cue");
    previous = c.startMs;
  }
  return v;
}
export function cueAt(cues, seconds) {
  const ms = seconds * 1000;
  return cues.filter(c => c.startMs <= ms && ms < c.endMs).map(c => c.text).join(" ");
}
export const clock = seconds => {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

// These limits apply to this cache only; browser-wide storage eviction remains
// outside the app. Smaller injected limits make the same policy testable.
export const MEDITATION_CACHE_LIMITS = Object.freeze({ entries: 32, bytes: 64 * 1024 * 1024 });
export function createMeditationRepository({ fetcher = globalThis.fetch.bind(globalThis), storage = globalThis.caches,
  onCacheFailure = () => {}, onCacheSuccess = () => {}, mediaTimeoutMs = 60000, cacheTimeoutMs = 2000,
  cacheMaxEntries = MEDITATION_CACHE_LIMITS.entries, cacheMaxBytes = MEDITATION_CACHE_LIMITS.bytes } = {}) {
  const entryLimit = Math.max(1, Math.min(MEDITATION_CACHE_LIMITS.entries, Math.floor(cacheMaxEntries) || 1));
  const byteLimit = Math.max(1, Math.min(MEDITATION_CACHE_LIMITS.bytes, Math.floor(cacheMaxBytes) || 1));
  const cacheWait = Number.isFinite(cacheTimeoutMs) && cacheTimeoutMs > 0 ? cacheTimeoutMs : 2000;
  const memory = new Map(), sizes = new Map(), mediaTargets = new Map(), deadlines = new WeakMap();
  let latestCachedKey;
  const keyOf = request => typeof request === "string" ? request : request.url;
  const catalogueKey = key => new URL(key).pathname.endsWith("/content/bret/meditations/index.json");
  const mediaBase = key => { const url = new URL(key); url.searchParams.delete("__bret_media_version"); return url.href; };
  function notify(callback, key) { try { callback(key); } catch { /* Optional UI never blocks content. */ } }
  // Cache Storage is not abortable. Bound waiting, stop subsequent work after
  // timeout, and let independent calls recover without a stuck predecessor.
  async function cacheBudget(signal, work) {
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    deadlines.set(controller.signal, Date.now() + cacheWait);
    const timer = setTimeout(() => controller.abort(new DOMException("Cache timed out", "TimeoutError")), cacheWait);
    try { return await work(controller.signal); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async function cacheOp(operation, signal) {
    signal?.throwIfAborted();
    const remaining = (deadlines.get(signal) ?? Date.now() + cacheWait) - Date.now();
    if (remaining <= 0) throw new DOMException("Cache timed out", "TimeoutError");
    let timer, abort;
    try {
      return await new Promise((resolve, reject) => {
        abort = () => reject(signal.reason);
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => reject(new DOMException("Cache timed out", "TimeoutError")), remaining);
        Promise.resolve().then(() => { signal?.throwIfAborted(); return operation(); }).then(resolve, reject);
      });
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async function open(signal) {
    if (!storage) throw Error("Cache unavailable");
    return cacheOp(() => storage.open("emtalk.bret.meditations.v1"), signal);
  }
  function remember(key, response, bytes) {
    memory.delete(key);
    if (!(response.headers.get("content-type") || "").includes("json") || bytes > byteLimit) return;
    memory.set(key, { response: response.clone(), bytes });
    let total = [...memory.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (memory.size > entryLimit || total > byteLimit) {
      const first = memory.keys().next().value; total -= memory.get(first).bytes; memory.delete(first);
    }
  }
  async function inventory(cache, signal) {
    const requests = await cacheOp(() => cache.keys(), signal), rows = [];
    for (const request of requests) {
      const key = keyOf(request);
      let bytes = sizes.get(key);
      if (bytes === undefined) {
        const response = await cacheOp(() => cache.match(request), signal);
        if (!response) continue;
        bytes = (await cacheOp(() => response.blob(), signal)).size;
        sizes.set(key, bytes);
      }
      rows.push({ request, key, bytes });
    }
    const present = new Set(rows.map(row => row.key));
    for (const key of sizes.keys()) if (!present.has(key)) sizes.delete(key);
    return rows;
  }
  async function remove(cache, row, signal) {
    await cacheOp(() => cache.delete(row.request), signal);
    sizes.delete(row.key); memory.delete(row.key);
  }
  async function prune(cache, keep, signal, aggressiveBase) {
    let rows = await inventory(cache, signal);
    // Only supersede a URL once its desired new version actually exists.
    for (const row of [...rows]) {
      const target = mediaTargets.get(mediaBase(row.key));
      if (target && row.key !== target && rows.some(other => other.key === target)) {
        await remove(cache, row, signal); rows = rows.filter(other => other !== row);
      }
    }
    if (aggressiveBase !== undefined) {
      // Quota retry may clear other older media, but retains the previous
      // version of this URL until a new put has succeeded, and prefers index.
      for (const row of [...rows]) if (row.key !== keep && !catalogueKey(row.key) && mediaBase(row.key) !== aggressiveBase) {
        await remove(cache, row, signal); rows = rows.filter(other => other !== row);
      }
    }
    let total = rows.reduce((sum, row) => sum + row.bytes, 0);
    const protectedKey = () => keep ?? latestCachedKey;
    const candidates = rows.filter(row => row.key !== protectedKey()).sort((a, b) => Number(catalogueKey(a.key)) - Number(catalogueKey(b.key)));
    for (const row of candidates) {
      if (rows.length <= entryLimit && total <= byteLimit) break;
      if (row.key === protectedKey()) continue;
      await remove(cache, row, signal); total -= row.bytes; rows = rows.filter(other => other !== row);
    }
    if (rows.length > entryLimit || total > byteLimit) throw Error("Cache capacity exceeded");
    return new Set(rows.map(row => row.key));
  }
  async function read(key, signal, consume) {
    try {
      return await cacheBudget(signal, async budget => {
        if (memory.has(key)) return { value: await consume(memory.get(key).response.clone(), budget), durable: false };
        const cache = await open(budget), response = await cacheOp(() => cache.match(key), budget);
        return response ? { value: await consume(response, budget), durable: true } : null;
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      notify(onCacheFailure, key); return null;
    }
  }
  async function write(key, response, bytes, signal, base) {
    remember(key, response, bytes);
    if (base !== undefined) {
      mediaTargets.delete(base); mediaTargets.set(base, key);
      if (mediaTargets.size > entryLimit) mediaTargets.delete(mediaTargets.keys().next().value);
    }
    let touchedCache, stored = false;
    try {
      await cacheBudget(signal, async budget => {
        const cache = await open(budget); touchedCache = cache;
        // If old inventory cannot be inspected/pruned, do not add more entries.
        await prune(cache, undefined, budget);
        if (bytes > byteLimit) throw Error("Media exceeds offline cache budget");
        async function put() {
          let pending;
          try { await cacheOp(() => { pending = cache.put(key, response.clone()); return pending; }, budget); stored = true; }
          catch (error) {
            // A timed-out native put may still finish. Reconcile then; it must
            // not report success for a caller that already degraded online.
            pending?.then(() => { sizes.delete(key); return cacheBudget(undefined, lateBudget => prune(cache, undefined, lateBudget)); }).catch(() => {});
            throw error;
          }
        }
        try { await put(); }
        catch (error) {
          if (error?.name !== "QuotaExceededError" || budget.aborted) throw error;
          await prune(cache, key, budget, base ?? "");
          await put();
        }
        sizes.set(key, bytes); latestCachedKey = key;
        const retained = await prune(cache, undefined, budget);
        if (!retained.has(key)) throw Error("Entry evicted by cache budget");
        notify(onCacheSuccess, key);
      });
    } catch (error) {
      // The write may have completed just as its cleanup budget expired.
      // A fresh bounded sweep is best effort and never delays online use.
      if (stored) cacheBudget(undefined, budget => prune(touchedCache, undefined, budget)).catch(() => {});
      if (signal?.aborted) throw error;
      notify(onCacheFailure, key);
    }
  }
  async function network(url, signal) {
    const response = await fetcher(url, { cache: "no-cache", signal });
    signal?.throwIfAborted();
    if (!response.ok || response.status === 206) throw Error("Content could not be loaded");
    return response;
  }
  return {
    async json(url, validate, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, 12000);
      try {
        const response = await network(url, controller.signal), body = await response.clone().blob();
        controller.signal.throwIfAborted();
        const data = validate(await new Response(body).json());
        controller.signal.throwIfAborted();
        clearTimeout(timer); // Network/body complete; optional storage has its own deadline.
        await write(url, response, body.size, controller.signal);
        controller.signal.throwIfAborted();
        return { data, offline: false };
      } catch (error) {
        if (signal?.aborted) throw error;
        const saved = await read(url, signal, async (response, budget) => validate(await cacheOp(() => response.json(), budget)));
        if (!saved) throw error;
        if (saved.durable) notify(onCacheSuccess, url);
        return { data: saved.value, offline: true };
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
    async blob(url, signal, reload = false, version = "") {
      const key = new URL(url);
      if (version) key.searchParams.set("__bret_media_version", version);
      const cacheKey = key.href, controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, mediaTimeoutMs);
      try {
        const saved = reload ? null : await read(cacheKey, controller.signal, async (response, budget) => {
          const blob = await cacheOp(() => response.blob(), budget);
          if (!blob.size) throw Error("Empty media");
          return blob;
        });
        controller.signal.throwIfAborted();
        if (saved) {
          notify(onCacheSuccess, cacheKey); return saved.value;
        }
        const response = await network(url, controller.signal), blob = await response.clone().blob();
        controller.signal.throwIfAborted();
        if (!blob.size) throw Error("Empty media");
        clearTimeout(timer); // Full network body is ready; storage has its own bounded budget.
        await write(cacheKey, response, blob.size, controller.signal, mediaBase(cacheKey));
        controller.signal.throwIfAborted();
        return blob;
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
  };
}
