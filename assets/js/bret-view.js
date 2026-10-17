import { BRET_COPY as copy } from "./bret-copy.js";
// Presentation only: never mutates the engine/preferences or schedules cues.
// render receives a captured read-only snapshot; focus is an explicit command
// used at screen transitions, never during animation-frame rendering.
export const practiceClock = (n) => `${Math.floor(n / 60000)}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")}`;
export class PracticeView {
  constructor(root, steps) { this.root = root; this.steps = steps; this.timeAnswerKey = null; this.feedbackOwner = null; this.mediaFeedback = null; }
  $(selector) { return this.root.querySelector(selector); }
  persistence(message) {
    // Storage recovery cannot replace media, validation or pause feedback.
    const status = this.$("[data-persistence-feedback]");
    if (status.textContent !== message) status.textContent = message;
  }
  feedback(message, finished = null) {
    // Every write receives a distinct identity, including identical wording.
    // Cleanup owns this identity, never a localized/displayed text comparison.
    const token = {};
    this.feedbackOwner = token;
    this.mediaFeedback = finished ? {token, finished} : null;
    if (this.$("[data-feedback]").textContent !== message)
      this.$("[data-feedback]").textContent = message;
    return token;
  }
  clearFeedback(token) {
    if (!token || token !== this.feedbackOwner) return false;
    this.feedback("");
    return true;
  }
  scopeFinishedFeedback() {
    const owned = this.mediaFeedback;
    if (owned && this.feedbackOwner === owned.token)
      this.feedback(owned.finished);
    this.mediaFeedback = null;
  }
  show(which) {
    if (which === "finish") this.scopeFinishedFeedback();
    this.expireTimeAnswer(null);
    for (const key of ["setup", "session", "finish"])
      this.$("[data-" + key + "]").hidden = key !== which;
  }
  focusHeading(selector) {
    this.$(selector).focus({ preventScroll: true });
    this.$(selector).scrollIntoView({ block: "start", behavior: "instant" });
  }
  expireTimeAnswer(key) {
    if (key === this.timeAnswerKey) return;
    this.timeAnswerKey = key;
    this.$("[data-time-answer]").textContent = "";
  }
  intro(paused = false) {
    this.expireTimeAnswer(paused ? "intro-paused" : "intro-playing");
    this.$("[data-stage]").textContent = paused ? copy.introPaused : copy.introPosition;
    this.$("[data-pause]").hidden = false;
    this.$("[data-pause]").textContent = paused ? copy.continue : copy.pause;
  }
  startIntroduction() {
    this.show("session");
    this.intro();
    this.$("[data-instruction]").textContent = copy.introInstruction;
    this.$("[data-countdown]").textContent = "";
    this.$("[data-metrics]").textContent = copy.introduction;
    this.$("[data-progress]").max = 1;
    this.$("[data-progress]").value = 0;
    this.$("[data-body-guide]").hidden = true;
    this.$("[data-orbit]").hidden = false;
    // data-phase is an observability/test hook; --bret-scale drives the visual.
    this.$("[data-orbit]").dataset.phase = "2";
    this.$("[data-orbit]").style.setProperty("--bret-scale", "0.7");
    this.$("[data-skip]").hidden = false;
    this.$("[data-skip]").disabled = false;
    this.$("[data-skip]").textContent = copy.skipIntroduction;
    this.focusHeading("#bret-session-heading");
  }
  phaseTitle(s) {
    return s.kind === "breath" || s.kind === "preparation"
        ? s.label
        : (s.kind === "voice"
            ? copy.listenPrefix
            : s.kind === "delay"
              ? copy.preparePrefix
              : copy.relaxPrefix) + this.steps[String(s.step)].name;
  }
  queryTime(snapshot) {
    let text;
    if (snapshot.intro) text = copy.introTime(snapshot.intro === "paused");
    else {
      const seconds = Math.ceil(snapshot.remaining / 1000);
      text = copy.timePhase(this.phaseTitle(snapshot.step), snapshot.state === "paused") +
        (Number.isFinite(seconds) ? copy.remaining(seconds) : copy.spokenCountdown);
    }
    this.$("[data-time-answer]").textContent = copy.requestedPrefix + text;
  }
  render({step: s, remaining, state, offset, index, total, elapsed, stepCount, mode, cycles}) {
    this.expireTimeAnswer(`${index}:${state}`);
    this.$("[data-pause]").hidden = false;
    this.$("[data-skip]").hidden = !["voice", "delay", "preparation"].includes(
      s.kind,
    );
    this.$("[data-skip]").textContent =
      s.kind === "voice" ? copy.skipInstruction : copy.skipPreparation;
    const stageLabel = this.phaseTitle(s);
    // Announce duration once with each phase, without a per-second live region.
    const seconds = Math.ceil(remaining / 1000);
    const stage =
      state === "paused"
        ? Number.isFinite(seconds)
          ? copy.pausedRemaining(seconds)
          : copy.pausedReady
        : Number.isFinite(s.duration)
          ? copy.phaseDuration(stageLabel, s.duration / 1000)
          : stageLabel;
    if (this.$("[data-stage]").textContent !== stage)
      this.$("[data-stage]").textContent = stage;
    const step = this.steps[String(s.step)];
    const instruction =
      s.kind === "preparation"
        ? copy.preparationInstruction
        : s.kind === "breath"
          ? copy.breathingInstruction
          : step?.instruction || "";
    if (this.$("[data-instruction]").textContent !== instruction)
      this.$("[data-instruction]").textContent = instruction;
    this.$("[data-body-guide]").hidden = ["breath", "preparation"].includes(
      s.kind,
    );
    this.$("[data-orbit]").hidden = !["breath", "preparation"].includes(s.kind);
    this.$("[data-body-guide]").dataset.muscle = String(s.step || "");
    // Phase identity is observable without implying a [data-phase] CSS rule.
    this.$("[data-orbit]").dataset.phase = String(s.phase ?? 2);
    this.$("[data-countdown]").textContent = Number.isFinite(remaining)
      ? String(Math.ceil(remaining / 1000))
      : copy.listenAtPace;
    if (s.kind === "breath") {
      const p = Math.min(1, offset / s.duration),
        scale =
          s.phase === 0
            ? 0.7 + 0.3 * p
            : s.phase === 2
              ? 1 - 0.3 * p
              : s.phase === 1
                ? 1
                : 0.7;
      this.$("[data-orbit]").style.setProperty("--bret-scale", String(scale));
    }
    this.$("[data-progress]").max = total;
    this.$("[data-progress]").value =
      index +
      (Number.isFinite(s.duration) ? offset / s.duration : 0);
    this.$("[data-metrics]").textContent =
      s.kind === "preparation"
        ? copy.preparation
        : practiceClock(elapsed) +
          (mode === "pmr"
            ? copy.stepMetric(s.number, stepCount)
            : copy.cycleMetric(s.cycle, cycles));
  }
}
