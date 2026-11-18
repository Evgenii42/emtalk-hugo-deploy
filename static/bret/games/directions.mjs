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
    name: "Relax Short",
    category: "6 MIN",
    description: "A quick ambient session to ease tension and bring back calm.",
    chip: "6 min",
    badge: "COMING SOON",
    image: "meditation.png",
    mode: null,
  },
});
const ORDER = ["breath", "physical", "meditation"];
export function setupDirections(
  root,
  { onGames = () => {}, onLeave = () => {}, onGarden = () => {} } = {},
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
  const play = $("[data-direction-play]"),
    unavailable = $("[data-direction-unavailable]"),
    settings = $("[data-direction-settings]");
  const menu = $("[data-bret-menu]"),
    toggle = $("[data-bret-menu-toggle]");
  function closeMenu(restore = false) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open Bret menu");
    if (restore) toggle.focus();
  }
  toggle?.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "Close Bret menu" : "Open Bret menu",
    );
    if (open) menu.querySelector("a,button")?.focus();
  });
  document.addEventListener("click", (e) => {
    if (!menu?.hidden && !menu.contains(e.target) && !toggle.contains(e.target))
      closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu?.hidden) {
      e.preventDefault();
      closeMenu(true);
    }
  });
  $("[data-bret-garden]")?.addEventListener("click", () => {
    closeMenu();
    onGarden();
  });
  function card(name, active) {
    const d = DIRECTIONS[name],
      b = document.createElement(active ? "article" : "button");
    if (!active) b.type = "button";
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
    if (d.badge) {
      const badge = document.createElement("span");
      badge.className = "bret-direction-card-badge";
      badge.textContent = d.badge;
      plate.append(badge);
    }
    b.append(img);
    if (active) b.append(plate);
    b.addEventListener("click", (e) => {
      if (e.detail && performance.now() - lastSwipe < 350) return;
      if (current !== name) show(name);
    });
    return b;
  }
  function alignTrack() {
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
    track.dataset.activeIndex = String(i);
  }

  function render(name) {
    const d = DIRECTIONS[name],
      i = ORDER.indexOf(name);
    $("[data-direction-title]").textContent = d.heading;
    $("[data-direction-copy]").textContent = d.copy;
    $("[data-direction-carousel]").setAttribute(
      "aria-label",
      d.heading + " practices. Use left and right arrow keys to explore.",
    );
    const active = card(name, true),
      plate = active.querySelector(".bret-direction-card-plate");
    active.append(play, unavailable);
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
    unavailable.hidden = available;
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
    if (name !== "games" && !DIRECTIONS[name]) name = "breath";
    closeMenu();
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
        history.replaceState(null, "", "#games");
      }
      return;
    }
    if (notify) onLeave();
    $$("[data-game-home],[data-catalog],[data-player],[data-garden]").forEach(
      (n) => (n.hidden = true),
    );
    panel.hidden = false;
    render(name);
    if (notify) {
      history.replaceState(null, "", "#" + name);
      $("[data-direction-announcement]").textContent =
        DIRECTIONS[name].heading + " selected.";
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }
  tabs.forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.bretTab)),
  );
  const carousel = $("[data-direction-carousel]");
  function adjacent(step) {
    const i = ORDER.indexOf(current),
      next = i + step;
    if (i >= 0 && next >= 0 && next < ORDER.length) show(ORDER[next]);
  }
  carousel?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      adjacent(e.key === "ArrowRight" ? 1 : -1);
      $("[data-direction-card].is-active")?.focus({ preventScroll: true });
    }
  });
  carousel?.addEventListener("pointerdown", (e) => {
    if (e.isPrimary) startX = e.clientX;
  });
  carousel?.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const diff = e.clientX - startX;
    startX = null;
    if (Math.abs(diff) >= 50) {
      lastSwipe = performance.now();
      e.preventDefault();
      adjacent(diff < 0 ? 1 : -1);
    }
  });
  carousel?.addEventListener("pointercancel", () => {
    startX = null;
  });
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(alignTrack);
    observer.observe(carousel);
  } else window.addEventListener("resize", alignTrack);
  return { show };
}
