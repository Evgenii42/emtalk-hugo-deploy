/* Selection is UI state, independent of checkpoint/accounting state.
 * Call rememberGameStarted only after a game mounts successfully. Browsing or
 * editing settings must use the pure getters and must not call that function.
 */
import { DEFAULTS, validTier, validMode, validDuration } from "./options.mjs";
const GAME_IDS = ["moles", "firefly", "order", "landscape"];
const record = (value) =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const own = (value, key) =>
  record(value)
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
const validId = (id) => typeof id === "string" && GAME_IDS.includes(id);
function preferences(value) {
  const tier = own(value, "tier"),
    mode = own(value, "mode"),
    duration = own(value, "duration");
  return validTier(tier) && validMode(mode) && validDuration(duration)
    ? { tier, mode, duration }
    : null;
}
function fallbackPreferences(value) {
  const tier = own(value, "tier"),
    mode = own(value, "mode"),
    duration = own(value, "duration");
  return {
    tier: validTier(tier) ? tier : DEFAULTS.tier,
    mode: validMode(mode) ? mode : DEFAULTS.mode,
    duration: validDuration(duration) ? duration : DEFAULTS.duration,
  };
}

export function getLastStartedGame(db) {
  const id = own(db, "lastStartedGameId");
  if (validId(id)) return id;
  const legacy = own(own(db, "last"), "id");
  return validId(legacy) ? legacy : "moles";
}

export function getGamePreferences(db, id, fallback) {
  const selected = validId(id)
    ? preferences(own(own(db, "gamePreferences"), id))
    : null;
  return selected || fallbackPreferences(fallback);
}

function writableOwn(db, key) {
  const property = Object.getOwnPropertyDescriptor(db, key);
  return property
    ? Object.hasOwn(property, "value") && property.writable
    : Object.isExtensible(db);
}

export function rememberGameStarted(db, run) {
  const id = own(run, "id"),
    selected = preferences(run);
  if (
    !record(db) ||
    !validId(id) ||
    !selected ||
    !writableOwn(db, "lastStartedGameId") ||
    !writableOwn(db, "gamePreferences")
  )
    return false;
  // Keep other valid game preferences, with no run/seed/snapshot/XP references.
  const previous = own(db, "gamePreferences"),
    next = {};
  for (const gameId of GAME_IDS) {
    const saved = preferences(own(previous, gameId));
    if (saved) next[gameId] = saved;
  }
  next[id] = selected;
  const descriptor = (key, value) =>
    Object.hasOwn(db, key)
      ? { value }
      : { value, writable: true, enumerable: true, configurable: true };
  Object.defineProperties(db, {
    lastStartedGameId: descriptor("lastStartedGameId", id),
    gamePreferences: descriptor("gamePreferences", next),
  });
  return true;
}
