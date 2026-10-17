// Cue ownership contract (also see the negative browser regression controls):
// 1. Session owns timed state; introState owns only the separate introduction.
// 2. pause() ticks Session before painting a paused snapshot. That tick can cross
//    a boundary, so lastIndex identifies the last cue emitted, not just rendered.
// 3. paint(false) never consumes lastIndex or emits a new narration/metronome cue.
// 4. Resume retains position only when its pending narrator owns that same step.
//    A crossed boundary replaces the old cue; a disposed voice step restarts its
//    current recording/handler. Disposal must never leave an infinite voice wait.
// 5. Settings may replace a voice wait with a reading delay. Stop/pagehide cancel
//    callbacks; Narrator alone owns callback tokens and shared-media reconciliation.
// Changes touching this contract require bret-boundary-regressions.cjs (including
// both isolated negative mutations), lifecycle and restart browser regressions.
const KINDS = new Set(["voice", "breath", "delay", "exercise", "preparation"]);
export function resumeCueAction({
  kind,
  sameStep,
  hasNarration,
  voiceEnabled,
}) {
  if (
    !KINDS.has(kind) ||
    [sameStep, hasNarration, voiceEnabled].some(
      (value) => typeof value !== "boolean",
    )
  )
    throw new TypeError("Invalid resume transition");
  // A disposed infinite voice step needs a new handler, including after pagehide.
  if (kind === "voice" && !hasNarration) return "restart-current";
  // A boundary crossed before pause owns a new cue, not the previous recording.
  if (!sameStep) return "replace-cue";
  // Ordinary pause retains the current spoken position and completion handler.
  if (voiceEnabled && hasNarration && ["voice", "breath"].includes(kind))
    return "resume-cue";
  return "silent";
}

export function instructionAnnouncement({
  instruction,
  voiceEnabled,
  spokenFailed,
}) {
  if (
    typeof instruction !== "string" ||
    typeof voiceEnabled !== "boolean" ||
    typeof spokenFailed !== "boolean"
  )
    throw new TypeError("Invalid instruction announcement");
  // Healthy spoken guidance already supplies the instruction. Silent/failed
  // guidance needs the same how-to content in the polite text announcement.
  return !voiceEnabled || spokenFailed ? instruction : "";
}

// PMR ticks accompany Exercise, not its reading/narration delay. Breathing
// ticks accompany actual breath phases, after the separate preparation.
export function metronomeAllowed(kind) {
  return kind === "breath" || kind === "exercise";
}

// Native breathing keeps its continuous one-second cadence; preparations do
// not consume its first beat. PMR exercise ticks use that exercise's offset,
// independent of fractional listening time in earlier plan items.
export function metronomeBeatKey({kind, index, elapsed, offset}) {
  if (!metronomeAllowed(kind)) return null;
  if (![index, elapsed, offset].every(Number.isFinite) || index < 0 || elapsed < 0 || offset < 0)
    throw new TypeError("Invalid metronome position");
  return kind === "breath"
    ? `breath:${Math.floor(elapsed / 1000)}`
    : `exercise:${index}:${Math.floor(offset / 1000)}`;
}

// The engine owns conversion of a voiced PMR plan into reading delays. Only
// its current voice wait needs immediate advancement; a breath/delay/exercise
// keeps its current timing when spoken guidance is disabled.
export function voiceOffAction({kind, converted}) {
  if (!KINDS.has(kind) || typeof converted !== "boolean")
    throw new TypeError("Invalid voice-off transition");
  return converted && kind === "voice" ? "advance-to-reading" : "retain-step";
}

// One atomic practice status, stable between phase/availability changes. The
// instruction is included once per step when audio cannot supply it. Repeated
// animation frames never immediately replace a newly announced instruction.
export class PracticeAnnouncements {
  constructor() { this.reset(); }
  reset() { this.previous = null; this.announcedInstruction = null; }
  update({stage, instruction, stepKey}) {
    if ([stage, instruction, stepKey].some(value => typeof value !== "string"))
      throw new TypeError("Invalid practice announcement");
    const previous = this.previous;
    if (previous && previous.stage === stage && previous.instruction === instruction && previous.stepKey === stepKey) return null;
    this.previous = {stage, instruction, stepKey};
    const announced = this.announcedInstruction;
    const include = Boolean(instruction) && (!announced || announced.stepKey !== stepKey || announced.instruction !== instruction);
    if (include) this.announcedInstruction = {stepKey, instruction};
    let message = stage;
    if (include) {
      if (message) message += /[.!?…]$/.test(message) ? " " : ". ";
      message += instruction;
    }
    return message;
  }
}
