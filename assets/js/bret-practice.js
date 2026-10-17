import { BRET_COPY as copy } from "./bret-copy.js";
import { PracticeView, practiceClock as clock } from "./bret-view.js";
import {
  PRESETS,
  preferences,
  breathingPlan,
  musclePlan,
  Session,
} from "./bret-engine.js";
import { Narrator } from "./bret-audio.js";
import {
  resumeCueAction,
  instructionAnnouncement,
  metronomeBeatKey,
  voiceOffAction,
  PracticeAnnouncements,
} from "./bret-transitions.js";

const root = document.querySelector("[data-bret-practice]");
if (root) {
  try {
    init(root);
  } catch {
    // Keep this outside the hidden app so a damaged configuration has an
    // honest visible recovery path, rather than an empty JavaScript-only page.
    const notice = root.querySelector("[data-bret-load-error]");
    if (notice) notice.hidden = false;
  }
}
function init(root) {
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
    raf = 0,
    lastIndex = -1,
    lastBeat = null;
  // Introduction: idle -> playing -> paused -> playing, then begin/skip/stop
  // returns to idle. The timed practice uses Session's separate explicit state.
  // One state prevents contradictory playing/ready flags during media callbacks.
  let introState = "idle";
  // Persistence only affects recovery feedback, never access to a practice.
  let confirmSettingsRecovery = false;
  let narrationUnavailable = false;
  let pauseFeedback = null;
  let waitingFeedback = null;
  let musicFeedback = null;
  let narrationFeedback = null;
  let interruptedBreathIndex = null;
  let musicAttempt = 0;
  let metronomeEpoch = 0;
  let metronomeAttempt = 0;
  let metronomeAttemptEpoch = -1;
  let metronomeUnavailable = false;
  let metronomeFeedback = null;
  let formInvalid = false;
  let formFeedback = null;
  const music = new Audio(),
    voice = new Audio(),
    click = new Audio(audioRoot + "metronom_click.wav");
  music.loop = true;
  music.volume = 0.28;
  voice.preload = "metadata";
  const waitingMessage = copy.waiting;
  const announcements = new PracticeAnnouncements();
  const narrator = new Narrator(voice, soundFailure, globalThis, {
    waiting: () => { waitingFeedback = feedback(waitingMessage); },
    started: narrationStarted,
  });
  const feedback = (message, finished = null) => presentation.feedback(message, finished);
  const persistence = (message) => presentation.persistence(message);
  function showPauseFeedback(reason) {
    if (!reason) return;
    pauseFeedback = feedback(reason);
  }
  function clearPauseFeedback() {
    presentation.clearFeedback(pauseFeedback);
    pauseFeedback = null;
  }
  let stored = null;
  try {
    stored = localStorage.getItem(key);
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
        localStorage.removeItem(key);
      } catch {
        confirmSettingsRecovery = true;
        persistence(copy.settingsUnrepaired);
      }
    }
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
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
    all("[data-setting]").forEach(
      (e) => (e.checked = prefs[e.dataset.setting]),
    );
    $("[data-sound]").value = prefs.sound;
    showMode();
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
      formFeedback = feedback(copy.settingsInvalid(invalid[0].validationMessage));
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
  function cancelVoice() {
    narrator.cancel();
    clearWaitingFeedback();
  }
  function clearFormFeedback() {
    presentation.clearFeedback(formFeedback);
    formFeedback = null;
  }
  function clearWaitingFeedback() {
    presentation.clearFeedback(waitingFeedback);
    waitingFeedback = null;
  }
  function vibrate(value) {
    try {
      navigator.vibrate?.(value);
    } catch {
      /* Optional device capability must not break practice. */
    }
  }
  function silentAll() {
    cancelVoice();
    music.pause();
    pauseMetronome();
    vibrate(0);
  }
  function soundFailure() {
    narrationUnavailable = true;
    const breathing = introState !== "idle" || session?.current?.kind === "breath";
    narrationFeedback = feedback(
      breathing
        ? copy.breathVoiceFailure
        : copy.pmrVoiceFailure,
      copy.voiceUnavailableFinished,
    );
    // Failure completion can synchronously replace voice with a reading delay.
    // Announce the settled phase, rather than replacing its how-to text twice.
    queueMicrotask(announceInstruction);
  }
  function narrationStarted({ confirmedPromise = false } = {}) {
    clearWaitingFeedback();
    // Narrator calls this only for its current active request. A newer error,
    // validation message or pause reason retains its distinct feedback owner.
    const wanted = prefs.voice && !prefs.mute &&
      (introState === "playing" || (session?.state === "running" &&
        ["breath", "voice"].includes(session.current?.kind)));
    if (wanted && confirmedPromise) {
      presentation.clearFeedback(narrationFeedback);
      narrationFeedback = null;
    }
  }
  function announceInstruction() {
    const instruction = instructionAnnouncement({
      instruction: $("[data-instruction]").textContent,
      voiceEnabled: prefs.voice && !prefs.mute,
      spokenFailed: narrationUnavailable,
    });
    const message = announcements.update({
      stage: $("[data-stage]").textContent,
      instruction,
      stepKey: String(session?.current?.step || session?.current?.kind || "intro"),
    });
    const region = $("[data-instruction-announcement]");
    if (message !== null && region.textContent !== message) region.textContent = message;
  }
  function musicWanted() {
    return (
      (introState === "playing" || session?.state === "running") &&
      prefs.music &&
      !prefs.mute
    );
  }
  function musicFailure() {
    if (musicWanted())
      musicFeedback = feedback(
        copy.musicFailure,
        copy.musicUnavailableFinished,
      );
  }
  function metronomeWanted() {
    return session?.state === "running" &&
      ["breath", "exercise"].includes(session.current?.kind) &&
      prefs.metronome && !prefs.mute;
  }
  function pauseMetronome() {
    // Pending play belongs to this lifecycle, not a later resume or PMR phase.
    metronomeEpoch++;
    click.pause();
  }
  function clearMetronomeFailure() {
    metronomeUnavailable = false;
    presentation.clearFeedback(metronomeFeedback);
    metronomeFeedback = null;
  }
  function metronomeFailure(epoch, attempt) {
    if (epoch === metronomeEpoch && attempt === metronomeAttempt &&
        metronomeWanted() && !metronomeUnavailable) {
      metronomeUnavailable = true;
      metronomeFeedback = feedback(
        copy.metronomeFailure,
        copy.metronomeUnavailableFinished,
      );
    }
  }
  function metronomeStarted(epoch, attempt) {
    // A late success quiets unwanted playback, but must not pause a newer wanted
    // beat or clear feedback claimed by a later failed attempt.
    if (!metronomeWanted() ||
        (epoch !== metronomeEpoch && metronomeAttemptEpoch !== metronomeEpoch))
      click.pause();
    else if (epoch === metronomeEpoch && attempt === metronomeAttempt)
      clearMetronomeFailure();
  }
  async function playMusic() {
    const attempt = ++musicAttempt;
    const recoveryFeedback = musicFeedback;
    if (!musicWanted()) {
      music.pause();
      return;
    }
    const sound =
      prefs.sound === "pattern"
        ? prefs.mode === "breathing"
          ? "sound_" + prefs.preset
          : "sound_4444"
        : prefs.sound;
    const src = new URL(audioRoot + sound + ".mp3", location.href).href;
    if (music.src !== src) {
      music.src = src;
      music.load();
    }
    try {
      const playing = music.play();
      await playing;
      // This media element is shared: a stale success must not pause a newer
      // desired track. Only current failures may produce a visible error.
      if (!musicWanted()) music.pause();
      else if (attempt === musicAttempt && typeof playing?.then === "function") {
        // Recover the warning present at this retry's start, never a newer
        // resource-error event even if its visible wording is identical.
        presentation.clearFeedback(recoveryFeedback);
        if (musicFeedback === recoveryFeedback) musicFeedback = null;
      }
    } catch {
      if (attempt === musicAttempt) musicFailure();
    }
  }
  function narrate(file, onEnd) {
    cancelVoice();
    narrationUnavailable = false;
    if (!prefs.voice || prefs.mute) {
      session?.useSilentPreparation();
      onEnd();
      return;
    }
    narrator.start(audioRoot + file + ".mp3", (failed) => {
      if (failed) session?.useSilentPreparation();
      if (session?.state === "running" || introState === "playing") onEnd();
    });
  }
  const view = (which) => presentation.show(which);
  const focusHeading = (selector) => presentation.focusHeading(selector);
  function presentationSnapshot() {
    return {step: session.current, remaining: session.remaining, state: session.state,
      offset: session.offset, index: session.index, total: session.plan.length,
      elapsed: session.elapsed, stepCount: session.stepCount, ...sessionPresentation};
  }
  function begin(withPreparation = false) {
    clearPauseFeedback();
    pauseMetronome();
    clearMetronomeFailure();
    interruptedBreathIndex = null;
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
    last = performance.now();
    lastIndex = -1;
    lastBeat = null;
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
    feedback("");
    narrationUnavailable = false;
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
      narrate("start_exercise_explanation", () => {
        begin(true);
      });
      announceInstruction();
    } else begin();
  }
  function schedule() {
    cancelAnimationFrame(raf);
    if (session?.state === "running") raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    if (session?.state !== "running") return;
    session.tick(Math.max(0, now - last));
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
    if (!metronomeWanted()) pauseMetronome();
    const current = session.current;
    const changed = lastIndex !== session.index;
    // Claim cue ownership before effects can synchronously advance and repaint.
    // A paused render refreshes the view without consuming that ownership.
    if (emitCues && changed) lastIndex = session.index;
    presentation.render(presentationSnapshot());
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
    if (prefs.voice && !prefs.mute && !narrationUnavailable)
      narrate(
        ["inhale", "delay_first", "exhale", "delay_second"][s.phase],
        () => {},
      );
  }
  function emitMetronomeCue(s) {
    const beat = metronomeBeatKey({kind: s.kind, index: session.index,
      elapsed: session.elapsed, offset: session.offset});
    if (beat === null || beat === lastBeat) return;
    lastBeat = beat;
    if (metronomeWanted()) {
      const epoch = metronomeEpoch, attempt = ++metronomeAttempt;
      metronomeAttemptEpoch = epoch;
      try {
        click.currentTime = 0;
        const playing = click.play();
        // Only a fulfilled play promise confirms recovery. An older browser
        // returning no promise does not establish that a beat succeeded.
        playing?.then(
          () => metronomeStarted(epoch, attempt),
          () => metronomeFailure(epoch, attempt),
        );
      } catch {
        metronomeFailure(epoch, attempt);
      }
    }
  }
  function pause(reason) {
    if (introState === "playing") {
      narrator.pause();
      clearWaitingFeedback();
      music.pause();
      pauseMetronome();
      vibrate(0);
      introState = "paused";
      presentation.intro(true);
      announceInstruction();
      showPauseFeedback(reason);
      return;
    }
    if (session?.state !== "running") return;
    session.tick(Math.max(0, performance.now() - last));
    if (session.state === "completed") {
      finish(false);
      return;
    }
    session.pause();
    cancelAnimationFrame(raf);
    music.pause();
    narrator.pause();
    clearWaitingFeedback();
    pauseMetronome();
    vibrate(0);
    paint(false);
    $("[data-pause]").textContent = copy.continue;
    $("[data-skip]").disabled = true;
    showPauseFeedback(reason);
  }
  function resume() {
    clearPauseFeedback();
    if (introState === "paused") {
      if (narrator.hasPending()) {
        introState = "playing";
        presentation.intro(false);
        narrator.resume();
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
    const cue = resumeCueAction({
      kind: session.current.kind,
      sameStep: lastIndex === index,
      hasNarration: narrator.hasPending(),
      voiceEnabled: prefs.voice && !prefs.mute,
    });
    // pagehide disposes media, unlike an ordinary retained pause. Reissue only
    // its still-current breath hint, with no engine advance, vibration or beat.
    const restartBreathHint = interruptedBreathIndex === index &&
      lastIndex === index && session.current.kind === "breath" && cue === "silent";
    interruptedBreathIndex = null;
    if (cue === "restart-current") {
      lastIndex = -1;
      cancelVoice();
    } else if (cue === "replace-cue") {
      cancelVoice();
    } else if (cue === "resume-cue") {
      narrator.resume();
    }
    if (restartBreathHint) narrateBreathHint(session.current);
    playMusic();
    paint();
    schedule();
  }
  function finish(stopped, summaryOverride = null) {
    clearPauseFeedback();
    interruptedBreathIndex = null;
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
  }
  form.addEventListener("change", () => {
    showMode();
    readForm();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (form.reportValidity()) start();
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
      lastIndex = -1;
      last = performance.now();
      paint();
      schedule();
    }
  });
  $("[data-again]").addEventListener("click", () => {
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
      save();
      if (["metronome", "mute"].includes(input.dataset.setting)) {
        pauseMetronome();
        if (prefs.metronome && !prefs.mute) clearMetronomeFailure();
      }
      if (["voice", "mute"].includes(input.dataset.setting) && prefs.voice && !prefs.mute)
        narrationUnavailable = false;
      if (prefs.mute || !prefs.voice) {
        cancelVoice();
        if (introState !== "idle") {
          introState = "paused";
          presentation.intro(true);
        }
        const converted = session?.useSilentPreparation() || false;
        if (session?.current && voiceOffAction({kind: session.current.kind, converted}) === "advance-to-reading") {
          session.advance();
          lastIndex = -1;
          paint(session.state === "running");
        }
      }
      if (prefs.mute) {
        music.pause();
      }
      if (!prefs.music) music.pause();
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
    let removed = true;
    try {
      localStorage.removeItem(key);
    } catch {
      removed = false;
    }
    hydrate();
    confirmSettingsRecovery = !removed;
    if (stoppedPractice)
      finish(true, removed
        ? copy.resetStopped
        : copy.resetStoppedFailure);
    persistence(removed ? copy.reset : copy.resetFailure);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden)
      pause(copy.hiddenPause);
  });
  window.addEventListener("pagehide", () => {
    pause();
    if (session?.current?.kind === "breath" && narrator.hasPending())
      interruptedBreathIndex = lastIndex;
    silentAll();
  });
  music.addEventListener("error", () => {
    if (music.error) musicFailure();
  });
  hydrate();
  $("[data-vibration-note]").textContent =
    typeof navigator.vibrate === "function"
      ? copy.vibrationAvailable
      : copy.vibrationUnavailable;
  $("[data-bret-app]").hidden = false;
  root.dataset.bretReady = "true";
}
