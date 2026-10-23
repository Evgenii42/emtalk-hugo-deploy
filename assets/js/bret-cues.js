import { resumeCueAction, metronomeBeatKey } from "./bret-transitions.js";

// Session owns elapsed time. This machine owns only emitted cue positions.
// Paused rendering never claims a phase, and claims precede synchronous effects.
export function createPracticeCues() {
  let state = { phaseIndex: -1, beat: null, interruptedBreathIndex: null };
  return Object.freeze({
    begin() { state = { phaseIndex: -1, beat: null, interruptedBreathIndex: null }; },
    claimPhase(index, emit) {
      const changed = state.phaseIndex !== index;
      if (emit && changed) state.phaseIndex = index;
      return changed;
    },
    claimBeat(position) {
      const beat = metronomeBeatKey(position);
      if (beat === null || beat === state.beat) return false;
      state.beat = beat;
      return true;
    },
    invalidatePhase() { state.phaseIndex = -1; },
    finish() { state.interruptedBreathIndex = null; },
    dispose({ kind, hasNarration }) {
      if (kind === "breath" && hasNarration)
        state.interruptedBreathIndex = state.phaseIndex;
    },
    resume({ kind, index, hasNarration, voiceEnabled }) {
      const sameStep = state.phaseIndex === index;
      const action = resumeCueAction({kind, sameStep, hasNarration, voiceEnabled});
      const restartBreathHint = state.interruptedBreathIndex === index &&
        sameStep && kind === "breath" && action === "silent";
      state.interruptedBreathIndex = null;
      if (action === "restart-current") state.phaseIndex = -1;
      return { action, restartBreathHint };
    },
  });
}
