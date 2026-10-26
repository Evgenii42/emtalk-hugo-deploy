// Owns the two live regions and field linkage; no model or storage access.
export function createWorkspaceFeedback({app, screen, status, node}) {
  const errorStatus = app.querySelector("[data-dm-error]") || node("p", {
    "data-dm-error": "", role: "alert", "aria-live": "assertive", "aria-atomic": "true",
  });
  if (!errorStatus.id) {
    let id = "dm-error-message", suffix = 1;
    while (app.ownerDocument.getElementById(id)) id = "dm-error-message-" + suffix++;
    errorStatus.id = id;
  }
  if (!errorStatus.isConnected) status.after(errorStatus);
  let errorField = null;
  // Option edits already explain a pending value beside that exact field.
  // Keep the assertive linked alert, without inserting the same visible copy
  // above the form on blur and moving a pointer's intended action target.
  function visibleInlineError(input) {
    if (!input) return;
    return (input.getAttribute("aria-describedby") || "").split(/\s+/)
      .map(id => id && app.ownerDocument.getElementById(id)).find(inline =>
        inline && app.contains(inline) && inline.hasAttribute("data-dm-option-edit-error")
        && !inline.hidden && inline.getClientRects().length > 0
        && app.ownerDocument.defaultView.getComputedStyle(inline).visibility === "visible");
  }
  function clearAlert() {
    errorStatus.textContent = "";
    errorStatus.removeAttribute("data-dm-inline-error-duplicate");
    errorField = null;
  }
  function clearError(input) {
    // Live pending guidance replaces stale success feedback while typing,
    // before blur could remove that status and shift a pointer action.
    if (input?.hasAttribute("data-dm-pending-edit") && visibleInlineError(input)) status.textContent = "";
    const inputs = input ? [input] : app.querySelectorAll('[aria-invalid="true"]');
    for (const field of inputs) {
      field.removeAttribute("aria-invalid");
      const described = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(value => value && value !== errorStatus.id);
      if (described.length) field.setAttribute("aria-describedby", described.join(" "));
      else field.removeAttribute("aria-describedby");
    }
    if (!app.querySelector('[aria-invalid="true"]')
        || errorField && errorField.getAttribute("aria-invalid") !== "true") {
      clearAlert();
    }
  }
  const announce = (message) => {
    if (!message) clearError();
    else if (!app.querySelector('[aria-invalid="true"]')) clearAlert();
    status.textContent = message;
  };
  function fail(message, input = null) {
    status.textContent = "";
    errorField = input;
    const inline = visibleInlineError(input);
    errorStatus.toggleAttribute("data-dm-inline-error-duplicate", !!message && inline?.textContent === message);
    if (input) {
      input.setAttribute("aria-invalid", "true");
      const described = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (!described.includes(errorStatus.id)) described.push(errorStatus.id);
      input.setAttribute("aria-describedby", described.join(" "));
    }
    errorStatus.textContent = message;
  }
  function validateVisibleFields() {
    let invalid = screen.querySelector('[data-dm-pending-edit], [aria-invalid="true"]');
    if (!invalid) return true;
    // Navigation/save is an explicit commit boundary. Live typing itself never
    // sets aria-invalid or writes to the assertive error region.
    const committed = invalid;
    if (committed.hasAttribute('data-dm-pending-edit'))
      committed.dispatchEvent(new Event('change', {bubbles:true}));
    // Commit handlers can correct or replace controls. Only a remaining live
    // invalid field blocks navigation; never reintroduce a resolved error.
    invalid = screen.querySelector('[data-dm-pending-edit], [aria-invalid="true"]');
    if (!invalid) { clearError(committed); return true; }
    const hasSpecificError = errorField === invalid && invalid.getAttribute("aria-invalid") === "true"
      && (invalid.getAttribute("aria-describedby") || "").split(/\s+/).includes(errorStatus.id)
      && errorStatus.textContent.trim();
    if (!hasSpecificError)
      fail("Correct the highlighted field before continuing, or clear an optional new entry.", invalid);
    invalid.focus();
    return false;
  }
  return Object.freeze({announce,fail,clearError,validateVisibleFields});
}
