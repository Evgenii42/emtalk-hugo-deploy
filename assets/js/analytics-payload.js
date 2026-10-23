// Pure route, schema and redaction owner. No queues, DOM writes or storage.
export function createAnalyticsPayload({ policy, configuration, origin, pathname, referrer }) {
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const id = configuration.emtalkAnalytics || "";
  const canonical = origin === "https://www.emtalk.org";
  const route = policy.routes?.[configuration.emtalkRoute];
  const context = route && policy.contexts?.[route.context];
  const eligible = canonical && configuration.emtalkRoute === pathname && policy.version === "003" &&
    configuration.emtalkAnalyticsAllowed === "true" && configuration.emtalkProviderReviewed === "true" &&
    /^G-[A-Z0-9]+$/.test(id) && !!context && route.events.includes("page_view");
  function sourceFields() {
    const unknown = { page_referrer: "", campaign_source: "unknown", campaign_medium: "unknown" };
    try {
      const url = new URL(referrer), source = policy.searchOrigins?.[url.origin];
      if (url.protocol !== "https:" || url.username || url.password || !["google", "bing", "duckduckgo", "yahoo", "yandex"].includes(source)) return unknown;
      return { page_referrer: url.origin + "/", campaign_source: source, campaign_medium: "organic" };
    } catch { return unknown; }
  }
  const fields = context ? Object.freeze({ page_location: context.location, page_title: context.title,
    ...sourceFields(), campaign_name: "not_set", campaign_id: "not_set", campaign_term: "not_set",
    campaign_content: "not_set", ignore_referrer: true }) : {};
  function validate(name, params) {
    const schema = policy.schemas?.[name];
    if (!schema || !route?.events.includes(name) || !params || typeof params !== "object" || Array.isArray(params)) return null;
    const payload = { event_name: name, contract_version: "003", page_context: route.context };
    for (const key of Object.keys(params)) {
      if (["event_name", "contract_version", "page_context"].includes(key) || !own(schema.properties, key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(params, key);
      if (!descriptor || !own(descriptor, "value")) return null;
      payload[key] = descriptor.value;
    }
    for (const key of schema.required) if (!own(payload, key)) return null;
    for (const [key, value] of Object.entries(payload)) {
      const def = schema.properties[key];
      if (!def || (def.type === "integer" && !Number.isInteger(value)) || (def.type === "string" && typeof value !== "string") ||
          (own(def, "const") && value !== def.const) || (def.enum && !def.enum.includes(value))) return null;
    }
    if (name === "emtalk_trial_state" && (params.product !== route.product || (params.product === "bret" && params.state === "resumed"))) return null;
    if (name === "emtalk_store_click" && route.product && params.product !== route.product) return null;
    if (["emtalk_audio_state", "emtalk_trial_state", "emtalk_assessment_state"].includes(name)) {
      const error = params.state === (name === "emtalk_assessment_state" ? "result_failed" : "error");
      if (error === (params.error_kind === "not_applicable")) return null;
    }
    delete payload.event_name; return payload;
  }
  return Object.freeze({ id, canonical, eligible, fields, validate, context: () => route?.context || null });
}
