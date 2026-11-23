const DIRECTIONS = Object.freeze({
  breath: {
    heading: "Breathe",
    copy: "Close your eyes and focus on your breathing. Allow each exhale to release tension, and each inhale to fill your body with calmness and warmth.",
    name: "Ground",
    category: "GROUNDING · 4 MIN",
    description: "Relax physically and mentally",
    chip: "4-4-4-4",
    image: "breath.png",
    mode: "breathing",
    playLabel: "Start Ground breathing",
    settingsLabel: "Configure breathing practice",
  },
  physical: {
    heading: "Physical",
    copy: "Release tension through a short guided body practice. Move gently and stay within a comfortable range.",
    name: "Progressive Muscle Relaxation",
    category: "GUIDED · 8 MIN",
    description: "Relax physically and mentally",
    chip: "Progressive Muscle Relaxation",
    image: "physical.png",
    mode: "pmr",
    playLabel: "Start guided muscle relaxation",
    settingsLabel: "Configure muscle relaxation",
  },
  meditation: {
    heading: "Meditation",
    copy: "Make a little space between you and the noise. Choose a short guided practice or explore the library.",
    name: "Meditation library",
    category: "GUIDED PRACTICES",
    description: "Choose a guided practice for your moment.",
    chip: "Explore",
    image: "meditation.png",
    mode: null,
  },
});
const ORDER = ["breath", "physical", "meditation"];
export function setupDirections(
  root,
  { onGames = () => {}, onLeave = () => {}, onGarden = () => {}, onView = () => {}, onMeditation = () => {}, onDirectionChange = () => {} } = {},
) {
  const $ = (s) => root.querySelector(s),
    $$ = (s) => [...root.querySelectorAll(s)],
    panel = $("[data-direction]"),
    tabs = $$("[data-bret-tab]");
  const prefix = document.documentElement.dataset.mountPrefix || "",
    assetRoot = prefix + "/bret/main/";
  let current = "games",
    startX = null,
    lastSwipe = 0;
  // These three template-owned controls intentionally survive carousel renders.
  // render() moves them into the new active card before replacing the old track;
  // never clone them or leave their ownership with a discarded card.
  const play = $("[data-direction-play]"),
    settings = $("[data-direction-settings]");
  const menu = $("[data-bret-menu]"),
    toggle = $("[data-bret-menu-toggle]");
  if (!menu || !toggle) throw Error("Missing Bret menu controls");
  const abort = new AbortController();
  let disposed = false, observer = null, cardAbort = new AbortController();
  const on = (node, type, handler, signal = abort.signal) => {
    try {
      node?.addEventListener(type, handler, { signal });
    } catch (error) {
      dispose();
      throw error;
    }
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    cardAbort.abort();
    observer?.disconnect();
    startX = null;
    closeMenu();
  }
  function closeMenu(restore = false) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open Bret menu");
    if (restore) toggle.focus();
  }
  on(toggle, "click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "Close Bret menu" : "Open Bret menu",
    );
    if (open) menu.querySelector("a,button")?.focus();
  });
  on(document, "click", (e) => {
    if (!menu?.hidden && !menu.contains(e.target) && !toggle.contains(e.target))
      closeMenu();
  });
  on(document, "keydown", (e) => {
    if (e.key === "Escape" && !menu?.hidden) {
      e.preventDefault();
      closeMenu(true);
    }
  });
  on($("[data-bret-garden]"), "click", () => {
    closeMenu();
    onGarden();
  });
  function card(name, active) {
    const d = DIRECTIONS[name],
      b = document.createElement(active ? "article" : "button");
    if (!active) b.type = "button";
    else b.setAttribute("role", "group");
    b.className = "bret-direction-card" + (active ? " is-active" : "");
    b.dataset.directionCard = name;
    b.setAttribute(
      "aria-label",
      active
        ? `${d.name}: selected ${d.heading.toLowerCase()} practice`
        : `Explore ${d.heading.toLowerCase()}`,
    );
    b.tabIndex = active ? 0 : -1;
    const img = document.createElement("img");
    img.className = "bret-direction-card-art";
    img.src = assetRoot + d.image;
    img.alt = "";
    img.width = 1448;
    img.height = 1086;
    const plate = document.createElement("span");
    plate.className = "bret-direction-card-plate";
    for (const [cls, text] of [
      ["category", d.category],
      ["title", d.name],
      ["copy", d.description],
      ["chip", d.chip],
    ]) {
      const s = document.createElement("span");
      s.className = "bret-direction-card-" + cls;
      s.textContent = text;
      plate.append(s);
    }
    b.append(img);
    if (active) b.append(plate);
    on(b, "click", (e) => {
      if (e.detail && performance.now() - lastSwipe < 350) return;
      if (current !== name) {
        show(name);
        if (!panel.hidden) $("[data-direction-card].is-active")?.focus({ preventScroll: true });
      }
    }, cardAbort.signal);
    return b;
  }
  function alignTrack() {
    if (disposed) return;
    const i = ORDER.indexOf(current),
      width = $("[data-direction-carousel]").clientWidth;
    if (i < 0 || width < 1) return;
    const track = $("[data-direction-track]"),
      active = track.querySelector(".is-active");
    if (!active) return;
    const cardWidth = active.getBoundingClientRect().width,
      total = track.scrollWidth;
    const target = window.matchMedia("(max-width:767px)").matches
      ? 16 + (i * (width - cardWidth - 32)) / 2
      : (width - cardWidth) / 2;
    const offset =
      total <= width ? (width - total) / 2 : target - active.offsetLeft;
    track.style.left = offset + "px";
    track.style.transform = "none";
  }

  function render(name) {
    // Replaced cards must not be retained by the page-lifetime abort signal.
    cardAbort.abort();
    cardAbort = new AbortController();
    const d = DIRECTIONS[name];
    $("[data-direction-title]").textContent = d.heading;
    $("[data-direction-copy]").textContent = d.copy;
    $("[data-direction-carousel]").setAttribute(
      "aria-label",
      d.heading + " practices. Use arrow keys, Home or End to explore.",
    );
    const active = card(name, true),
      plate = active.querySelector(".bret-direction-card-plate");
    active.append(play);
    plate.append(settings);
    $("[data-direction-track]").replaceChildren(
      ...ORDER.map((direction) =>
        direction === name ? active : card(direction, false),
      ),
    );
    alignTrack();
    const available = Boolean(d.mode);
    play.hidden = !available;
    settings.hidden = !available;
    if (available) {
      const url =
        prefix +
        "/bret/practice?mode=" +
        d.mode +
        (name === "breath" ? "&cycles=15" : "");
      play.href = url;
      play.setAttribute("aria-label", d.playLabel);
      settings.href = url;
      settings.setAttribute("aria-label", d.settingsLabel);
    }
  }
  function show(name, { notify = true } = {}) {
    if (disposed) return;
    if (name !== "games" && !DIRECTIONS[name]) name = "breath";
    closeMenu();
    $("[data-direction-announcement]").textContent = "";
    onDirectionChange();
    current = name;
    root.dataset.bretSection = name;
    for (const b of tabs) {
      if (b.dataset.bretTab === name) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    if (name === "games") {
      panel.hidden = true;
      if (notify) {
        onGames();
      }
      return;
    }
    if (notify) onLeave();
    $$("[data-game-home],[data-catalog],[data-player],[data-garden]").forEach(
      (n) => (n.hidden = true),
    );
    panel.hidden = name === "meditation";
    if (name === "meditation") onMeditation({ focus: notify });
    else render(name);
    if (notify) {
      onView(name);
      $("[data-direction-announcement]").textContent =
        name === "meditation" ? "" : DIRECTIONS[name].heading + " selected.";
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }
  tabs.forEach((b) =>
    on(b, "click", () => show(b.dataset.bretTab)),
  );
  const carousel = $("[data-direction-carousel]");
  function adjacent(step) {
    const i = ORDER.indexOf(current),
      next = i + step;
    if (i >= 0 && next >= 0 && next < ORDER.length) show(ORDER[next]);
  }
  on(carousel, "keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step !== undefined || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (e.key === "Home") show(ORDER[0]);
      else if (e.key === "End") show(ORDER.at(-1));
      else adjacent(step);
      if (!panel.hidden) $("[data-direction-card].is-active")?.focus({ preventScroll: true });
    }
  });
  on(carousel, "pointerdown", (e) => {
    if (e.isPrimary) startX = e.clientX;
  });
  on(carousel, "pointerup", (e) => {
    if (e.isPrimary === false) return;
    if (startX === null) return;
    const diff = e.clientX - startX;
    startX = null;
    if (Math.abs(diff) >= 50) {
      lastSwipe = performance.now();
      e.preventDefault();
      adjacent(diff < 0 ? 1 : -1);
    }
  });
  on(carousel, "pointercancel", () => {
    startX = null;
  });
  // No pointer capture: nested Play/settings controls retain native activation.
  // A release outside the carousel must not finish an abandoned later gesture.
  on(carousel, "pointerleave", () => {
    startX = null;
  });
  try {
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(alignTrack);
      observer.observe(carousel);
    } else on(window, "resize", alignTrack);
  } catch (error) {
    dispose();
    throw error;
  }
  return { show, dispose };
}
