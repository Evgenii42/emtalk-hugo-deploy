// Own only Bret view fragments. Restoring a game view renders a stopped setup,
// never starts a game or accrues time without a deliberate Play action.
export function createViewHistory({ history, location, views, onNavigate }) {
  const allowed = new Set(views);
  let current = null, restoring = false;
  const viewAtLocation = () => {
    const view = location.hash.slice(1);
    return allowed.has(view) ? view : null;
  };
  const viewInEntry = () => {
    const view = history.state?.bretView;
    return allowed.has(view) ? view : null;
  };
  function record(view) {
    if (!allowed.has(view)) throw Error("Unknown Bret view");
    if (restoring || (current === view && location.hash === "#" + view)) return;
    history.pushState({ bretView: view }, "", "#" + view);
    current = view;
  }
  function restore({ force = false, initial = false } = {}) {
    // BFCache can restore an ordinary skip anchor after the host has destroyed
    // its old controller. Rebuild the remembered view without rewriting that
    // document anchor or starting the saved game.
    const view = viewAtLocation() || viewInEntry() || (force ? current : null);
    if (!view) {
      // A native skip fragment is not a new app view. Remember the current view
      // in this entry so a fresh document can restore it as well as BFCache can.
      if (current) history.replaceState({ bretView: current }, "", location.hash);
      return false;
    }
    if (!force && current === view) return false;
    if (history.state?.bretView !== view)
      history.replaceState({ bretView: view }, "", location.hash);
    restoring = true;
    try {
      onNavigate(view, { initial });
      current = view;
      return true;
    } finally {
      // A failed render must not leave subsequent recovery navigation suppressed.
      restoring = false;
    }
  }
  function start(fallback) {
    const direct = viewAtLocation(), remembered = viewInEntry();
    const view = direct || remembered || fallback;
    if (!allowed.has(view)) throw Error("Unknown initial Bret view");
    history.replaceState({ bretView: view }, "", direct || !location.hash ? "#" + view : location.hash);
    restore({ force: true, initial: true });
  }
  return { record, restore, start };
}
