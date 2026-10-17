// Source-derived timing; no DOM, storage, backend, or wall-clock dependency.
export const PRESETS = Object.freeze({
  4444: [4, 4, 4, 4],
  478: [4, 7, 8, 0],
  464: [4, 6, 4, 0],
  343: [3, 4, 3, 0],
  575: [5, 7, 5, 0],
});
export const GROUPS = Object.freeze({
  head: [1, 2, 3],
  neck: [4],
  chest: [9],
  back: [5, 6],
  arms: [7, 8],
  abdomen: [10],
  legs: [11, 13],
  feet: [12],
});
export const PMR_ORDER = Object.freeze([
  1, 2, 3, 4, 5, 9, 6, 7, 8, 10, 11, 12, 13, 14, 15,
]);
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
// The storage key owns the v1 namespace. Sanitize known fields independently;
// legacy version metadata and other unknown payload fields are ignored, not
// interpreted as a migration contract or carried into a new saved payload.
export function preferences(value = {}) {
  const d = {
    mode: "breathing",
    preset: "4444",
    custom: [4, 2, 4, 2],
    cycles: 10,
    groups: Object.keys(GROUPS),
    music: true,
    voice: true,
    metronome: true,
    vibration: false,
    mute: false,
    sound: "pattern",
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return d;
  for (const k of ["music", "voice", "metronome", "vibration", "mute"])
    if (typeof value[k] === "boolean") d[k] = value[k];
  if (["breathing", "custom", "pmr"].includes(value.mode)) d.mode = value.mode;
  if (Object.hasOwn(PRESETS, value.preset)) d.preset = String(value.preset);
  if (
    Array.isArray(value.custom) &&
    value.custom.length === 4 &&
    value.custom.every((v, i) => int(v, i % 2 ? 0 : 1, 10))
  )
    d.custom = [...value.custom];
  if (int(value.cycles, 1, 99)) d.cycles = value.cycles;
  if (
    Array.isArray(value.groups) &&
    value.groups.every((k) => Object.hasOwn(GROUPS, k))
  )
    d.groups = [...new Set(value.groups)];
  if (["pattern", "rain", "sunrise", "wind"].includes(value.sound))
    d.sound = value.sound;
  return d;
}
export function breathingPlan(phases, cycles) {
  if (
    !Array.isArray(phases) ||
    phases.length !== 4 ||
    !phases.every((v, i) => int(v, i % 2 ? 0 : 1, 10)) ||
    !int(cycles, 1, 99)
  )
    throw new RangeError("Invalid breathing settings");
  const labels = ["Inhale", "Hold after inhale", "Exhale", "Hold after exhale"];
  return Array.from({ length: cycles }, (_, cycle) =>
    phases.flatMap((seconds, phase) =>
      seconds
        ? [
            {
              kind: "breath",
              label: labels[phase],
              phase,
              cycle: cycle + 1,
              duration: seconds * 1000,
            },
          ]
        : [],
    ),
  ).flat();
}
export function muscleSteps(groups) {
  if (!Array.isArray(groups) || groups.some((k) => !Object.hasOwn(GROUPS, k)))
    throw new RangeError("Invalid muscle groups");
  const selected = new Set(
    (groups.length ? groups : Object.keys(GROUPS)).flatMap((k) => GROUPS[k]),
  );
  return PMR_ORDER.filter((id) => id >= 14 || selected.has(id));
}
export function musclePlan(groups, voice) {
  return muscleSteps(groups).flatMap((step, index) => [
    ...(voice
      ? [{ kind: "voice", step, number: index + 1, duration: Infinity }]
      : []),
    { kind: "delay", step, number: index + 1, duration: voice ? 2000 : 10000 },
    { kind: "exercise", step, number: index + 1, duration: 10000 },
  ]);
}
export class Session {
  // Infinite durations represent narrated PMR steps, completed by advance().
  constructor(plan) {
    if (
      !Array.isArray(plan) ||
      !plan.length ||
      plan.some((s) => !(s.duration > 0))
    )
      throw new RangeError("Invalid session plan");
    this.plan = plan.map((s) => ({ ...s }));
    // Bind displayed PMR totals to the running plan, rather than later prefs.
    this.stepCount = this.plan.reduce((count, step) =>
      Math.max(count, Number.isInteger(step.number) ? step.number : 0), 0);
    this.index = 0;
    this.offset = 0;
    this.elapsed = 0;
    this.state = "idle";
  }
  get current() {
    return this.plan[this.index] || null;
  }
  get remaining() {
    return this.current ? Math.max(0, this.current.duration - this.offset) : 0;
  }
  get completedCycles() {
    // PMR plans have steps rather than breathing cycles.
    if (!this.plan.some((step) => Number.isInteger(step.cycle))) return 0;
    return this.state === "completed"
      ? this.plan.at(-1).cycle || 0
      : Math.max(0, (this.current?.cycle || 1) - 1);
  }
  useSilentPreparation() {
    // Narrated PMR steps are followed by a same-step reading delay.
    const next = this.plan[this.index + 1];
    if (this.current?.kind !== "voice" || next?.kind !== "delay" ||
        next.step !== this.current.step) return false;
    next.duration = 10000;
    return true;
  }
  start() {
    if (this.state === "idle" || this.state === "paused")
      this.state = "running";
    return this;
  }
  pause() {
    if (this.state === "running") this.state = "paused";
  }
  stop() {
    if (!["completed", "stopped"].includes(this.state)) this.state = "stopped";
  }
  advance() {
    if (!["running", "paused"].includes(this.state)) return;
    this.index++;
    this.offset = 0;
    if (!this.current) this.state = "completed";
  }
  tick(delta) {
    if (this.state !== "running") return;
    if (!Number.isFinite(delta) || delta < 0)
      throw new RangeError("Invalid elapsed time");
    while (delta > 0 && this.state === "running") {
      const used = Math.min(delta, this.remaining);
      this.offset += used;
      // Web practice time includes PMR listening and step delays/exercise.
      // Only the separate seven-second breathing preparation is excluded;
      // paused time is rejected by the running-state guard above.
      if (this.current.kind !== "preparation") this.elapsed += used;
      delta -= used;
      if (this.remaining === 0) this.advance();
      else break;
    }
  }
}
