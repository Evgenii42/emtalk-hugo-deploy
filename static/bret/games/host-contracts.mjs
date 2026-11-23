import { IDS, UNHURRIED_VERSION } from "./core.mjs";
import { validTier, validMode, validDuration } from "./options.mjs";

// Advance one visible frame in bounded simulation steps. A completed or paused
// scene stops receiving ticks; callers credit only the returned elapsed time.
// A thrown tick propagates so callers can discard accounting for a failed frame.
export function advanceSceneFrame(controller, dt, {
  shouldContinue = () => true,
  hasCompleted = () => false,
} = {}) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 2) return 0;
  let remaining = dt;
  while (remaining > 0 && shouldContinue() && !hasCompleted()) {
    const step = Math.min(remaining, 0.04);
    controller.tick(step);
    remaining -= step;
  }
  return Math.min(dt, dt - remaining);
}

// Validate the host envelope only. The controller validates the seeded snapshot
// before resuming it; an object here does not certify playable game state.
export function isValidSavedRun(x) {
  return (
    x &&
    x.version === 1 &&
    IDS.includes(x.id) &&
    validTier(x.tier) &&
    Number.isInteger(x.seed) &&
    Number.isFinite(x.activeMs) &&
    x.activeMs >= 0 &&
    x.activeMs < 1e10 &&
    validMode(x.mode) &&
    validDuration(x.duration) &&
    x.snapshot &&
    typeof x.snapshot === "object" &&
    x.snapshot.done !== true &&
    (x.unhurried === undefined || typeof x.unhurried === "boolean") &&
    (x.snapshot.unhurried === undefined || typeof x.snapshot.unhurried === "boolean") &&
    (x.unhurried !== true || x.id === "moles") &&
    (x.unhurried !== true || x.snapshot.version === UNHURRIED_VERSION) &&
    (x.unhurried === true) === (x.snapshot.unhurried === true)
  );
}
