// Immutable published044 joint-choice recipient, unrelated to current Google configuration.
const HISTORICAL_JOINT_DESTINATION = "G-B579M2BRST";
// Google-only consent persistence, its UI-dismissal marker, and a separate read-only legacy objection port.
export function createAnalyticsPreferences({ id, now, readLocal, writeLocal, readSession, writeSession }) {
  const key = "emtalk.privacy.v6", dismissalKey = "emtalk.privacy.dismissed.v4";
  const lifetime = 180 * 86400000;
  let readBlocked = false, writeBlocked = false, legacyRevocationFailed = false;
  function valid(value) {
    return value && Object.keys(value).sort().join(",") === "analytics,at,destination,policy,version" &&
      value.version === 6 && typeof value.analytics === "boolean" && value.destination === id &&
      value.policy === "006" && Number.isSafeInteger(value.at) && value.at >= 0 &&
      value.at <= now() && now() - value.at < lifetime;
  }
  function read() {
    try { const raw = readLocal(key); const value = raw === null ? null : JSON.parse(raw); readBlocked = false; return valid(value) ? value : null; }
    catch { readBlocked = true; return null; }
  }
  // No grants are migrated into Google-only006. Older Google grants are
  // denied conservatively; a valid v5 joint rejection is preserved byte-for-
  // byte because it also expressed an Umami objection in the published044 UI.
  function denyLegacy() {
    legacyRevocationFailed = false;
    for (const version of [3, 4, 5]) {
      try {
        const oldKey = `emtalk.privacy.v${version}`;
        const raw = readLocal(oldKey);
        if (raw === null) continue;
        const old = JSON.parse(raw);
        if (!old || Object.keys(old).sort().join(",") !== "analytics,at,destination,policy,version" ||
            old.version !== version || typeof old.analytics !== "boolean" || old.destination !== (version === 5 ? HISTORICAL_JOINT_DESTINATION : id) || old.policy !== `00${version}` ||
            !Number.isSafeInteger(old.at) || old.at < 0 || old.at > now() || now() - old.at >= lifetime) continue;
        if (version === 5 && old.analytics === false) continue;
        // Not a v5 consent record: old044 rejects this tombstone, while the
        // separate Umami compatibility reader cannot mistake it for a joint
        // rejection. Never manufacture an objection by writing validv5false.
        const denied = version === 5 ? JSON.stringify({ version: 5, revocation: "google-only-v6", at: old.at }) :
          JSON.stringify({ ...old, analytics: false });
        writeLocal(oldKey, denied);
        if (readLocal(oldKey) !== denied) legacyRevocationFailed = true;
      } catch { legacyRevocationFailed = true; }
    }
  }
  function save(analytics) {
    try {
      writeLocal(key, JSON.stringify({ version: 6, analytics, at: now(), destination: id, policy: "006" }));
      writeBlocked = false;
      const stored = read();
      if (valid(stored) && stored.analytics === analytics) {
        denyLegacy();
        return stored;
      }
    } catch { /* A failed write cannot create a session-only grant. */ }
    writeBlocked = true; return null;
  }
  function dismissed() { try { return readSession(dismissalKey) === "006"; } catch { return false; } }
  function dismissExplicitly() { try { writeSession(dismissalKey, "006"); } catch { /* A later page may prompt again. */ } }
  return Object.freeze({ key, lifetime, read, save, valid, dismissed, dismissExplicitly, isBlocked: () => readBlocked || writeBlocked, legacyRevocationFailed: () => legacyRevocationFailed });
}

// Read-only compatibility exception, independent of current Google preferences
// and their UI/write path. Only a storage-access exception is unreadable and
// pauses Umami. A missing, malformed, mismatched or expired stored value is not
// a valid historical objection; never manufacture a new objection from it.
export function createUmamiLegacyObjection({ now, readLocal }) {
  const key = "emtalk.privacy.v5", lifetime = 180 * 86400000;
  function read() {
    let raw;
    try { raw = readLocal(key); } catch { return { blocked: true, unreadable: true, expiresAt: null }; }
    let old;
    try { old = raw === null ? null : JSON.parse(raw); } catch { return { blocked: false, unreadable: false, expiresAt: null }; }
    const valid = old && Object.keys(old).sort().join(",") === "analytics,at,destination,policy,version" &&
      old.version === 5 && old.analytics === false && old.destination === HISTORICAL_JOINT_DESTINATION && old.policy === "005" &&
      Number.isSafeInteger(old.at) && old.at >= 0 && old.at <= now() && now() - old.at < lifetime;
    return { blocked: !!valid, unreadable: false, expiresAt: valid ? old.at + lifetime : null };
  }
  return Object.freeze({ key, read });
}
