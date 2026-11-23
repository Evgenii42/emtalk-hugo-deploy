// Persist only the progress schema. Unknown legacy/imported fields never become
// live application state. A checkpoint's game schema is restored by core at mount.
import { validTier, validMode, validDuration } from "./options.mjs";

const record = (value) => value !== null && typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value, key) => record(value)
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const count = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;

// Keep valid snapshot data by reference, without regenerating a puzzle here.
// These generous structural limits bound traversal, not gameplay difficulty.
function jsonSnapshot(value) {
  if (!record(value)) return false;
  const pending = [[value, 0]], seen = new WeakSet();
  let nodes = 0, characters = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++nodes > 100000 || depth > 64) return false;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item === "string") {
      characters += item.length;
      if (characters > 1000000) return false;
      continue;
    }
    const array = Array.isArray(item);
    if (!array && !record(item)) return false;
    if (array && (Object.getPrototypeOf(item) !== Array.prototype || item.length > 100000)) return false;
    if (seen.has(item)) return false;
    seen.add(item);
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) return false;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") return false;
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) return false;
      characters += key.length;
      if (characters > 1000000) return false;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!Object.hasOwn(descriptor, "value")) return false;
      pending.push([descriptor.value, depth + 1]);
      if (pending.length > 100000) return false;
    }
  }
  return true;
}

function checkpoint(value, isValidCheckpoint) {
  if (!record(value) || typeof isValidCheckpoint !== "function") return null;
  const snapshot = own(value, "snapshot");
  if (!jsonSnapshot(snapshot)) return null;
  const next = Object.fromEntries(
    ["version", "id", "tier", "seed", "mode", "duration", "activeMs"].map(key => [key, own(value, key)]),
  );
  // Invalid optional fields stay absent so start() can supply its real defaults.
  const earnedXP = own(value, "earnedXP"), level = own(value, "level");
  if (count(earnedXP, Number.MAX_SAFE_INTEGER)) next.earnedXP = earnedXP;
  if (count(level, Number.MAX_SAFE_INTEGER) && level >= 1) next.level = level;
  for (const key of ["bonusAwarded", "intentionSeen"])
    if (typeof own(value, key) === "boolean") next[key] = own(value, key);
  const unhurried = own(value, "unhurried");
  if (unhurried !== undefined) {
    if (typeof unhurried !== "boolean") return null;
    next.unhurried = unhurried;
  }
  next.snapshot = snapshot;
  try {
    return isValidCheckpoint(next) ? next : null;
  } catch {
    return null;
  }
}

// raw may be storage JSON or an already parsed plain JSON record. The returned
// wrappers are new objects; only an accepted, bounded snapshot retains identity.
export function normalizeProgress(raw, { gameIds, stateIds, isValidCheckpoint } = {}) {
  const ids = [...new Set(gameIds || [])], states = new Set(stateIds || []);
  const defaults = () => ({
    version: 1, totalMs: 0, bonusXP: 0, completed: 0,
    levels: Object.fromEntries(ids.map(id => [id, 1])),
    state: "settle", evening: false, last: null,
  });
  const next = defaults();
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const totalMs = own(value, "totalMs"), bonusXP = own(value, "bonusXP");
    // Preserve the old all-or-default gate for incompatible accounting records.
    if (!record(value) || own(value, "version") !== 1 ||
        !Number.isFinite(totalMs) || totalMs < 0 || totalMs >= 1e12 ||
        !Number.isFinite(bonusXP) || bonusXP < 0) return next;
    next.totalMs = totalMs;
    next.bonusXP = Math.min(1e9, Math.floor(bonusXP));
    const completed = own(value, "completed");
    if (count(completed, 1e9)) next.completed = completed;
    const levels = own(value, "levels");
    for (const id of ids) {
      const level = own(levels, id);
      if (count(level, 99999) && level >= 1)
        Object.defineProperty(next.levels, id, { value: level, writable: true, enumerable: true, configurable: true });
    }
    const state = own(value, "state");
    if (states.has(state)) next.state = state;
    next.evening = own(value, "evening") === true;
    next.last = checkpoint(own(value, "last"), isValidCheckpoint);
    const lastStarted = own(value, "lastStartedGameId");
    if (ids.includes(lastStarted)) next.lastStartedGameId = lastStarted;
    const preferences = own(value, "gamePreferences"), entries = [];
    for (const id of ids) {
      const saved = own(preferences, id), accepted = {};
      for (const [key, valid] of [["tier", validTier], ["mode", validMode], ["duration", validDuration]]) {
        const option = own(saved, key);
        if (valid(option)) accepted[key] = option;
      }
      if (id === "moles" && typeof own(saved, "unhurried") === "boolean") accepted.unhurried = own(saved, "unhurried");
      if (Object.keys(accepted).length) entries.push([id, accepted]);
    }
    if (entries.length) next.gamePreferences = Object.fromEntries(entries);
    const reflection = own(value, "lastReflection");
    if (states.has(own(reflection, "state")) && ids.includes(own(reflection, "game")) &&
        ["helpful", "same", "unhelpful"].includes(own(reflection, "value")))
      next.lastReflection = { state: own(reflection, "state"), game: own(reflection, "game"), value: own(reflection, "value") };
    return next;
  } catch {
    return defaults();
  }
}
