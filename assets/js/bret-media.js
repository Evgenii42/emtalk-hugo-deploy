import { Narrator } from "./bret-audio.js";

// One owner per media concern. The controller supplies current product state;
// asynchronous media attempts cannot mutate Session or certify trial outcomes.
export function createPracticeMedia({audioRoot, readState, feedback, copy,
  silentPreparation, announce, environment = globalThis}) {
  const music = new environment.Audio(), voice = new environment.Audio(),
    click = new environment.Audio(audioRoot + "metronom_click.wav");
  music.loop = true;
  music.volume = 0.28;
  voice.preload = "metadata";
  let narrationUnavailable = false;
  let musicAttempt = 0;
  let metronome = { epoch: 0, attempt: 0, attemptEpoch: -1, unavailable: false };
  const musicWanted = () => {
    const {prefs, session, introState} = readState();
    return (introState === "playing" || session?.state === "running") &&
      prefs.music && !prefs.mute;
  };
  const metronomeWanted = () => {
    const {prefs, session} = readState();
    return session?.state === "running" &&
      ["breath", "exercise"].includes(session.current?.kind) &&
      prefs.metronome && !prefs.mute;
  };
  const clearWaiting = () => feedback.clear("waiting");
  const musicFailure = () => {
    if (musicWanted()) feedback.show("music", copy.musicFailure, copy.musicUnavailableFinished);
  };
  const soundFailure = () => {
    narrationUnavailable = true;
    const {session, introState} = readState();
    const breathing = introState !== "idle" || session?.current?.kind === "breath";
    feedback.show("narration", breathing ? copy.breathVoiceFailure : copy.pmrVoiceFailure,
      copy.voiceUnavailableFinished);
    environment.queueMicrotask(announce);
  };
  const narrationStarted = ({confirmedPromise = false} = {}) => {
    clearWaiting();
    const {prefs, session, introState} = readState();
    const wanted = prefs.voice && !prefs.mute &&
      (introState === "playing" || (session?.state === "running" &&
        ["breath", "voice"].includes(session.current?.kind)));
    if (wanted && confirmedPromise) feedback.clear("narration");
  };
  const narrator = new Narrator(voice, soundFailure, environment, {
    waiting: () => feedback.show("waiting", copy.waiting), started: narrationStarted,
  });
  const cancelVoice = () => { narrator.cancel(); clearWaiting(); };
  const pauseMetronome = () => { metronome.epoch++; click.pause(); };
  const clearMetronomeFailure = () => {
    metronome.unavailable = false;
    feedback.clear("metronome");
  };
  const metronomeFailure = (epoch, attempt) => {
    if (epoch === metronome.epoch && attempt === metronome.attempt &&
        metronomeWanted() && !metronome.unavailable) {
      metronome.unavailable = true;
      feedback.show("metronome", copy.metronomeFailure, copy.metronomeUnavailableFinished);
    }
  };
  const metronomeStarted = (epoch, attempt) => {
    if (!metronomeWanted() ||
        (epoch !== metronome.epoch && metronome.attemptEpoch !== metronome.epoch))
      click.pause();
    else if (epoch === metronome.epoch && attempt === metronome.attempt)
      clearMetronomeFailure();
  };
  const playMusic = async () => {
    const attempt = ++musicAttempt;
    const recoveryFeedback = feedback.current("music");
    if (!musicWanted()) { music.pause(); return; }
    const {prefs} = readState();
    const sound = prefs.sound === "pattern"
      ? prefs.mode === "breathing" ? "sound_" + prefs.preset : "sound_4444"
      : prefs.sound;
    const src = new URL(audioRoot + sound + ".mp3", environment.location.href).href;
    if (music.src !== src) { music.src = src; music.load(); }
    try {
      const playing = music.play();
      await playing;
      if (!musicWanted()) music.pause();
      else if (attempt === musicAttempt && typeof playing?.then === "function")
        feedback.clearCaptured("music", recoveryFeedback);
    } catch { if (attempt === musicAttempt) musicFailure(); }
  };
  const narrate = (file, onEnd) => {
    cancelVoice();
    narrationUnavailable = false;
    const {prefs} = readState();
    if (!prefs.voice || prefs.mute) { silentPreparation(); onEnd(); return; }
    narrator.start(audioRoot + file + ".mp3", failed => {
      if (failed) silentPreparation();
      const {session, introState} = readState();
      if (session?.state === "running" || introState === "playing") onEnd();
    });
  };
  music.addEventListener("error", () => { if (music.error) musicFailure(); });
  return Object.freeze({
    playMusic, narrate, cancelVoice, pauseMetronome, clearMetronomeFailure,
    pauseMusic: () => music.pause(),
    pauseNarration: () => { narrator.pause(); clearWaiting(); },
    resumeNarration: () => narrator.resume(),
    hasNarration: () => narrator.hasPending(),
    resetNarrationFailure: () => { narrationUnavailable = false; },
    get narrationUnavailable() { return narrationUnavailable; },
    reconcileMetronome: () => { if (!metronomeWanted()) pauseMetronome(); },
    beat() {
      if (!metronomeWanted()) return;
      const epoch = metronome.epoch, attempt = ++metronome.attempt;
      metronome.attemptEpoch = epoch;
      try {
        click.currentTime = 0;
        const playing = click.play();
        playing?.then(() => metronomeStarted(epoch, attempt),
          () => metronomeFailure(epoch, attempt));
      } catch { metronomeFailure(epoch, attempt); }
    },
    silence() { cancelVoice(); music.pause(); pauseMetronome(); },
  });
}
