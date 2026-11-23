// Describe this session's captured saving capability, never a browser brand.
// Ownership and visit-only fallback remain entirely with createProgressStore.
export function savingUnavailableNotice(locks) {
  return typeof locks?.request === "function"
    ? "Saving is off for this visit. You can keep playing. Reload Bret to try saving again; reloading or closing this page will lose unsaved play from this visit."
    : "Saving is unavailable in this browser session. You can keep playing, but reloading or closing this page will lose unsaved play from this visit. Try another browser session to keep future progress.";
}
