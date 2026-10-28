// Sole owner of consent persistence and the separate, explicit UI-dismissal marker.
export function createAnalyticsPreferences({ id, now, readLocal, writeLocal, readSession, writeSession }) {
  const key = "emtalk.privacy.v5", dismissalKey = "emtalk.privacy.dismissed.v3";
  const lifetime = 180 * 86400000;
  let readBlocked = false, writeBlocked = false, legacyRevocationFailed = false;
  function valid(value) {
    return value && Object.keys(value).sort().join(",") === "analytics,at,destination,policy,version" &&
      value.version === 5 && typeof value.analytics === "boolean" && value.destination === id &&
      value.policy === "005" && Number.isSafeInteger(value.at) && value.at >= 0 &&
      value.at <= now() && now() - value.at < lifetime;
  }
  function read() {
    try { const raw = readLocal(key); const value = raw === null ? null : JSON.parse(raw); readBlocked = false; return valid(value) ? value : null; }
    catch { readBlocked = true; return null; }
  }
  // Deny-only compatibility for older open tabs. Never migrate an old grant
  // into 005 or write an allow record into the old preference namespace.
  // Only the two known previous schemas (v3/v4) are denied. Unknown keys are
  // not parsed or rewritten and can never grant consent to the v5 runtime.
  function denyLegacy() {
    legacyRevocationFailed = false;
    for (const version of [3, 4]) {
      try {
        const oldKey = `emtalk.privacy.v${version}`;
        const raw = readLocal(oldKey);
        if (raw === null) continue;
        const old = JSON.parse(raw);
        if (!old || Object.keys(old).sort().join(",") !== "analytics,at,destination,policy,version" ||
            old.version !== version || typeof old.analytics !== "boolean" || old.destination !== id || old.policy !== `00${version}` ||
            !Number.isSafeInteger(old.at) || old.at < 0 || old.at > now() || now() - old.at >= lifetime) continue;
        const denied = JSON.stringify({ ...old, analytics: false });
        writeLocal(oldKey, denied);
        if (readLocal(oldKey) !== denied) legacyRevocationFailed = true;
      } catch { legacyRevocationFailed = true; }
    }
  }
  function save(analytics) {
    try {
      writeLocal(key, JSON.stringify({ version: 5, analytics, at: now(), destination: id, policy: "005" }));
      writeBlocked = false;
      const stored = read();
      if (valid(stored) && stored.analytics === analytics) {
        denyLegacy();
        return stored;
      }
    } catch { /* A failed write cannot create a session-only grant. */ }
    writeBlocked = true; return null;
  }
  function dismissed() { try { return readSession(dismissalKey) === "005"; } catch { return false; } }
  function dismissExplicitly() { try { writeSession(dismissalKey, "005"); } catch { /* A later page may prompt again. */ } }
  return Object.freeze({ key, lifetime, read, save, valid, dismissed, dismissExplicitly, isBlocked: () => readBlocked || writeBlocked, legacyRevocationFailed: () => legacyRevocationFailed });
}
