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

export function createMeditationRepository({ fetcher = globalThis.fetch.bind(globalThis), storage = globalThis.caches, onCacheFailure = () => {}, mediaTimeoutMs = 60000 } = {}) {
  const memory = new Map();
  async function cache() {
    if (!storage) { onCacheFailure(); return null; }
    try { return await storage?.open("emtalk.bret.meditations.v1"); }
    catch { onCacheFailure(); return null; }
  }
  async function read(url) {
    if (memory.has(url)) return memory.get(url).clone();
    try { return await (await cache())?.match(url); }
    catch { onCacheFailure(); return null; }
  }
  async function write(url, response) {
    // Keep only JSON in memory; large audio stays in browser-managed Cache Storage.
    if ((response.headers.get("content-type") || "").includes("json")) memory.set(url, response.clone());
    try { await (await cache())?.put(url, response.clone()); }
    catch { onCacheFailure(); }
  }
  async function network(url, signal) {
    const response = await fetcher(url, { cache: "no-cache", signal });
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
        const response = await network(url, controller.signal);
        const data = validate(await response.clone().json());
        await write(url, response);
        return { data, offline: false };
      } catch (error) {
        if (signal?.aborted) throw error;
        const saved = await read(url);
        if (!saved) throw error;
        return { data: validate(await saved.json()), offline: true };
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
    async blob(url, signal, reload = false, version = "") {
      // Cache identity follows the opaque content version even if a publisher
      // reuses a media URL. The version query is local to Cache Storage only.
      const key = new URL(url);
      if (version) key.searchParams.set("__bret_media_version", version);
      const cacheKey = key.href;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, mediaTimeoutMs);
      try {
        const saved = reload ? null : await read(cacheKey);
        controller.signal.throwIfAborted();
        if (saved) return await saved.blob();
        const response = await network(url, controller.signal);
        const blob = await response.clone().blob();
        if (!blob.size) throw Error("Empty media");
        await write(cacheKey, response);
        return blob;
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
  };
}
