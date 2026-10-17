// Static authored topics are candidate lists, not saved decisions or AI results.
const MAX_CATEGORIES = 20, MAX_TOPICS = 500, MAX_OPTIONS = 5000;
const MAX_CANDIDATES = 24, MAX_BYTES = 3000000;
function requireValue(value) {
  if (!value) throw new Error("Invalid topic catalog.");
}
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && keys.includes(key) &&
      Object.hasOwn(descriptor, "value") && descriptor.enumerable;
  });
}
function list(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < 1 || value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return false;
  }
  return true;
}
const text = (value, maximum) => typeof value === "string" &&
  value.length <= maximum && value.trim().length > 0;
const id = value => text(value, 80) && /^[a-zA-Z0-9_-]+$/.test(value);

export function validateTopics(value) {
  requireValue(record(value, ["schemaVersion", "categories"]) && value.schemaVersion === 1);
  requireValue(list(value.categories, MAX_CATEGORIES));
  const categoryIds = new Set(), topicIds = new Set();
  let optionCount = 0;
  const categories = value.categories.map(category => {
    requireValue(record(category, ["id", "label", "topics"]) &&
      id(category.id) && !categoryIds.has(category.id) && text(category.label, 160) &&
      list(category.topics, MAX_TOPICS));
    categoryIds.add(category.id);
    const topics = category.topics.map(topic => {
      requireValue(record(topic, ["id", "title", "options"]) &&
        id(topic.id) && !topicIds.has(topic.id) && text(topic.title, 160) &&
        list(topic.options, MAX_CANDIDATES));
      topicIds.add(topic.id);
      requireValue(topicIds.size <= MAX_TOPICS);
      const options = new Set();
      for (const option of topic.options) {
        requireValue(text(option, 100));
        const normalized = option.trim().toLowerCase();
        requireValue(!options.has(normalized));
        options.add(normalized);
      }
      optionCount += topic.options.length;
      requireValue(optionCount <= MAX_OPTIONS);
      return { id: topic.id, title: topic.title, options: [...topic.options] };
    });
    return { id: category.id, label: category.label, topics };
  });
  return { schemaVersion: 1, categories };
}

export function parseTopics(raw) {
  requireValue(typeof raw === "string" && new TextEncoder().encode(raw).length <= MAX_BYTES);
  return validateTopics(JSON.parse(raw));
}
