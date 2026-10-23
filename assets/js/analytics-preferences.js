// Sole owner of consent persistence and the separate, explicit UI-dismissal marker.
export function createAnalyticsPreferences({ id, now, readLocal, writeLocal, readSession, writeSession }) {
  const key = "emtalk.privacy.v3", dismissalKey = "emtalk.privacy.dismissed.v1";
  const lifetime = 180 * 86400000;
  let blocked = false;
  function valid(value) {
    return value && Object.keys(value).sort().join(",") === "analytics,at,destination,policy,version" &&
      value.version === 3 && typeof value.analytics === "boolean" && value.destination === id &&
      value.policy === "003" && Number.isSafeInteger(value.at) && value.at >= 0 &&
      value.at <= now() && now() - value.at < lifetime;
  }
  function read() {
    try { const raw = readLocal(key); const value = raw === null ? null : JSON.parse(raw); return valid(value) ? value : null; }
    catch { blocked = true; return null; }
  }
  function save(analytics) {
    try {
      writeLocal(key, JSON.stringify({ version: 3, analytics, at: now(), destination: id, policy: "003" }));
      blocked = false;
      const stored = read();
      if (valid(stored) && stored.analytics === analytics) return stored;
    } catch { /* A failed write cannot create a session-only grant. */ }
    blocked = true; return null;
  }
  function dismissed() { try { return readSession(dismissalKey) === "003"; } catch { return false; } }
  function dismissExplicitly() { try { writeSession(dismissalKey, "003"); } catch { /* A later page may prompt again. */ } }
  return Object.freeze({ key, lifetime, read, save, valid, dismissed, dismissExplicitly, isBlocked: () => blocked });
}
