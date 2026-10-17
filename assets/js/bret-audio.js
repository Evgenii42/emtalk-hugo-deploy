// One completion per narration. Injectable media/timers permit race regression tests.
// Web playback uses MP3-compatible derivatives and the WAV metronome. Original
// Opus files are retained as immutable source assets, not advertised as an
// automatic format fallback. Unrequested originals add no playback transfer.
// The 120-second watchdog bounds active inactivity, not total recording length.
// Only finite advancing playback time after play starts renews it; pauses disarm
// it. The separate 15-second hint applies only to unresolved play requests.
export class Narrator {
  constructor(media, onFailure, timers = globalThis, messages = {}) {
    this.media = media;
    this.onFailure = onFailure;
    this.timers = timers;
    this.token = 0;
    this.active = false;
    this.pending = null;
    this.timer = 0;
    this.waitTimer = 0;
    this.timerEpoch = 0;
    this.started = false;
    this.lastPosition = null;
    this.onWaiting = messages.waiting || (() => {});
    this.onStarted = messages.started || (() => {});
  }
  clearTimer() {
    this.timerEpoch++;
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.waitTimer);
    this.timer = 0;
    this.waitTimer = 0;
  }
  arm() {
    this.clearTimer();
    const settle = this.settle,
      epoch = this.timerEpoch,
      token = this.token;
    this.media.ontimeupdate = () => this.noteProgress(token, epoch);
    this.timer = this.timers.setTimeout(() => {
      if (token !== this.token || epoch !== this.timerEpoch || !this.active)
        return;
      // Playback can advance before its timeupdate task is delivered. Sample
      // the owned position once at the deadline; genuine progress rearms and
      // invalidates this callback. An unresolved/still-stalled request fails.
      this.noteProgress(token, epoch);
      if (token === this.token && epoch === this.timerEpoch && this.active)
        settle?.(true);
    }, 120000);
    // An unresolved play request gets an actionable hint before the bounded
    // stall failure. A hint never advances the session or reports success.
    if (!this.started)
      this.waitTimer = this.timers.setTimeout(() => {
        if (epoch === this.timerEpoch && this.active && !this.started)
          this.onWaiting();
      }, 15000);
  }
  position() {
    try {
      const value = this.media.currentTime;
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }
  noteProgress(token, epoch) {
    if (
      token !== this.token ||
      epoch !== this.timerEpoch ||
      !this.active ||
      !this.started
    )
      return;
    const position = this.position();
    if (position === null || position === this.lastPosition) return;
    const advancing =
      this.lastPosition !== null && position > this.lastPosition;
    // A seek/reset establishes a new comparison point without extending the
    // inactivity deadline. A subsequent finite advance counts as progress.
    this.lastPosition = position;
    if (advancing) this.arm();
  }
  start(url, onEnd) {
    this.cancel();
    const token = this.token;
    let settled = false;
    this.active = true;
    this.started = false;
    this.onEnd = onEnd;
    this.lastPosition = null;
    this.settle = (failed) => {
      if (token !== this.token || settled) return;
      settled = true;
      this.clearTimer();
      this.media.onended = null;
      this.media.onerror = null;
      this.media.ontimeupdate = null;
      if (failed) {
        this.media.pause();
        // Report a resource failure even while paused so retry guidance is
        // available immediately. Completion still waits below for Continue;
        // this notification does not advance the frozen practice phase.
        this.onFailure();
      }
      // Failure feedback may cancel or replace this request synchronously.
      if (token !== this.token) return;
      if (this.active) {
        this.active = false;
        this.onEnd = null;
        onEnd(failed);
      } else this.pending = () => onEnd(failed);
    };
    const settle = this.settle;
    this.media.onended = () => settle(false);
    this.media.onerror = () => settle(true);
    // The completion owner and error handler must exist before source setup:
    // a damaged URL/media setter can throw or synchronously dispatch an error.
    try {
      this.media.src = url;
    } catch {
      settle(true);
      return;
    }
    if (settled || token !== this.token || !this.active) return;
    // Establish the actual readable position for this source. Unreadable or
    // invalid media state stays null until a valid event supplies a baseline.
    this.lastPosition = this.position();
    this.arm();
    this.play(token);
  }
  play(token) {
    try {
      const playing = this.media.play();
      Promise.resolve(playing).then(
        () => {
          if (token === this.token && this.active && !this.started) {
            this.started = true;
            this.timers.clearTimeout(this.waitTimer);
            this.waitTimer = 0;
            // Undefined-return implementations retain the same operational
            // fallback/timer state, but do not confirm playback for UI cleanup.
            this.onStarted({ confirmedPromise: typeof playing?.then === "function" });
          }
          // All requests share one media element. Reconcile its desired state:
          // a stale resolution must not stop newer active audio, but must pause
          // after cancel/pause even when its token is stale. Only rejection
          // settles callbacks, so that branch additionally requires ownership.
          if (!this.active) this.media.pause();
        },
        () => {
          if (token === this.token) this.settle?.(true);
        },
      );
    } catch {
      if (token === this.token) this.settle?.(true);
    }
  }
  hasPending() {
    return Boolean(this.onEnd || this.pending);
  }
  pause() {
    this.lastPosition = this.position();
    this.active = false;
    this.clearTimer();
    this.media.pause();
  }
  resume() {
    if (this.pending) {
      const fn = this.pending;
      this.pending = null;
      this.onEnd = null;
      fn();
      return;
    }
    if (!this.onEnd) return;
    // Snapshot paused movement before starting a fresh active deadline. If the
    // getter fails, the first readable event only establishes a baseline.
    this.lastPosition = this.position();
    this.active = true;
    this.arm();
    this.play(this.token);
  }
  cancel() {
    this.token++;
    this.active = false;
    this.pending = null;
    this.onEnd = null;
    this.settle = null;
    this.clearTimer();
    this.media.onended = null;
    this.media.onerror = null;
    this.media.ontimeupdate = null;
    this.media.pause();
    try {
      this.media.currentTime = 0;
    } catch {}
  }
}
