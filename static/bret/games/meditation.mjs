import { checkIndex, checkDetail, checkCaptions, contentUrl, cueAt, clock, createMeditationRepository } from "./meditation-data.mjs";

export function setupMeditation(root) {
  const panel = root.querySelector("[data-meditation]");
  const $ = name => panel.querySelector(`[data-med-${name}]`);
  const prefix = document.documentElement.dataset.mountPrefix || "";
  const indexUrl = new URL(prefix + "/content/bret/meditations/index.json", location.origin).href;
  // Contract URLs are rooted at the origin of their JSON.
  const cacheFailures = new Set();
  function cacheFailed(key = "storage") { cacheFailures.add(key); $("cache-note").hidden = false; }
  function cacheSaved(key = "storage") { cacheFailures.delete(key); $("cache-note").hidden = cacheFailures.size === 0; }
  const repo = createMeditationRepository({ onCacheFailure: cacheFailed, onCacheSuccess: cacheSaved });
  let catalogue, selected, detail, category = "all", active = false, generation = 0;
  let request, audio, objectUrl, cues = [], captions = false, wanted = false, lastSaved = 0;
  const imageUrls = new Map();
  let resumeAt = 0, requestedPosition = 0, playAttempt = 0, view = "library", seeking = false;
  const progressKey = "emtalk.bret.meditation-progress.v1";
  const volumeKey = "emtalk.bret.meditation-volume.v1";
  try {
    const stored = localStorage.getItem(volumeKey), value = Number(stored);
    if (stored !== null && Number.isFinite(value) && value >= 0 && value <= 1) $("volume").value = String(value);
  } catch { /* The default volume remains available without storage. */ }
  function setView(name) {
    view = name;
    panel.dataset.medView = name;
    root.dataset.medView = name;
    document.documentElement.classList.toggle("bret-meditation-playing", name === "player");
    $("detail").setAttribute("aria-labelledby", name === "player" ? "med-player-title" : "med-title");
  }
  function notice(text) { $("notice").textContent = text; }
  function saved() {
    let raw;
    try { raw = localStorage.getItem(progressKey + "." + detail.id) || localStorage.getItem(progressKey); }
    catch { $("progress-note").hidden = false; return 0; }
    try {
      const value = JSON.parse(raw);
      if (value?.id === detail.id && value.version === detail.version && Number.isFinite(value.seconds) && value.seconds > 1 && value.seconds < detail.durationMs / 1000 - 2) return value.seconds;
    } catch { /* Storage is optional. */ }
    return 0;
  }
  function save(clear = false) {
    if (!audio || !detail || !Number.isFinite(audio.duration)) return;
    lastSaved = audio.currentTime;
    try {
      const key = progressKey + "." + detail.id;
      if (clear || audio.ended) {
        localStorage.removeItem(key);
        // Clear only this practice's legacy slot; another practice remains resumable.
        const legacy = localStorage.getItem(progressKey);
        let legacyId;
        try { legacyId = JSON.parse(legacy)?.id; } catch { /* Ignore old corrupt data. */ }
        if (legacyId === detail.id) localStorage.removeItem(progressKey);
      } else localStorage.setItem(key, JSON.stringify({ id: detail.id, version: detail.version, seconds: audio.currentTime }));
      $("progress-note").hidden = true;
    } catch { $("progress-note").hidden = false; }
  }
  function cleanup() {
    ++generation; ++playAttempt; request?.abort(); request = null; wanted = false;
    if (audio) { save(); audio.pause(); audio.removeAttribute("src"); audio.load(); audio.remove(); audio = null; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls.clear(); cues = []; captions = false; seeking = false;
  }
  function begin() { cleanup(); request = new AbortController(); return { token: generation, signal: request.signal }; }
  const valid = token => active && token === generation;
  function focusTitle() { $("title").focus({ preventScroll: true }); panel.scrollIntoView({ block: "start", behavior: "instant" }); }
  function node(tag, text, className) {
    const n = document.createElement(tag); if (text) n.textContent = text; if (className) n.className = className; return n;
  }
  async function image(img, path, base, token, signal, version) {
    img.hidden = true;
    try {
      const blob = await repo.blob(contentUrl(path, base), signal, false, version);
      if (!valid(token) || !img.isConnected) return;
      const previous = imageUrls.get(img);
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(blob); imageUrls.set(img, url); img.src = url; img.hidden = false;
      img.onerror = () => { img.hidden = true; };
    } catch { /* Keep readable copy when artwork is unavailable. */ }
  }
  function clearCards() {
    for (const img of $("cards").querySelectorAll("img")) {
      const url = imageUrls.get(img);
      if (url) URL.revokeObjectURL(url);
      imageUrls.delete(img);
    }
    $("cards").replaceChildren();
  }
  function cards(token, signal) {
    clearCards();
    const items = catalogue.meditations.filter(m => category === "all" || m.categoryId === category);
    for (const m of items) {
      const button = node("button", "", "med-card"); button.type = "button";
      const copy = node("span", "", "med-card-copy");
      copy.append(node("span", `GUIDED · ${clock(m.durationMs / 1000)} · EN`, "med-tag"), node("span", m.title, "med-card-title"), node("span", m.description, "med-card-description"));
      const img = node("img"); img.alt = ""; img.width = 112; img.height = 112;
      button.append(copy, img); button.addEventListener("click", () => openDetail(m));
      $("cards").append(button); image(img, m.thumbnailUrl, indexUrl, token, signal, m.version);
    }
    if (!items.length) $("cards").append(node("p", "No meditations in this category yet. Explore another moment.", "med-empty"));
  }
  function filters(token, signal) {
    // Categories, including an empty Sleep, belong to the published index contract.
    // Preserve that order and expose an honest empty state rather than invent content.
    // Old v1 caches may lack category fields. Keep the complete list until refresh.
    const categories = catalogue.categories && catalogue.meditations.every(m => typeof m.categoryId === "string") ? catalogue.categories : [];
    if (!categories.some(c => c.id === category)) category = "all";
    $("categories").replaceChildren();
    for (const c of [{ id: "all", title: "All" }, ...categories]) {
      const b = node("button", c.title); b.type = "button"; b.setAttribute("aria-pressed", String(category === c.id));
      b.addEventListener("click", () => {
        category = c.id;
        for (const n of $("categories").children) n.setAttribute("aria-pressed", String(n === b));
        cards(token, signal);
      });
      $("categories").append(b);
    }
  }
  async function library({ focus = false } = {}) {
    const { token, signal } = begin(); setView("library"); selected = detail = null;
    $("library").hidden = false; $("detail").hidden = true; $("refresh").disabled = true;
    notice("Loading meditations…");
    if (focus) panel.querySelector("h1").focus({ preventScroll: true });
    try {
      const result = await repo.json(indexUrl, v => checkIndex(v, indexUrl), signal);
      if (!valid(token)) return;
      catalogue = result.data; filters(token, signal); cards(token, signal);
      notice(result.offline ? "Using your saved library. Connect and refresh for updates." : "");
    } catch {
      if (!valid(token)) return;
      clearCards(); $("categories").replaceChildren();
      notice("The library could not be loaded. Check your connection and try Refresh library.");
    } finally { if (valid(token)) $("refresh").disabled = false; }
  }
  async function openDetail(item) {
    const { token, signal } = begin(); selected = item; detail = null; setView("detail");
    $("library").hidden = true; $("detail").hidden = false;
    $("title").textContent = item.title; $("meta").textContent = `GUIDED · ${clock(item.durationMs / 1000)} · ENGLISH`;
    $("player-title").textContent = item.title;
    $("player-meta").textContent = `GUIDED · ${clock(item.durationMs / 1000)} · ENGLISH`;
    $("description").textContent = ""; $("instructions").replaceChildren();
    $("preparation").hidden = false; $("player").hidden = true; $("background").hidden = true;
    $("start").hidden = false; $("start").disabled = true; $("restart").hidden = true; $("resume").hidden = true;
    $("detail-retry").hidden = true;
    notice("Loading this practice…"); focusTitle();
    try {
      const detailUrl = contentUrl(item.jsonUrl, indexUrl);
      const result = await repo.json(detailUrl, v => checkDetail(v, item, detailUrl), signal);
      if (!valid(token)) return;
      detail = result.data;
      $("title").textContent = detail.title; $("player-title").textContent = detail.title; $("description").textContent = detail.description;
      $("instructions").replaceChildren(...detail.instructions.map(x => node("li", x)));
      resumeAt = saved();
      $("start").textContent = resumeAt ? `Continue at ${clock(resumeAt)}` : "Start meditation";
      $("restart").hidden = !resumeAt; $("start").disabled = false;
      $("resume").textContent = resumeAt ? "Your place is saved in this browser." : ""; $("resume").hidden = !resumeAt;
      notice(result.offline ? "Using a saved practice. Audio is available offline only after it has fully loaded once." : "");
      image($("background"), detail.backgroundImageUrl, detailUrl, token, signal, detail.version);
    } catch {
      if (!valid(token)) return;
      notice("This practice could not be loaded. Try Retry practice, or use Back to meditations to refresh the library.");
      $("detail-retry").hidden = false;
    }
  }
  function update() {
    if (!audio || !detail) return;
    const seconds = Number.isFinite(audio.duration) ? audio.duration : detail.durationMs / 1000;
    $("seek").max = String(seconds);
    if (!seeking) $("seek").value = String(audio.currentTime);
    const displayedPosition = seeking ? Number($("seek").value) : audio.currentTime;
    $("seek").setAttribute("aria-valuetext", `${clock(displayedPosition)} of ${clock(seconds)}`);
    $("elapsed").textContent = clock(audio.currentTime); $("duration").textContent = clock(seconds);
    $("caption").textContent = captions ? cueAt(cues, audio.currentTime) : "";
    // Retain the caption area across silent gaps rather than moving the controls.
    $("caption").hidden = !captions;
    const label = audio.ended ? "Replay" : audio.paused ? "Play" : "Pause";
    $("toggle-label").textContent = label;
    $("toggle").setAttribute("aria-label", label);
    $("toggle").dataset.state = audio.paused ? "paused" : "playing";
    $("caption-note").hidden = !captions;
    if (!seeking && Math.abs(audio.currentTime - lastSaved) > 5) save();
  }
  function pause(message = "Paused. Your place is kept.") {
    wanted = false; seeking = false; ++playAttempt;
    if (!audio) {
      if (view === "player") $("state").textContent = "Autoplay paused. Audio is loading; press Play when ready.";
      return;
    }
    if (audio.ended) return;
    audio.pause(); save(); update(); $("state").textContent = message;
  }
  async function play() {
    if (!audio) return;
    if (document.hidden) { pause("Paused while you were away. Press Play when you are ready."); return; }
    const currentAudio = audio, token = generation, attempt = ++playAttempt;
    wanted = true;
    if (currentAudio.ended) currentAudio.currentTime = 0;
    try {
      await currentAudio.play();
      if (!valid(token) || !wanted || document.hidden) { currentAudio.pause(); return; }
      if (attempt !== playAttempt) return;
      $("state").textContent = "Playing"; $("audio-retry").hidden = true; update();
    } catch (error) {
      if (!valid(token) || attempt !== playAttempt) return;
      wanted = false; currentAudio.pause();
      if (error?.name === "NotAllowedError") {
        $("state").textContent = "Ready. Press Play to begin.";
        $("audio-retry").hidden = true; update(); return;
      }
      $("state").textContent = "Audio could not start. Press Play to try again, or Retry audio.";
      $("audio-retry").hidden = false; update();
    }
  }
  async function subtitles(token, signal) {
    $("caption-retry").hidden = true; $("caption-error").hidden = true;
    try {
      const result = await repo.json(contentUrl(detail.subtitlesUrl, indexUrl), v => checkCaptions(v, detail.id), signal);
      if (!valid(token)) return;
      cues = result.data.cues; $("captions").disabled = !cues.length; update();
    } catch {
      if (!valid(token)) return;
      $("caption-error").hidden = false; $("caption-retry").hidden = false;
    }
  }
  async function start(seconds = resumeAt, reload = false) {
    if (!detail) return;
    const candidate = typeof Audio === "function" ? new Audio() : null;
    if (!candidate?.canPlayType?.('audio/ogg; codecs="opus"')) {
      cleanup(); setView("detail");
      $("preparation").hidden = false; $("player").hidden = true;
      $("start").hidden = false; $("start").disabled = false;
      $("restart").hidden = !resumeAt; $("resume").hidden = !resumeAt;
      notice("This browser does not support the Opus audio used by these practices. Open Bret in an up-to-date browser with Ogg Opus support, or use Back to meditations to choose another moment.");
      focusTitle();
      return;
    }
    requestedPosition = seconds;
    // Keep detail artwork while replacing only the audio session.
    ++generation; request?.abort(); request = new AbortController();
    const token = generation, signal = request.signal;
    if (audio) { save(); audio.pause(); audio.removeAttribute("src"); audio.load(); audio.remove(); audio = null; }
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
    cues = []; captions = false; seeking = false; wanted = true; setView("player");
    playbackOptions(false);
    $("preparation").hidden = true; $("start").hidden = true; $("restart").hidden = true; $("resume").hidden = true;
    $("player").hidden = false; $("state").textContent = "Loading audio. You can leave at any time.";
    $("duration").textContent = clock(detail.durationMs / 1000); $("elapsed").textContent = clock(seconds);
    $("audio-retry").hidden = true; $("caption").hidden = true; $("captions").disabled = true;
    $("captions").setAttribute("aria-pressed", "false"); $("toggle-label").textContent = "Play";
    $("toggle").setAttribute("aria-label", "Play"); $("toggle").dataset.state = "paused"; $("caption-note").hidden = true;
    for (const n of panel.querySelectorAll("[data-med-seek],[data-med-toggle],[data-med-skip]")) n.disabled = true;
    notice("");
    if (!document.hidden) { window.scrollTo({ top: 0, behavior: "instant" }); $("state").focus({ preventScroll: true }); }
    subtitles(token, signal);
    // Retry artwork if Start interrupted its previous download.
    image($("background"), detail.backgroundImageUrl, indexUrl, token, signal, detail.version);
    try {
      const blob = await repo.blob(contentUrl(detail.audioUrl, indexUrl), signal, reload, detail.version);
      if (!valid(token)) return;
      objectUrl = URL.createObjectURL(blob);
      const a = candidate; audio = a; a.preload = "auto"; a.volume = Number($("volume").value);
      a.hidden = true; a.dataset.medAudio = ""; $("player").append(a);
      a.addEventListener("loadedmetadata", () => {
        if (!valid(token)) return;
        a.currentTime = Math.min(seconds, Math.max(0, a.duration - 0.1)); lastSaved = a.currentTime;
        for (const n of panel.querySelectorAll("[data-med-seek],[data-med-toggle],[data-med-skip]")) n.disabled = false;
        $("state").textContent = "Ready. Press Play to begin."; update();
        if (!document.hidden && document.activeElement === $("state")) $("toggle").focus({ preventScroll: true });
        if (wanted) play();
      });
      a.addEventListener("timeupdate", () => { if (valid(token)) update(); });
      a.addEventListener("pause", () => { if (valid(token)) update(); });
      a.addEventListener("ended", () => {
        if (!valid(token)) return;
        wanted = false; save(true); update(); $("state").textContent = "Practice complete. Take a moment before you return.";
      });
      a.addEventListener("error", () => {
        if (!valid(token)) return;
        wanted = false; $("state").textContent = "This browser could not play the Opus audio. Try Retry audio or another browser.";
        $("audio-retry").hidden = false;
      });
      a.src = objectUrl; a.load();
    } catch {
      if (!valid(token)) return;
      $("state").textContent = "Audio could not be loaded. Check your connection and retry."; $("audio-retry").hidden = false;
    }
  }
  $("refresh").addEventListener("click", () => library());
  $("detail-retry").addEventListener("click", () => { if (active && selected && view === "detail") openDetail(selected); });
  $("back").addEventListener("click", () => library({ focus: true }));
  $("start").addEventListener("click", () => start());
  $("restart").addEventListener("click", () => start(0));
  $("toggle").addEventListener("click", () => audio?.paused ? play() : pause());
  $("audio-retry").addEventListener("click", () => start(audio && Number.isFinite(audio.duration) ? audio.currentTime : requestedPosition, true));
  $("caption-retry").addEventListener("click", () => { if (request && detail && view === "player") subtitles(generation, request.signal); });
  $("captions").addEventListener("click", () => { captions = !captions; $("captions").setAttribute("aria-pressed", String(captions)); update(); });
  $("volume").addEventListener("input", () => {
    const value = Number($("volume").value);
    if (audio) audio.volume = value;
    try { localStorage.setItem(volumeKey, String(value)); } catch { /* Storage is optional. */ }
  });
  let optionsTrigger;
  function playbackOptions(open, trigger) {
    $("options").hidden = !open;
    for (const key of ["settings", "volume-toggle"]) $(key).setAttribute("aria-expanded", String(open));
    if (open) { optionsTrigger = trigger; $("volume").focus({ preventScroll: true }); }
    else if (trigger) (trigger === true ? optionsTrigger : trigger)?.focus({ preventScroll: true });
  }
  for (const key of ["settings", "volume-toggle"]) $(key).addEventListener("click", () => playbackOptions($("options").hidden, $(key)));
  $("options-close").addEventListener("click", () => playbackOptions(false, true));
  function seek(seconds) {
    if (!audio || !Number.isFinite(audio.duration)) return;
    try { audio.currentTime = Math.max(0, Math.min(seconds, audio.duration)); if (!seeking) save(); update(); }
    catch { $("state").textContent = "This position is not available yet."; }
  }
  $("seek").addEventListener("pointerdown", e => { seeking = true; $("seek").setPointerCapture?.(e.pointerId); });
  $("seek").addEventListener("input", () => seek(Number($("seek").value)));
  const finishSeek = () => { if (!seeking) return; seeking = false; save(); update(); };
  const seekKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
  $("seek").addEventListener("keydown", e => { if (seekKeys.has(e.key)) seeking = true; });
  $("seek").addEventListener("keyup", e => { if (seekKeys.has(e.key)) finishSeek(); });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) $("seek").addEventListener(event, finishSeek);
  for (const b of panel.querySelectorAll("[data-med-skip]")) b.addEventListener("click", () => seek((audio?.currentTime || 0) + Number(b.dataset.medSkip)));
  function onVisibilityChange() { if (active && view === "player" && document.hidden) pause("Paused while you were away. Press Play when you are ready."); }
  function onPageHide() { if (!active) return; pause(); ++generation; request?.abort(); }
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", e => { if (e.persisted && active) library(); });
  root.querySelector("[data-bret-menu-toggle]")?.addEventListener("click", () => { if (active && view === "player") pause(); });
  function onKeydown(e) {
    if (!active || view !== "player" || e.key !== "Escape") return;
    if (!$("options").hidden) { e.preventDefault(); playbackOptions(false, true); }
    else pause();
  }
  document.addEventListener("keydown", onKeydown);
  return {
    show({ focus = false } = {}) { active = true; panel.hidden = false; library({ focus }); },
    hide() { if (!active) return; cleanup(); active = false; view = "library"; panel.hidden = true; delete root.dataset.medView; delete panel.dataset.medView; document.documentElement.classList.remove("bret-meditation-playing"); },
  };
}
