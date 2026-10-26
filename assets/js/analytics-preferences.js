// Sole owner of consent persistence and the separate, explicit UI-dismissal marker.
export function createAnalyticsPreferences({ id, now, readLocal, writeLocal, readSession, writeSession }) {
  const key = "emtalk.privacy.v4", dismissalKey = "emtalk.privacy.dismissed.v2";
  const lifetime = 180 * 86400000;
  let blocked = false, legacyRevocationFailed = false;
  function valid(value) {
    return value && Object.keys(value).sort().join(",") === "analytics,at,destination,policy,version" &&
      value.version === 4 && typeof value.analytics === "boolean" && value.destination === id &&
      value.policy === "004" && Number.isSafeInteger(value.at) && value.at >= 0 &&
      value.at <= now() && now() - value.at < lifetime;
  }
  function read() {
    try { const raw = readLocal(key); const value = raw === null ? null : JSON.parse(raw); return valid(value) ? value : null; }
    catch { blocked = true; return null; }
  }
  // Deny-only compatibility for older open tabs. Never migrate an old grant
  // into004 or write an allow record into the old preference namespace.
  function denyLegacy() {
    legacyRevocationFailed = false;
    try {
      const raw = readLocal("emtalk.privacy.v3");
      if (raw === null) return;
      const old = JSON.parse(raw);
      if (!old || Object.keys(old).sort().join(",") !== "analytics,at,destination,policy,version" ||
          old.version !== 3 || typeof old.analytics !== "boolean" || old.destination !== id || old.policy !== "003" ||
          !Number.isSafeInteger(old.at) || old.at < 0 || old.at > now() || now() - old.at >= lifetime) return;
      const denied = JSON.stringify({ ...old, analytics: false });
      writeLocal("emtalk.privacy.v3", denied);
      if (readLocal("emtalk.privacy.v3") !== denied) legacyRevocationFailed = true;
    } catch { legacyRevocationFailed = true; }
  }
  function save(analytics) {
    try {
      writeLocal(key, JSON.stringify({ version: 4, analytics, at: now(), destination: id, policy: "004" }));
      blocked = false;
      const stored = read();
      if (valid(stored) && stored.analytics === analytics) {
        if (!analytics) denyLegacy();
        return stored;
      }
    } catch { /* A failed write cannot create a session-only grant. */ }
    blocked = true; return null;
  }
  function dismissed() { try { return readSession(dismissalKey) === "004"; } catch { return false; } }
  function dismissExplicitly() { try { writeSession(dismissalKey, "004"); } catch { /* A later page may prompt again. */ } }
  return Object.freeze({ key, lifetime, read, save, valid, dismissed, dismissExplicitly, isBlocked: () => blocked, legacyRevocationFailed: () => legacyRevocationFailed });
}
