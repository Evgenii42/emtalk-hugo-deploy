// Optional visual media never owns or changes the meditation audio session.
export function createMeditationBackground(panel, options = {}) {
  const video = panel?.querySelector?.("[data-med-background-video]");
  const poster = panel?.querySelector?.("[data-med-background-poster]");
  const buttons = [...(panel?.querySelectorAll?.("[data-med-animation]") || [])];
  const notes = [...(panel?.querySelectorAll?.("[data-med-animation-note]") || [])];
  if (!video || typeof video.play !== "function" || !buttons.length) return null;
  const doc = options.document ?? globalThis.document;
  const preference = options.preference ?? globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const connection = options.connection ?? globalThis.navigator?.connection;
  let storage;
  try { storage = options.storage ?? globalThis.localStorage; } catch { /* Optional preference. */ }
  const storageKey = "emtalk.bret.meditation-animation.v1";
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  let enabled = true, metadata, supported = false, wanted = false, owner = 0, attempt = 0;
  let failed = false, denied = false, disposed = false, mediaError, loadingTimer, posterLoad, posterError;
  try { enabled = storage?.getItem(storageKey) !== "off"; } catch { /* In-session choice works. */ }
  const blocked = () => Boolean(preference?.matches || connection?.saveData);
  const hidden = () => Boolean(doc?.hidden);
  function pauseElement() { try { video.pause(); } catch { /* Still image remains usable. */ } }
  function stopTimer() { if (loadingTimer !== undefined) cancel(loadingTimer); loadingTimer = undefined; }
  function render() {
    const running = Boolean(metadata && supported && enabled && wanted && !blocked() && !video.paused && !video.hidden);
    for (const button of buttons) {
      button.hidden = !metadata || !supported;
      button.disabled = blocked();
      button.setAttribute("aria-pressed", String(running));
      button.textContent = failed ? "Retry animation" : running ? "Pause animation" : wanted && !blocked() ? "Stop animation" : "Start animation";
    }
    let message = "";
    if (metadata && !supported) message = "Still image shown. This browser does not support the animation.";
    else if (metadata && wanted && !running) message = "Loading animation. Still image shown.";
    else if (metadata && blocked()) message = "Still image shown for your device's motion or data-saving preference.";
    else if (failed) message = "Animation unavailable. Still image shown; audio can still play.";
    else if (denied) message = "Still image shown. Press Start animation when you are ready.";
    else if (metadata && !enabled) message = "Still image selected.";
    else if (metadata && !wanted) message = "Animation paused.";
    for (const note of notes) note.textContent = message;
  }
  function releasePoster() {
    if (!poster) return;
    if (posterLoad) poster.removeEventListener("load", posterLoad);
    if (posterError) poster.removeEventListener("error", posterError);
    posterLoad = posterError = null; poster.hidden = true; poster.removeAttribute("src");
  }
  function loadPoster(generation) {
    if (!poster || poster.getAttribute("src") === metadata.poster) return;
    releasePoster();
    posterLoad = () => { if (generation === owner && enabled && !blocked() && !disposed) poster.hidden = false; };
    posterError = () => { if (generation === owner) poster.hidden = true; };
    poster.addEventListener("load", posterLoad); poster.addEventListener("error", posterError);
    poster.src = metadata.poster;
  }
  function release({ keepPoster = false } = {}) {
    ++attempt; wanted = false; stopTimer(); pauseElement(); video.hidden = true;
    if (!keepPoster) releasePoster();
    if (mediaError) video.removeEventListener("error", mediaError);
    mediaError = null;
    try {
      const hadSource = video.getAttribute("src");
      video.removeAttribute("src"); video.removeAttribute("poster");
      if (hadSource) video.load();
    } catch { /* Releasing optional media cannot prevent leaving a practice. */ }
  }
  function mediaUrl(raw, base, extension) {
    if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || /[\\\s%?#]/.test(raw) || raw.split("/").some(x => x === "." || x === "..")) throw Error("Invalid optional media URL");
    const url = new URL(raw, base), origin = new URL(base);
    if (url.origin !== origin.origin || !/^https?:$/.test(url.protocol) || !url.pathname.endsWith(extension)) throw Error("Invalid optional media origin");
    return url.href;
  }
  function parse(value, base) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.mimeType !== "video/webm" || value.codecs !== "vp9") return null;
    for (const key of ["width", "height", "durationMs", "bytes"]) if (!Number.isSafeInteger(value[key]) || value[key] <= 0) return null;
    if (value.width > 3840 || value.height > 3840 || value.durationMs > 60000 || value.bytes > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(value.sha256)) return null;
    try { return { url: mediaUrl(value.url, base, ".webm"), poster: mediaUrl(value.posterImageUrl, base, ".webp") }; }
    catch { return null; }
  }
  function fail(generation) {
    if (generation !== owner || disposed) return;
    release({ keepPoster: true }); failed = true; render();
  }
  async function play({ restart = false } = {}) {
    if (disposed || !metadata || !supported || !enabled || blocked() || hidden() || failed || denied) { render(); return; }
    wanted = true;
    const generation = owner, token = ++attempt;
    stopTimer();
    loadingTimer = schedule(() => { if (generation === owner && token === attempt && wanted) fail(generation); }, 12000);
    try {
      loadPoster(generation);
      video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true;
      if (!video.getAttribute("src")) {
        video.poster = metadata.poster;
        mediaError = () => fail(generation);
        video.addEventListener("error", mediaError);
        video.src = metadata.url;
      }
      if (restart) { try { video.currentTime = 0; } catch { /* Metadata may still be arriving. */ } }
      const result = video.play(); render();
      await result;
      if (disposed || generation !== owner || token !== attempt) {
        // An old promise cannot undo the current owner's pause or still choice.
        if (!wanted || !enabled || blocked() || hidden() || disposed) pauseElement();
        return;
      }
      stopTimer();
      if (!wanted || !enabled || blocked() || hidden()) { pauseElement(); render(); return; }
      video.hidden = false; render();
    } catch (error) {
      if (disposed || generation !== owner || token !== attempt) return;
      if (error?.name === "NotAllowedError") { release({ keepPoster: true }); denied = true; render(); }
      else fail(generation);
    }
  }
  function pause() { ++attempt; wanted = false; stopTimer(); pauseElement(); render(); }
  function clear() { ++owner; release(); metadata = null; supported = false; failed = denied = false; render(); }
  function prepare(detail, detailUrl) {
    if (disposed) return;
    clear(); metadata = parse(detail?.backgroundVideo, detailUrl);
    if (metadata) { try { supported = Boolean(video.canPlayType?.('video/webm; codecs="vp9"')); } catch { supported = false; } }
    render();
    if (metadata && supported && enabled && !blocked() && !hidden()) void play();
  }
  function toggle() {
    if (!metadata || !supported || blocked() || disposed) return;
    if (wanted && !failed && !denied) { enabled = false; release(); }
    else { enabled = true; failed = denied = false; }
    try { storage?.setItem(storageKey, enabled ? "on" : "off"); } catch { /* In-session choice works. */ }
    render();
    if (enabled) void play();
  }
  function preferenceChanged() {
    if (blocked()) release();
    render(); // Returning from reduced motion or data saving never restarts by itself.
  }
  function visibilityChanged() { if (hidden()) pause(); }
  for (const button of buttons) button.addEventListener("click", toggle);
  preference?.addEventListener?.("change", preferenceChanged);
  connection?.addEventListener?.("change", preferenceChanged);
  doc?.addEventListener?.("visibilitychange", visibilityChanged);
  render();
  return {
    prepare, play, pause, clear,
    finish() { pause(); video.hidden = true; try { video.currentTime = 0; } catch { /* The matching poster is independent of video seeking. */ } },
    dispose() {
      if (disposed) return;
      clear(); disposed = true;
      for (const button of buttons) button.removeEventListener("click", toggle);
      preference?.removeEventListener?.("change", preferenceChanged);
      connection?.removeEventListener?.("change", preferenceChanged);
      doc?.removeEventListener?.("visibilitychange", visibilityChanged);
    },
  };
}
