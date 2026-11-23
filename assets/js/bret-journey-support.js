import {createPracticeMedia} from './bret-media.js';
import {createPracticeCues} from './bret-cues.js';
import {createTrialAnalytics} from './trial-analytics.js';
import {BRET_COPY} from './bret-copy.js';

export {preferences as normalizeSiteSettings} from './bret-engine.js';

// Site-only media adapter. Journey remains the sole owner of Session and time.
// Phase voice hints are optional; the approved Journey starts immediately,
// without the former standalone introduction and seven-second preparation.
export function createJourneySupport({audioRoot, feedback, readSession,
  readSettings, environment = globalThis}) {
  const channels = feedbackAdapter(feedback);
  const trial = createTrialAnalytics('bret', environment);
  const cues = createPracticeCues();
  let disposed = false, active = false, paused = false, owned = null, terminal = false;
  let token = null, lastIndex = 0, lastElapsed = 0, previousSettings = null;
  const prefs = () => readSettings();
  const session = () => !disposed && active && !paused ? readSession() : null;
  const readState = () => ({prefs: prefs(), session: session(), introState: 'idle'});
  let media, mediaUnavailable = false;
  try {
    media = createPracticeMedia({audioRoot, readState, feedback: channels,
      copy: {...BRET_COPY, waiting: 'Spoken guidance is taking longer to start. The breathing timer continues; you can turn spoken guidance off in settings.'},
      silentPreparation() {}, announce() {}, environment});
  } catch {
    mediaUnavailable = true;
    channels.show('media', 'Sound is unavailable in this browser. The breathing timer and visible guidance still work.');
    const noop = () => {};
    media = {playMusic: noop, narrate: noop, cancelVoice: noop,
      pauseMetronome: noop, clearMetronomeFailure: noop, pauseMusic: noop,
      pauseNarration: noop, resumeNarration: noop, hasNarration: () => false,
      resetNarrationFailure: noop, narrationUnavailable: true,
      reconcileMetronome: noop, beat: noop, silence: noop};
  }
  function vibrate(value) {
    try { environment.navigator?.vibrate?.(value); } catch { /* Optional hardware. */ }
  }
  function silence() { media.silence(); vibrate(0); }
  function remember(s) { lastIndex = s.index; lastElapsed = s.elapsed; }
  function progress(s) {
    // Only observed elapsed clock work qualifies, never a cue completion.
    if (s.elapsed > lastElapsed && s.index > lastIndex) trial.advance(token);
    remember(s);
  }
  function paintCues(s) {
    if (s.state !== 'running' || s.current?.kind !== 'breath') return;
    const settings = prefs();
    const changed = cues.claimPhase(s.index, true);
    if (cues.claimBeat({kind: s.current.kind, index: s.index,
      elapsed: s.elapsed, offset: s.offset})) media.beat();
    if (!changed) return;
    if (settings.voice && !settings.mute && !media.narrationUnavailable)
      media.narrate(['inhale', 'delay_first', 'exhale', 'delay_second'][s.current.phase], () => {});
    if (settings.vibration && !environment.document?.hidden) vibrate(80);
  }
  function settingsChanged() {
    if (disposed) return;
    const settings = prefs(), before = previousSettings;
    const voiceEnabled = settings.voice && !settings.mute;
    const voiceWasEnabled = before && before.voice && !before.mute;
    if (!voiceEnabled) {
      media.cancelVoice(); channels.clear('narration');
    } else if (before && !voiceWasEnabled) {
      media.resetNarrationFailure(); cues.invalidatePhase();
    }
    if (before && settings.metronome && !settings.mute &&
        (!before.metronome || before.mute)) media.clearMetronomeFailure();
    media.reconcileMetronome();
    if (!settings.vibration) vibrate(0);
    previousSettings = {...settings};
    // Play is called only on explicit start/resume/settings actions, never RAF.
    void media.playMusic();
    const current = session();
    if (current?.state === 'running' && !paused) paintCues(current);
  }
  function start() {
    if (disposed) return false;
    const current = readSession();
    if (current?.state !== 'running') return false;
    if (owned !== current) {
      silence(); channels.reset();
      owned = current; terminal = false; active = true; paused = false;
      if (mediaUnavailable) channels.show('media', 'Sound is unavailable in this browser. The breathing timer and visible guidance still work.');
      token = trial.request(); cues.begin(); media.resetNarrationFailure();
      media.clearMetronomeFailure(); previousSettings = {...prefs()};
      remember(current);
    } else {
      if (terminal) return false;
      active = true;
      const wasPaused = paused; paused = false;
      if (wasPaused) {
        const {action} = cues.resume({kind: current.current?.kind, index: current.index,
          hasNarration: media.hasNarration(), voiceEnabled: prefs().voice && !prefs().mute});
        if (action === 'restart-current' || action === 'replace-cue') media.cancelVoice();
        else if (action === 'resume-cue') media.resumeNarration();
      }
    }
    trial.started(token);
    void media.playMusic(); paintCues(current);
    return true;
  }
  function pause() {
    if (disposed) return;
    paused = true;
    media.pauseNarration(); media.pauseMusic(); media.pauseMetronome(); vibrate(0);
  }
  function finish(stopped = false) {
    if (disposed || !owned || terminal) return;
    const current = readSession();
    // An obsolete finish cannot certify or silence a replacement session.
    if (current !== owned) return;
    progress(current);
    terminal = true; active = false; paused = false;
    cues.finish(); silence(); channels.finish();
    if (stopped) trial.stopped(token);
    else if (current.state === 'completed') trial.completed(token);
  }
  function update() {
    if (disposed || !active || terminal) return;
    const current = readSession();
    if (current !== owned) return;
    if (current.state === 'completed') { finish(false); return; }
    if (current.state === 'stopped') { finish(true); return; }
    if (current.state !== 'running') { if (!paused) pause(); return; }
    if (paused) return;
    progress(current); paintCues(current);
  }
  function reset() {
    if (disposed) return;
    if (active && !terminal) trial.stopped(token);
    active = false; paused = false; terminal = false; owned = null; token = null;
    previousSettings = null; cues.begin(); silence(); channels.reset(); trial.replacement();
  }
  function failed(kind = 'runtime_failed') {
    if (disposed || terminal) return;
    if (!['initialization_failed', 'runtime_failed', 'required_capability_failed'].includes(kind)) return;
    trial.failed(kind, token || undefined);
    active = false; paused = false; terminal = true;
    cues.finish(); silence(); channels.finish();
  }
  function dispose() {
    if (disposed) return;
    active = false; disposed = true; silence(); trial.dispose();
  }
  return Object.freeze({start, update, pause, finish, reset, dispose, settingsChanged, failed});
}

function feedbackAdapter(feedback) {
  if (feedback && typeof feedback.show === 'function') return feedback;
  const slots = new Map();
  let sequence = 0, visible = '';
  const render = () => {
    const text = [...new Set([...slots.values()].map(slot => slot.text))].join(' ');
    if (text !== visible) { visible = text; if (typeof feedback === 'function') feedback(text); }
  };
  const clearCaptured = (owner, token) => {
    if (slots.get(owner)?.token === token) { slots.delete(owner); render(); }
  };
  return {
    show(owner, text, finished = null) { const token = ++sequence; slots.set(owner, {token, text, finished}); render(); return token; },
    current: owner => slots.get(owner)?.token ?? null,
    clear: owner => clearCaptured(owner, slots.get(owner)?.token ?? null),
    clearCaptured,
    reset() { slots.clear(); render(); },
    finish() {
      for (const [owner, slot] of slots) {
        if (slot.finished) slots.set(owner, {...slot, text: slot.finished});
        else slots.delete(owner);
      }
      render();
    },
  };
}
