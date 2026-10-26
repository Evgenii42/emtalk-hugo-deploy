import { createTrialAnalytics } from "./trial-analytics.js";
import { BRET_COPY as copy } from "./bret-copy.js";
import { PracticeView, practiceClock as clock } from "./bret-view.js";
import {
  PRESETS,
  preferences,
  breathingPlan,
  musclePlan,
  Session,
} from "./bret-engine.js";
import { createPracticeCues } from "./bret-cues.js";
import { createPracticeFeedback } from "./bret-feedback.js";
import { createPracticeMedia } from "./bret-media.js";
import {
  instructionAnnouncement,
  voiceOffAction,
  PracticeAnnouncements,
} from "./bret-transitions.js";

const root = document.querySelector("[data-bret-practice]");
if (root) {
  const trial = createTrialAnalytics("bret");
  try {
    init(root, trial);
  } catch {
    trial.failed("initialization_failed");
    // Keep this outside the hidden app so a damaged configuration has an
    // honest visible recovery path, rather than an empty JavaScript-only page.
    const notice = root.querySelector("[data-bret-load-error]");
    if (notice) notice.hidden = false;
  }
}
function init(root, trial) {
  const $ = (s) => root.querySelector(s),
    all = (s) => [...root.querySelectorAll(s)];
  const config = JSON.parse($("#bret-practice-data").textContent);
  if (
    !Array.from({ length: 15 }, (_, i) => config?.steps?.[i + 1]).every(
      (step) =>
        step &&
        [step.name, step.instruction].every(
          (value) => typeof value === "string" && value.trim(),
        ),
    )
  )
    throw new Error("Invalid practice configuration");
  const presentation = new PracticeView(root, config.steps);
  const form = $("[data-practice-form]"),
    audioRoot = root.dataset.audioRoot;
  const key = "emtalk.bret.preferences.v1";
  let prefs = preferences(),
    session = null,
    sessionPresentation = null,
    last = 0,
    raf = 0;
  // Introduction: idle -> playing -> paused -> playing, then begin/skip/stop
  // returns to idle. The timed practice uses Session's separate explicit state.
  // One state prevents contradictory playing/ready flags during media callbacks.
  let introState = "idle";
  let runToken = null, sessionToken = null;
  let runtimeRecoveryShown = false;
  // Persistence only affects recovery feedback, never access to a practice.
  let confirmSettingsRecovery = false;
  let formInvalid = false;
  const announcements = new PracticeAnnouncements();
  const cues = createPracticeCues();
  const feedback = createPracticeFeedback(presentation);
  const media = createPracticeMedia({audioRoot, copy, feedback,
    readState: () => ({prefs, session, introState}),
    silentPreparation: () => session?.useSilentPreparation(),
    announce: announceInstruction,
  });
  const persistence = (message) => presentation.persistence(message);
  let hiddenPauseToken = null;
  function showPauseFeedback(reason) {
    if (!reason) return;
    const token = feedback.show("pause", reason);
    hiddenPauseToken = reason === copy.hiddenPause ? token : null;
  }
  const clearPauseFeedback = () => {
    hiddenPauseToken = null;
    feedback.clear("pause");
  };
  function refreshVisiblePause() {
    if (document.hidden || !hiddenPauseToken) return;
    const token = hiddenPauseToken;
    hiddenPauseToken = null;
    // Only replace our still-visible hidden-tab message, never a newer error.
    if ((session?.state === "paused" || introState === "paused") &&
        feedback.current("pause") === token && presentation.clearFeedback(token))
      showPauseFeedback(copy.pausedReady);
  }
  const preferenceConflict = "Saved settings changed in another tab and were not overwritten. Your changes work in this tab only. Reload this page to load the saved settings.";
  let stored = null, observedPreferencesRaw = null, preferencesObserved = false;
  try {
    stored = localStorage.getItem(key);
    observedPreferencesRaw = stored;
    preferencesObserved = true;
  } catch {
    confirmSettingsRecovery = true;
    persistence(copy.storageUnavailable);
  }
  if (stored !== null) {
    try {
      prefs = preferences(JSON.parse(stored));
    } catch {
      confirmSettingsRecovery = true;
      persistence(copy.settingsUnreadable);
      try {
        if (localStorage.getItem(key) !== observedPreferencesRaw) {
          persistence(preferenceConflict);
        } else {
          localStorage.removeItem(key);
          observedPreferencesRaw = null;
        }
      } catch {
        confirmSettingsRecovery = true;
        persistence(copy.settingsUnrepaired);
      }
    }
  }
  const save = () => {
    try {
      if (!preferencesObserved) {
        confirmSettingsRecovery = true;
        persistence(copy.settingsSaveFailure + " Reload this page before saving settings.");
        return;
      }
      if (localStorage.getItem(key) !== observedPreferencesRaw) {
        confirmSettingsRecovery = true;
        persistence(preferenceConflict);
        return;
      }
      const nextRaw = JSON.stringify(prefs);
      localStorage.setItem(key, nextRaw);
      observedPreferencesRaw = nextRaw;
      if (confirmSettingsRecovery) persistence(copy.settingsSaved);
      confirmSettingsRecovery = false;
    } catch {
      confirmSettingsRecovery = true;
      persistence(copy.settingsSaveFailure);
    }
  };
  function hydrate() {
    clearFormFeedback();
    formInvalid = false;
    for (const field of form.elements) {
      field.removeAttribute("aria-invalid");
      if (field.getAttribute("aria-describedby") === "bret-feedback")
        field.removeAttribute("aria-describedby");
    }
    form.elements.mode.value = prefs.mode;
    form.elements.preset.value = prefs.preset;
    form.elements.cycles.value = prefs.cycles;
    ["inhale", "holdIn", "exhale", "holdOut"].forEach(
      (k, i) => (form.elements[k].value = prefs.custom[i]),
    );
    all("[name=group]").forEach(
      (e) => (e.checked = prefs.groups.includes(e.value)),
    );
    hydrateSoundSettings();
    showMode();
  }
  function hydrateSoundSettings() {
    // Preserve saved choices; the controls show the effective audible state.
    for (const input of all("[data-setting]")) {
      const muted = prefs.mute && ["music", "voice", "metronome"].includes(input.dataset.setting);
      input.checked = !muted && prefs[input.dataset.setting];
      input.disabled = muted;
    }
    const sound = $("[data-sound]");
    sound.value = prefs.sound;
    sound.disabled = prefs.mute || !prefs.music;
    $("[data-muted-note]").hidden = !prefs.mute;
  }
  function showMode() {
    const mode = form.elements.mode.value;
    $("[data-standard]").hidden = mode !== "breathing";
    $("[data-custom]").hidden = mode !== "custom";
    $("[data-groups]").hidden = mode !== "pmr";
    $("[data-cycles-field]").hidden = mode === "pmr";
    all("[data-custom] input").forEach((e) => (e.disabled = mode !== "custom"));
    form.elements.cycles.disabled = mode === "pmr";
    form.elements.preset.disabled = mode !== "breathing";
  }
  function readForm() {
    const fields = [...form.elements].filter((field) => field.willValidate);
    const invalid = fields.filter((field) => !field.validity.valid);
    for (const field of fields) {
      if (invalid.includes(field)) {
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", "bret-feedback");
      } else {
        field.removeAttribute("aria-invalid");
        if (field.getAttribute("aria-describedby") === "bret-feedback")
          field.removeAttribute("aria-describedby");
      }
    }
    if (invalid.length) {
      formInvalid = true;
      feedback.show("form", copy.settingsInvalid(invalid[0].validationMessage));
      return false;
    }
    if (formInvalid) clearFormFeedback();
    formInvalid = false;
    // Preserve the last valid inactive settings; disabled draft fields are not
    // coerced into defaults merely because another practice mode was selected.
    const mode = form.elements.mode.value;
    const next = {
      ...prefs,
      mode,
      preset: mode === "breathing" ? form.elements.preset.value : prefs.preset,
      custom: mode === "custom"
        ? ["inhale", "holdIn", "exhale", "holdOut"].map((k) => Number(form.elements[k].value))
        : prefs.custom,
      cycles: mode === "pmr" ? prefs.cycles : Number(form.elements.cycles.value),
      groups: all("[name=group]:checked").map((e) => e.value),
    };
    prefs = preferences(next);
    save();
    return true;
  }
  const cancelVoice = () => media.cancelVoice();
  const clearFormFeedback = () => feedback.clear("form");
  function vibrate(value) {
    try {
      navigator.vibrate?.(value);
    } catch {
      /* Optional device capability must not break practice. */
    }
  }
  function silentAll() {
    media.silence();
    vibrate(0);
  }
  function announceInstruction() {
    const instruction = instructionAnnouncement({
      instruction: $("[data-instruction]").textContent,
      voiceEnabled: prefs.voice && !prefs.mute,
      spokenFailed: media.narrationUnavailable,
    });
    const message = announcements.update({
      stage: $("[data-stage]").textContent,
      instruction,
      stepKey: String(session?.current?.step || session?.current?.kind || "intro"),
    });
    const region = $("[data-instruction-announcement]");
    if (message !== null && region.textContent !== message) region.textContent = message;
  }
  const playMusic = () => media.playMusic();
  const narrate = (file, onEnd) => media.narrate(file, onEnd);
  const view = (which) => { if(which === "finish") feedback.finish(); presentation.show(which); };
  const focusHeading = (selector) => presentation.focusHeading(selector);
  function presentationSnapshot() {
    return {step: session.current, remaining: session.remaining, state: session.state,
      offset: session.offset, index: session.index, total: session.plan.length,
      elapsed: session.elapsed, stepCount: session.stepCount, ...sessionPresentation};
  }
  function begin(withPreparation = false, token = runToken) {
    clearPauseFeedback();
    media.pauseMetronome();
    media.clearMetronomeFailure();
    cues.finish();
    announcements.reset();
    $("[data-instruction-announcement]").textContent = "";
    // Sound settings remain editable, but metrics always describe this plan.
    const { mode, cycles } = prefs;
    sessionPresentation = Object.freeze({ mode, cycles });
    const plan =
      mode === "pmr"
        ? musclePlan(prefs.groups, prefs.voice && !prefs.mute)
        : [
            ...(withPreparation
              ? [
                  {
                    kind: "preparation",
                    label: copy.settleTitle,
                    duration: 7000,
                  },
                ]
              : []),
            ...breathingPlan(
              mode === "custom" ? prefs.custom : PRESETS[prefs.preset],
              cycles,
            ),
          ];
    session = new Session(plan).start();
    sessionToken = token;
    last = performance.now();
    cues.begin();
    introState = "idle";
    view("session");
    $("[data-pause]").textContent = copy.pause;
    $("[data-skip]").disabled = false;
    focusHeading("#bret-session-heading");
    playMusic();
    paint();
    schedule();
  }
  function start() {
    if (!readForm()) return;
    runtimeRecoveryShown = false;
    runToken = trial.request();
    sessionToken = null;
    feedback.reset();
    media.resetNarrationFailure();
    announcements.reset();
    $("[data-instruction-announcement]").textContent = "";
    $("[data-settings]").open = false;
    // Native MuscleRelaxationViewModel starts at the first PMR step. The
    // start_exercise_explanation recording belongs only to breathing, followed
    // by its seven-second preparation (inventory/bret-source.json contract).
    if (prefs.mode !== "pmr" && prefs.voice && !prefs.mute) {
      introState = "playing";
      presentation.startIntroduction();
      // Start both configured media elements in the actual Start gesture.
      // The native reference also plays background music during its explanation.
      playMusic();
      const acceptedToken = runToken;
      narrate("start_exercise_explanation", () => {
        begin(true, acceptedToken);
      });
      announceInstruction();
    } else begin();
  }
  function schedule() {
    cancelAnimationFrame(raf);
    if (session?.state === "running") raf = requestAnimationFrame(frame);
  }
  function physical(kind) { return kind === "breath" || kind === "exercise"; }
  function observePhysical() {
    if (session?.state === "running" && physical(session.current?.kind))
      trial.started(sessionToken);
  }
  function tickSession(delta) {
    const first = session.index;
    session.tick(delta);
    // Only clock-elapsed units qualify. Narration/skip advance() is not progress.
    if (session.index > first && session.plan.slice(first, session.index).some(step => physical(step.kind))) {
      trial.started(sessionToken);
      trial.advance(sessionToken);
    }
    observePhysical();
  }
  function runtimeFailure() {
    if (runtimeRecoveryShown) return;
    runtimeRecoveryShown = true;
    trial.failed("runtime_failed", sessionToken || runToken);
    // A failed clock cannot certify completion or remaining metrics. Stop media
    // and expose the existing Again recovery without inferring an outcome.
    try {
      cancelAnimationFrame(raf);
      session?.stop();
      introState = "idle";
      silentAll();
      view("finish");
      $("[data-summary]").textContent = "The practice could not continue because of a browser timing error. This practice was not completed. Choose another practice to try again.";
      focusHeading("#bret-finish-heading");
    } catch {
      const notice = $("[data-bret-load-error]");
      if (notice) notice.hidden = false;
    }
  }
  function frame(now) {
    if (session?.state !== "running") return;
    try { tickSession(Math.max(0, now - last)); }
    catch { runtimeFailure(); return; }
    last = now;
    if (session.state === "completed") {
      finish(false);
      return;
    }
    paint();
    schedule();
  }
  function paint(emitCues = true) {
    if (!session?.current) return;
    media.reconcileMetronome();
    const current = session.current;
    const changed = cues.claimPhase(session.index, emitCues);
    // Claim cue ownership before effects can synchronously advance and repaint.
    // A paused render refreshes the view without consuming that ownership.
    presentation.render(presentationSnapshot());
    observePhysical();
    if (emitCues) {
      emitMetronomeCue(current);
      if (changed) emitPhaseCue(current);
    }
    // Effects may have synchronously rendered a newer phase. Only read the
    // settled view here; no stale snapshot writes can follow cue completion.
    announceInstruction();
  }
  function emitPhaseCue(s) {
    if (s.kind === "voice")
      narrate("muscle_relaxation_step_" + s.step, () => {
        session?.advance();
        last = performance.now();
        paint();
        schedule();
      });
    else if (s.kind === "breath") {
      // Breath phases are clock-owned: a spoken hint cannot advance them.
      // PMR waits for each distinct instruction and retries it independently.
      // Rejected breath hints retry only after an explicit voice/mute re-enable
      // or a new practice, rather than every few seconds.
      narrateBreathHint(s);
      if (prefs.vibration && !document.hidden) vibrate(80);
    }
  }
  function narrateBreathHint(s) {
    if (prefs.voice && !prefs.mute && !media.narrationUnavailable)
      narrate(
        ["inhale", "delay_first", "exhale", "delay_second"][s.phase],
        () => {},
      );
  }
  function emitMetronomeCue(s) {
    if (cues.claimBeat({kind: s.kind, index: session.index,
      elapsed: session.elapsed, offset: session.offset})) media.beat();
  }
  function pause(reason) {
    if (introState === "playing") {
      media.pauseNarration();
      media.pauseMusic();
      media.pauseMetronome();
      vibrate(0);
      introState = "paused";
      presentation.intro(true);
      announceInstruction();
      showPauseFeedback(reason);
      return;
    }
    if (session?.state !== "running") return;
    try { tickSession(Math.max(0, performance.now() - last)); }
    catch { runtimeFailure(); return; }
    if (session.state === "completed") {
      finish(false);
      return;
    }
    session.pause();
    cancelAnimationFrame(raf);
    media.pauseMusic();
    media.pauseNarration();
    media.pauseMetronome();
    vibrate(0);
    paint(false);
    $("[data-pause]").textContent = copy.continue;
    $("[data-skip]").disabled = true;
    showPauseFeedback(reason);
  }
  function resume() {
    clearPauseFeedback();
    if (introState === "paused") {
      if (media.hasNarration()) {
        introState = "playing";
        presentation.intro(false);
        media.resumeNarration();
        playMusic();
        announceInstruction();
      } else begin(true);
      return;
    }
    if (session?.state !== "paused") return;
    session.start();
    last = performance.now();
    $("[data-pause]").textContent = copy.pause;
    $("[data-skip]").disabled = false;
    // Preserve an interrupted spoken instruction instead of replaying from zero.
    // pause() can advance the engine before the next animation frame paints it.
    // A retained narrator belongs only to the last actually painted step.
    const index = session.index;
    const {action: cue, restartBreathHint} = cues.resume({
      kind: session.current.kind, index,
      hasNarration: media.hasNarration(), voiceEnabled: prefs.voice && !prefs.mute,
    });
    if (cue === "restart-current" || cue === "replace-cue") cancelVoice();
    else if (cue === "resume-cue") media.resumeNarration();
    if (restartBreathHint) narrateBreathHint(session.current);
    playMusic();
    paint();
    schedule();
  }
  function finish(stopped, summaryOverride = null) {
    try {
    clearPauseFeedback();
    cues.finish();
    const stoppedIntroduction = stopped && introState !== "idle";
    const elapsed = session?.elapsed || 0,
      cycles = session?.completedCycles || 0;
    if (stopped) session?.stop();
    introState = "idle";
    cancelAnimationFrame(raf);
    silentAll();
    view("finish");
    $("[data-instruction-announcement]").textContent = "";
    $("[data-summary]").textContent = summaryOverride ?? copy.summary({
      stoppedIntroduction,
      stopped,
      elapsed: clock(elapsed),
      mode: sessionPresentation?.mode,
      cycles,
    });
    focusHeading("#bret-finish-heading");
    if (stopped) trial.stopped(runToken);
    else if (session?.state === "completed") trial.completed(sessionToken);
    } catch (error) { trial.failed("runtime_failed", runToken); throw error; }
  }
  form.addEventListener("change", () => {
    showMode();
    readForm();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (form.reportValidity()) {
      try { start(); } catch (error) { trial.failed("runtime_failed", runToken); throw error; }
    }
  });
  $("[data-pause]").addEventListener("click", () =>
    session?.state === "paused" || introState === "paused" ? resume() : pause(),
  );
  $("[data-stop]").addEventListener("click", () => finish(true));
  $("[data-query-time]").addEventListener("click", () => {
    if (introState !== "idle") presentation.queryTime({intro: introState});
    else if (session?.current) presentation.queryTime(presentationSnapshot());
  });
  $("[data-skip]").addEventListener("click", () => {
    cancelVoice();
    if (introState !== "idle") {
      begin();
    } else if (
      session?.current &&
      ["voice", "delay", "preparation"].includes(session.current.kind)
    ) {
      session.advance();
      cues.invalidatePhase();
      last = performance.now();
      paint();
      schedule();
    }
  });
  $("[data-again]").addEventListener("click", () => {
    trial.replacement();
    runToken = sessionToken = null;
    session = null;
    view("setup");
    form.querySelector("[name=mode]").focus();
  });
  $("[data-settings]").addEventListener("toggle", () => {
    if ($("[data-settings]").open)
      pause(copy.settingsPause);
  });
  all("[data-setting]").forEach((input) =>
    input.addEventListener("change", () => {
      prefs[input.dataset.setting] = input.checked;
      hydrateSoundSettings();
      save();
      if (["metronome", "mute"].includes(input.dataset.setting)) {
        media.pauseMetronome();
        if (prefs.metronome && !prefs.mute) media.clearMetronomeFailure();
      }
      if (["voice", "mute"].includes(input.dataset.setting) && prefs.voice && !prefs.mute)
        media.resetNarrationFailure();
      if (prefs.mute || !prefs.voice) {
        cancelVoice();
        if (introState !== "idle") {
          introState = "paused";
          presentation.intro(true);
        }
        const converted = session?.useSilentPreparation() || false;
        if (session?.current && voiceOffAction({kind: session.current.kind, converted}) === "advance-to-reading") {
          session.advance();
          cues.invalidatePhase();
          paint(session.state === "running");
        }
      }
      if (prefs.mute) {
        media.pauseMusic();
      }
      if (!prefs.music) media.pauseMusic();
      if (["music", "mute", "voice"].includes(input.dataset.setting))
        playMusic();
      announceInstruction();
    }),
  );
  $("[data-sound]").addEventListener("change", (e) => {
    prefs.sound = e.target.value;
    save();
    playMusic();
  });
  $("[data-reset]").addEventListener("click", () => {
    const stoppedPractice =
      (session && ["running", "paused"].includes(session.state)) ||
      introState !== "idle";
    prefs = preferences();
    let removed = true, conflict = false;
    try {
      if (!preferencesObserved || localStorage.getItem(key) !== observedPreferencesRaw) {
        removed = false; conflict = true;
      } else {
        localStorage.removeItem(key);
        observedPreferencesRaw = null;
      }
    } catch {
      removed = false;
    }
    hydrate();
    confirmSettingsRecovery = !removed;
    if (stoppedPractice)
      finish(true, removed
        ? copy.resetStopped
        : copy.resetStoppedFailure);
    persistence(removed ? copy.reset : conflict ? preferenceConflict : copy.resetFailure);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden)
      pause(copy.hiddenPause);
    else refreshVisiblePause();
  });
  window.addEventListener("pageshow", refreshVisiblePause);
  window.addEventListener("pagehide", () => {
    pause();
    cues.dispose({kind: session?.current?.kind, hasNarration: media.hasNarration()});
    silentAll();
  });
  hydrate();
  $("[data-vibration-note]").textContent =
    typeof navigator.vibrate === "function"
      ? copy.vibrationAvailable
      : copy.vibrationUnavailable;
  $("[data-bret-app]").hidden = false;
  root.dataset.bretReady = "true";
}
