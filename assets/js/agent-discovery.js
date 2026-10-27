// Optional WebMCP public metadata. No models, private state, navigation or analytics.
(() => {
  "use strict";
  let context;
  try { context = document.modelContext; } catch { return; }
  if (typeof context?.registerTool !== "function") return;
  const prefix = document.documentElement.dataset.mountPrefix || "";
  if (prefix && !/^\/[a-zA-Z0-9/_-]{1,240}$/.test(prefix)) return;
  const endpoint = new URL(prefix + "/ai/resources.json", location.origin);
  const topics = ["sleep", "burnout", "energy", "anxiety", "relationships", "motivation", "bret", "dm", "tapl"];
  const annotations = { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false };
  let current = null;
  const invalid = () => new TypeError("Use only the documented public metadata fields and limits.");
  const aborted = () => new DOMException("Public metadata lookup cancelled.", "AbortError");
  function object(input, allowed, required = []) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
        Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) throw invalid();
  }
  function text(value, maximum) { return typeof value === "string" && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value); }
  function validateIndex(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.resources) || value.resources.length !== 17) throw invalid();
    const ids = new Set(), counts = { article: 0, test: 0, product: 0 };
    const rows = value.resources.map(row => {
      object(row, ["id", "kind", "title", "summary", "topic", "url", "status", "questions", "minutes", "readingMinutes", "listeningMinutes"], ["id", "kind", "title", "summary", "topic", "url", "status"]);
      if (!Object.hasOwn(counts, row.kind) || !text(row.id, 128) || !new RegExp("^" + row.kind + ":[a-z0-9-]{1,110}$").test(row.id) || ids.has(row.id) ||
          !text(row.title, 220) || !row.title || !text(row.summary, 900) || !topics.includes(row.topic) || !text(row.status, 80) || !text(row.url, 512)) throw invalid();
      const slug = row.id.split(":")[1], url = new URL(row.url);
      const route = row.kind === "product" ? "/" + slug : "/" + (row.kind === "article" ? "articles" : "tests") + "/" + slug;
      if (url.origin !== endpoint.origin || url.pathname !== prefix + route || url.search || url.hash || url.username || url.password ||
          (row.kind === "product" && !["bret", "dm", "tapl"].includes(slug))) throw invalid();
      for (const key of ["questions", "minutes", "readingMinutes", "listeningMinutes"]) {
        if (Object.hasOwn(row, key) && (!Number.isInteger(row[key]) || row[key] < 1 || row[key] > 240)) throw invalid();
      }
      ids.add(row.id); counts[row.kind] += 1;
      return Object.freeze({ ...row });
    });
    if (counts.article !== 9 || counts.test !== 5 || counts.product !== 3) throw invalid();
    return Object.freeze(rows);
  }
  async function readIndex(state, signal) {
    if (state.index) return state.index;
    const response = await fetch(endpoint.href, { method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "force-cache", signal });
    if (!response.ok || !response.body || !/application\/json/i.test(response.headers.get("content-type") || "")) throw new Error("Public metadata is temporarily unavailable.");
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) throw invalid();
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    if (signal.aborted || state !== current) throw aborted();
    state.index = validateIndex(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
    return state.index;
  }
  async function execute(state, input, options, validate, select) {
    validate(input);
    if (state !== current || state.controller.signal.aborted || options?.signal?.aborted) throw aborted();
    if (state.pending >= 2) throw new Error("Two public lookups are already running. Try again later.");
    state.pending += 1;
    const operation = new AbortController(), cancel = () => operation.abort();
    const signals = [state.controller.signal, options?.signal].filter(Boolean);
    for (const signal of signals) signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 8000);
    try {
      const rows = await readIndex(state, operation.signal);
      if (operation.signal.aborted || state !== current) throw aborted();
      // Results are descriptions, never instructions or personal recommendations.
      return JSON.stringify(select(rows, input));
    } finally {
      clearTimeout(timeout);
      for (const signal of signals) signal.removeEventListener("abort", cancel);
      state.pending -= 1;
    }
  }
  function definitions(state) {
    return [
      { name: "emtalk_search_public_resources", description: "Search public EmTalk article, test-description and product metadata. Returns at most eight descriptions and landing-page links, without changing the page. Do not provide personal answers or decision text.", annotations,
        inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["article", "test", "product"] }, topic: { type: "string", enum: topics }, query: { type: "string", maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 8 } }, additionalProperties: false },
        execute: (input, options) => execute(state, input, options, value => {
          object(value, ["kind", "topic", "query", "limit"]);
          if ((value.kind !== undefined && !["article", "test", "product"].includes(value.kind)) || (value.topic !== undefined && !topics.includes(value.topic)) ||
              (value.query !== undefined && !text(value.query, 80)) || (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 8))) throw invalid();
        }, (rows, value) => {
          const query = (value.query || "").trim().toLowerCase();
          const found = rows.filter(row => (!value.kind || row.kind === value.kind) && (!value.topic || row.topic === value.topic) && (!query || (row.title + " " + row.summary).toLowerCase().includes(query)));
          const limit = value.limit || 8;
          return { resources: found.slice(0, limit), total: found.length, moreAvailable: found.length > limit };
        }) },
      { name: "emtalk_get_public_resource", description: "Read one public resource description by its catalog ID. No article body, test answers, scoring request or private workspace is accessed.", annotations,
        inputSchema: { type: "object", properties: { id: { type: "string", maxLength: 128, pattern: "^(article|test|product):[a-z0-9-]{1,110}$" } }, required: ["id"], additionalProperties: false },
        execute: (input, options) => execute(state, input, options, value => { object(value, ["id"], ["id"]); if (!text(value.id, 128) || !/^(article|test|product):[a-z0-9-]{1,110}$/.test(value.id)) throw invalid(); }, (rows, value) => ({ resource: rows.find(row => row.id === value.id) || null })) },
      { name: "emtalk_get_product_availability", description: "Read the public availability descriptions for BRET, Decision Matrix or Tapl. Does not open a practice or app store. Website AI is not offered; DM AI is in its Android app, BRET has no AI, Tapl is in development.", annotations,
        inputSchema: { type: "object", properties: { product: { type: "string", enum: ["bret", "dm", "tapl"] } }, required: ["product"], additionalProperties: false },
        execute: (input, options) => execute(state, input, options, value => { object(value, ["product"], ["product"]); if (!["bret", "dm", "tapl"].includes(value.product)) throw invalid(); }, (rows, value) => ({ resource: rows.find(row => row.id === "product:" + value.product) })) }
    ];
  }
  async function start() {
    if (current) return;
    const state = { controller: new AbortController(), pending: 0, index: null };
    current = state;
    try {
      for (const tool of definitions(state)) {
        if (state !== current || state.controller.signal.aborted) return;
        await context.registerTool(tool, { signal: state.controller.signal });
      }
    } catch { state.controller.abort(); if (state === current) current = null; }
  }
  addEventListener("pagehide", () => { const state = current; current = null; if (state) { state.index = null; state.controller.abort(); } });
  addEventListener("pageshow", event => { if (event.persisted) void start(); });
  void start();
})();
