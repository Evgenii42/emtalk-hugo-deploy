// Owns optional examples only. It never reads decisions/storage or renders DOM.
// Each request publishes an immutable snapshot; stale generations cannot publish.
class InvalidTopicsDataError extends Error {}

export function createTopicsLoader({url, onChange, request = (...args) => fetch(...args)}) {
  let rows = Object.freeze([]), status = 'loading', dataInvalid = false;
  let controller, generation = 0;
  const publish = () => onChange(Object.freeze({rows, status, dataInvalid}));
  return {async load() {
    controller?.abort();
    const current = ++generation;
    status = 'loading'; dataInvalid = false; publish();
    const active = new AbortController(); controller = active;
    const timeout = setTimeout(() => active.abort(), 10000);
    try {
      const response = await request(url, {signal: active.signal});
      if (!response.ok) throw new Error('Topics unavailable');
      const data = await response.json();
      if (current !== generation) return;
      rows = Object.freeze(validateTopics(data).map(topic => Object.freeze({...topic,
        options: Object.freeze(topic.options)})));
      status = 'ready';
    } catch (error) {
      if (current !== generation) return;
      rows = Object.freeze([]); status = 'failed'; dataInvalid = error instanceof InvalidTopicsDataError;
    } finally { clearTimeout(timeout); }
    if (current === generation) publish();
  }};
}

export function validateTopics(data) {
  const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const fail = () => { throw new InvalidTopicsDataError('Invalid example topics.'); };
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.categories) || data.categories.length > 100) fail();
  const entries = [], ids = new Set();
  for (const category of data.categories) {
    if (!category || !validText(category.label, 100) || !Array.isArray(category.topics)) fail();
    for (const topic of category.topics) {
      if (!topic || typeof topic.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(topic.id) || ids.has(topic.id) ||
          !validText(topic.title, 160) || !Array.isArray(topic.options) || topic.options.length < 1 || topic.options.length > 100 ||
          !topic.options.every((option) => validText(option, 100))) fail();
      const options = topic.options.map((option) => option.trim());
      if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) fail();
      ids.add(topic.id);
      entries.push({ id: topic.id, title: topic.title.trim(), options, category: category.label.trim() });
      if (entries.length > 1000) fail();
    }
  }
  return entries;
}
