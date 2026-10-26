// Optional, coarse public interface measurement. The owned emitter is the only
// transport and validates route/context/payload again. Nothing is queued here.
const initialized = new WeakSet();
// Hugo can bundle this helper into several independent entry modules. A shared
// document guard, rather than only a module-local WeakSet, prevents duplicates.
const publicEventsGuard = Symbol.for('emtalk.publicMeasurement004');
// A true result acknowledges the local consented queue only. Callers use it
// to deduplicate within this document; it is never a Google delivery receipt.
export function emitInterfaceEvent(name, parameters) {
  try {
    const analytics = window.EmTalkAnalytics;
    return analytics?.canTrack() === true && analytics.emit(name, parameters) === true;
  } catch { return false; }
}

export function analyticsEpoch() {
  try {
    const analytics = window.EmTalkAnalytics;
    const epoch = analytics?.canTrack() === true ? analytics.epoch() : null;
    return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
  } catch { return null; }
}

// Explicit ports for the shared feedback controller. No form/receipt/reference
// is accepted here. The caller announces factual transitions, never DOM text.
export function createInterestMeasurement() {
  let generation = 0, saved = false, placement = 'page_prompt';
  const placements = ['page_prompt','feature_prompt','footer','tool_exit','news_cta'];
  const clear = () => { generation += 1; saved = false; };
  window.addEventListener('emtalk:analytics-consent', clear);
  window.addEventListener('pagehide', clear);
  const send = (state, surface) => {
    try {
      const product = window.EmTalkAnalytics?.product?.();
      return emitInterfaceEvent('emtalk_interest_state', {state, surface, product});
    } catch { return false; } // Measurement must never interrupt feedback delivery.
  };
  return Object.freeze({
    opened(surface = 'page_prompt') {
      if (!placements.includes(surface)) return false;
      placement = surface;
      return send('opened', placement);
    },
    newSubmission() { generation += 1; saved = false; },
    attempt() {
      const epoch = analyticsEpoch(), current = generation, surface = placement;
      const armed = epoch !== null && send('submit_attempt', surface);
      let settled = false;
      const finish = state => {
        if (settled) return false;
        settled = true;
        if (!armed || current !== generation || analyticsEpoch() !== epoch || (state === 'saved' && saved)) return false;
        const accepted = send(state, surface);
        if (accepted && state === 'saved') saved = true;
        return accepted;
      };
      return Object.freeze({saved: () => finish('saved'), rejected: () => finish('rejected'), unconfirmed: () => finish('unconfirmed')});
    },
  });
}

// News UI owns whether a user selection actually changed the visible set.
// This port rejects every other value and never reads a topic/search field.
export function emitNewsFilter(group) {
  if (!['all','project','product','reading'].includes(group)) return false;
  return emitInterfaceEvent('emtalk_catalog_filter', {action:group === 'all' ? 'reset' : 'filter', filter_group:group});
}

// Only explicit Home preview actions are measured. Automatic preview timing,
// restoration and initial state never call this port or replay after consent.
export function emitNewsPreview(action) {
  if (!['open', 'close'].includes(action)) return false;
  try {
    if (window.EmTalkAnalytics?.context?.() !== 'home') return false;
    return emitInterfaceEvent('emtalk_news_preview', {action});
  } catch { return false; }
}

// A player attempt is armed only by its explicit Play action after consent.
// Latches contain no media/content identity and never leave this closure.
export function createAudioMeasurement() {
  let epoch = null, armed = false, started = false, pausedByUser = false;
  let ended = false, failed = false, cycleActuallyStarted = false, pauseReported = false;
  const clear = () => {
    epoch = null; armed = false; started = false; pausedByUser = false; pauseReported = false;
    // Preserve the factual cycle boundary across consent changes. Opting in
    // while an old unmeasured audio cycle is paused cannot manufacture a start.
  };
  window.addEventListener('emtalk:analytics-consent', clear);
  window.addEventListener('pagehide', clear);
  const active = () => armed && epoch !== null && analyticsEpoch() === epoch;
  const send = (state, error_kind = 'not_applicable') =>
    active() && emitInterfaceEvent('emtalk_audio_state', {state, error_kind});
  return {
    attempt() {
      if (ended || failed) { clear(); ended = false; failed = false; cycleActuallyStarted = false; }
      // An unmeasured cycle cannot be armed by opting in halfway through it.
      if (!armed && !cycleActuallyStarted) { epoch = analyticsEpoch(); armed = epoch !== null; }
      failed = false;
    },
    playing() {
      cycleActuallyStarted = true;
      if (!started) { if (!send('start')) armed = false; started = true; }
      else if (pausedByUser) send('resume');
      pausedByUser = false;
    },
    pauseByUser() { pausedByUser = started && !ended; pauseReported = false; },
    paused() { if (pausedByUser && !ended && !pauseReported) { send('pause'); pauseReported = true; } },
    ended() { if (cycleActuallyStarted && !ended) { send('ended'); ended = true; pausedByUser = false; } },
    error(kind) {
      if (!failed) { send('error', kind); failed = true; pausedByUser = false; }
    },
    // A lifecycle interruption clears consented latches but is not a new cycle.
    suspend() { clear(); },
    cancel() {
      // Cancellation ends this attempt. Unlike consent/pagehide clearing, it
      // permits a later explicit Play to arm a fresh cycle without replay.
      clear(); ended = false; failed = false; cycleActuallyStarted = false;
    },
  };
}

function localPath(link) {
  try {
    const url = new URL(link.getAttribute('href'), document.baseURI);
    const page = new URL(document.baseURI);
    if (url.origin !== page.origin && url.origin !== 'https://www.emtalk.org') return null;
    const prefix = (document.documentElement.dataset.mountPrefix || '').replace(/\/$/, '');
    if (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return null;
    const path = prefix ? url.pathname.slice(prefix.length) || '/' : url.pathname;
    return path;
  } catch { return null; }
}

function surface(link) {
  const value = link.closest('[data-analytics-surface]')?.getAttribute('data-analytics-surface');
  return ['header','footer','home_choices','public_cta','article_card','related_reading',
    'tool_exit','catalog','news_card','news_cta','ecosystem_step'].includes(value) ? value : 'public_cta';
}

function navigationRoutes() {
  const result = new Map();
  try {
    const nodes = document.querySelectorAll('#emtalk-analytics-policy');
    if (nodes.length !== 1) return result;
    const policy = JSON.parse(nodes[0].textContent);
    const schema = policy.schemas?.emtalk_navigation;
    const contexts = schema?.properties?.page_context?.enum;
    if (policy.version !== '004' || schema?.properties?.event_name?.const !== 'emtalk_navigation'
        || schema?.properties?.contract_version?.const !== '004' || !Array.isArray(contexts)
        || !policy.contexts || typeof policy.contexts !== 'object' || Array.isArray(policy.contexts)
        || !policy.routes || typeof policy.routes !== 'object' || Array.isArray(policy.routes)) return result;
    const entries = Object.entries(policy.routes);
    if (!entries.length || entries.length > 500) return result;
    for (const [path, row] of entries) {
      if (!path.startsWith('/') || path.includes('//') || /[?#\\\s]/.test(path)
          || new URL(path, 'https://www.emtalk.org').pathname !== path || !row
          || typeof row !== 'object' || Array.isArray(row) || !Array.isArray(row.events)) return new Map();
      if (row.context === null && row.product === null && row.events.length === 0) continue;
      if (!contexts.includes(row.context) || !Object.prototype.hasOwnProperty.call(policy.contexts, row.context)
          || !row.events.includes('page_view') || !row.events.every(event =>
            typeof event === 'string' && Object.prototype.hasOwnProperty.call(policy.schemas, event))) return new Map();
      if (row.context === 'web_trial' ? !['bret','dm'].includes(row.product) : row.product !== null) return new Map();
      result.set(path, row.context);
    }
  } catch { return new Map(); }
  return result;
}

function destination(link, routes) {
  const path = localPath(link);
  const context = routes.get(path);
  if (path !== null && !context) return null;
  if (context === 'web_trial') return 'trial_entry';
  if (context === 'bret_landing' || context === 'dm_landing' || context === 'tapl') return 'app_landing';
  // Only the category is sent, never the assessment/content route itself.
  if (context === 'assessment') return 'assessment_entry';
  if (context === 'documents') return 'documents';
  if (path !== null) return 'public_content';
  try {
    const url = new URL(link.getAttribute('href'), document.baseURI);
    // Exact existing owned profiles only, not arbitrary links on those domains.
    if (['https://t.me/EmTalk_inc', 'https://www.facebook.com/emtalkinc/',
      'https://www.instagram.com/emtalk.inc/'].includes(url.href)) return 'external_public';
  } catch { /* Unknown destinations stay unmeasured. */ }
  return null;
}

function storeProduct(link) {
  try {
    const url = new URL(link.getAttribute('href'), document.baseURI);
    if (url.origin !== 'https://play.google.com' || url.pathname !== '/store/apps/details'
        || url.username || url.password || url.searchParams.getAll('id').length !== 1) return null;
    const packageName = url.searchParams.get('id');
    return packageName === 'com.bret' ? 'bret' : packageName === 'org.emtalk.dm' ? 'dm' : null;
  } catch { return null; }
}

export function initPublicMeasurement(root = document) {
  if (initialized.has(root) || root[publicEventsGuard] === true) return;
  initialized.add(root);
  root[publicEventsGuard] = true;
  const routes = navigationRoutes();
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element) || event.button !== 0 || event.defaultPrevented) return;
    const link = event.target.closest('a[href]');
    if (event.target.closest('[data-analytics-ignore]')) return;
    if (!link || link.hasAttribute('download') || link.getAttribute('aria-disabled') === 'true') return;
    // The native click also covers keyboard activation. We do not double count
    // pointerdown/keydown or prevent/change navigation, including modified clicks.
    const href = link.getAttribute('href');
    const readerAction = link.getAttribute('data-analytics-article-action');
    if (['read_anchor','listen_anchor'].includes(readerAction)) {
      emitInterfaceEvent('emtalk_article_action', {action:readerAction});
      return;
    }
    if (!href || href.startsWith('#')) return;
    const product = storeProduct(link);
    if (product) {
      const placement = surface(link);
      const route = document.documentElement.dataset.routeId;
      emitInterfaceEvent('emtalk_store_click', {product, store:'google_play',
        surface: placement === 'tool_exit' ? 'tool_exit' : ['/bret','/dm'].includes(route) ? 'app_landing' : 'public_cta'});
      return;
    }
    const kind = destination(link, routes);
    if (kind) {
      const fixedProducts = {'/bret':'bret','/bret/practice':'bret','/dm':'dm','/dm/workspace':'dm','/tapl':'tapl'};
      emitInterfaceEvent('emtalk_navigation', {surface:surface(link), destination_kind:kind,
        destination_product:fixedProducts[localPath(link)] || 'not_applicable'});
    }
  });

  for (const details of root.querySelectorAll('details[data-analytics-article-action="contents_open"]')) {
    const summary = details.querySelector('summary');
    // Only an explicit accepted opening counts, not restored/programmatic open.
    summary?.addEventListener('click', () => {
      if (details.open) return;
      const epoch = analyticsEpoch();
      setTimeout(() => {
        if (epoch !== null && analyticsEpoch() === epoch && details.open) emitInterfaceEvent('emtalk_article_action', {action:'contents_open'});
      }, 0);
    });
  }
  // Article progress is optional and omitted until visible-time and body reach
  // semantics have independent acceptance. Position is never sent as listening.
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initPublicMeasurement(), {once:true});
  else initPublicMeasurement();
}
