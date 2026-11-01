// Pure route, schema and redaction owner. No queues, DOM writes or storage.
export function createAnalyticsPayload({ policy, configuration, origin, pathname, referrer }) {
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const id = configuration.emtalkAnalytics || "";
  const canonical = origin === "https://www.emtalk.org";
  const route = policy.routes?.[configuration.emtalkRoute];
  const context = route && policy.contexts?.[route.context];
  // This schema belongs only to the private Google transport port. It is
  // absent from public schemas/routes, so emit("scroll", ...) stays rejected
  // and Umami never receives this Google-only standard threshold signal.
  const scrollSchema = { provider: "google", eventName: "scroll", schema: { type: "object",
    properties: { percent_scrolled: { type: "integer", const: 90 } },
    required: ["percent_scrolled"], additionalProperties: false } };
  const exact = (left, right) => {
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(right);
    return Object.keys(left).length === keys.length && keys.every(key => own(left, key) && exact(left[key], right[key]));
  };
  const scrollReady = exact(policy.transportOnly?.googleScroll, scrollSchema);
  const googleScroll = () => scrollReady ? Object.freeze({ percent_scrolled: 90 }) : null;
  // Private transport contract. Exact reviewed origins become enum labels only;
  // no referring path, query, fragment or persistent attribution is retained.
  const acquisitionContract = { provider: "umami", eventName: "emtalk_acquisition", version: "001",
    origins: {
      "https://chatgpt.com": "chatgpt", "https://www.perplexity.ai": "perplexity",
      "https://claude.ai": "claude", "https://copilot.microsoft.com": "copilot",
      "https://copilot.com": "copilot", "https://gemini.google.com": "gemini",
      "https://www.google.com": "google", "https://www.google.ca": "google",
      "https://www.google.co.uk": "google", "https://www.google.de": "google",
      "https://www.google.fr": "google", "https://www.google.es": "google",
      "https://www.google.it": "google", "https://www.google.nl": "google",
      "https://www.google.kz": "google", "https://www.bing.com": "bing",
      "https://duckduckgo.com": "duckduckgo", "https://search.yahoo.com": "yahoo",
      "https://yandex.ru": "yandex", "https://yandex.com": "yandex"
    },
    channels: { chatgpt: "ai_referral", perplexity: "ai_referral", claude: "ai_referral",
      copilot: "ai_referral", gemini: "ai_referral", google: "organic", bing: "organic",
      duckduckgo: "organic", yahoo: "organic", yandex: "organic" } };
  const routeEligible = canonical && configuration.emtalkRoute === pathname && policy.version === "004" &&
    !!context && route.events.includes("page_view");
  const eligible = scrollReady && routeEligible && configuration.emtalkAnalyticsAllowed === "true" &&
    configuration.emtalkProviderReviewed === "true" && /^G-[A-Z0-9]+$/.test(id);
  // Umami has an independently reviewed production gate. Google configuration,
  // consent storage, consent UI and private Google scroll schema cannot grant or
  // suppress this closed-payload cookieless transport.
  const umamiEligible = routeEligible && policy.providerActivation?.umami?.mode === "immediate" &&
    policy.providerActivation.umami.independentOfGoogleChoice === true && configuration.emtalkUmamiAllowed === "true" &&
    configuration.emtalkUmamiReviewed === "true";
  const acquisition = (() => {
    if (!umamiEligible || !exact(policy.transportOnly?.umamiAcquisition, acquisitionContract) ||
        typeof referrer !== "string" || referrer.length > 4096 || /[\x00-\x20\x7f]/.test(referrer)) return null;
    try {
      const url = new URL(referrer);
      if (url.protocol !== "https:" || url.username || url.password || !own(acquisitionContract.origins, url.origin)) return null;
      const source = acquisitionContract.origins[url.origin];
      return Object.freeze({ contract_version: "004", page_context: route.context,
        acquisition_version: "001", channel: acquisitionContract.channels[source], source });
    } catch { return null; }
  })();
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
  function product() {
    const value = policy.feedbackProducts?.[configuration.emtalkRoute];
    return ["emtalk", "bret", "dm", "tapl"].includes(value) ? value : "not_applicable";
  }
  function validate(name, params) {
    if (name === "scroll" || name === "emtalk_acquisition") return null; // Transport-owned signals, never public actions.
    const schema = policy.schemas?.[name];
    if (!schema || !route?.events.includes(name) || !params || typeof params !== "object" || Array.isArray(params)) return null;
    const payload = { event_name: name, contract_version: "004", page_context: route.context };
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
    if (name === "emtalk_interest_state" && payload.product !== product()) return null;
    if (name === "emtalk_catalog_filter") {
      if (route.context === "news_catalog") {
        if (!["all", "project", "product", "reading"].includes(payload.filter_group) ||
            (payload.action === "reset" && payload.filter_group !== "all") ||
            (payload.action === "filter" && payload.filter_group === "all")) return null;
      } else if (own(payload, "filter_group")) return null;
    }
    if (name === "emtalk_navigation" &&
        ((payload.destination_kind === "trial_entry" && !["bret", "dm"].includes(payload.destination_product)) ||
         (payload.destination_kind === "app_landing" && !["bret", "dm", "tapl"].includes(payload.destination_product)) ||
         (!["trial_entry", "app_landing"].includes(payload.destination_kind) && payload.destination_product !== "not_applicable"))) return null;
    if (name === "emtalk_trial_state" && (payload.product !== route.product || (payload.product === "bret" && payload.state === "resumed"))) return null;
    if (name === "emtalk_store_click" && route.product && payload.product !== route.product) return null;
    if (["emtalk_audio_state", "emtalk_trial_state", "emtalk_assessment_state"].includes(name)) {
      const error = payload.state === (name === "emtalk_assessment_state" ? "result_failed" : "error");
      if (error === (payload.error_kind === "not_applicable")) return null;
    }
    delete payload.event_name; return payload;
  }
  return Object.freeze({ id, canonical, eligible, umamiEligible, fields, validate, googleScroll,
    umamiAcquisition: () => acquisition, context: () => route?.context || null, product });
}
