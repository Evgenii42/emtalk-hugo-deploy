// Owns the two live regions and field linkage; no model or storage access.
export function createWorkspaceFeedback({app, screen, status, node}) {
  const errorStatus = app.querySelector("[data-dm-error]") || node("p", {
    id: "dm-error-message", "data-dm-error": "", role: "alert", "aria-live": "assertive", "aria-atomic": "true",
  });
  if (!errorStatus.isConnected) status.after(errorStatus);
  function clearError(input) {
    const inputs = input ? [input] : app.querySelectorAll('[aria-invalid="true"]');
    for (const field of inputs) {
      field.removeAttribute("aria-invalid");
      const described = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(value => value && value !== errorStatus.id);
      if (described.length) field.setAttribute("aria-describedby", described.join(" "));
      else field.removeAttribute("aria-describedby");
    }
    if (!app.querySelector('[aria-invalid="true"]')) errorStatus.textContent = "";
  }
  const announce = (message) => {
    if (!message) clearError();
    else if (!app.querySelector('[aria-invalid="true"]')) errorStatus.textContent = "";
    status.textContent = message;
  };
  function fail(message, input = null) {
    status.textContent = "";
    if (input) {
      input.setAttribute("aria-invalid", "true");
      const described = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (!described.includes(errorStatus.id)) described.push(errorStatus.id);
      input.setAttribute("aria-describedby", described.join(" "));
    }
    errorStatus.textContent = message;
  }
  function validateVisibleFields() {
    const invalid = screen.querySelector('[aria-invalid="true"]');
    if (!invalid) return true;
    fail("Correct the highlighted field before continuing, or clear an optional new entry.", invalid);
    invalid.focus();
    return false;
  }
  return Object.freeze({announce,fail,clearError,validateVisibleFields});
}
