// One owned in-page modal. All expected UI failures cancel without mutation.
export function createDecisionDialog({ dialog, announce }) {
  const document = dialog.ownerDocument;
  const dialogForm = dialog.querySelector("[data-dm-dialog-form]");
  const dialogInput = dialog.querySelector("[data-dm-dialog-input]");
  const dialogCancel = dialog.querySelector("[data-dm-dialog-cancel]");
  let pendingDialog = null;
  function finishDialog(value, failed = false) {
    const pending = pendingDialog;
    if (!pending) return;
    // Release the request before browser UI calls, which may throw or dispatch
    // a close event. Every expected modal failure cancels the requested action.
    pendingDialog = null;
    let closeFailed = false;
    try {
      if (dialog.open) dialog.close();
      closeFailed = dialog.open;
    } catch {
      closeFailed = true;
    }
    if (closeFailed) {
      failed = true;
      try {
        // Removing only `open` can leave the document modal/inert. Detach and
        // reinsert this same owned dialog to release its top-layer state while
        // preserving its controls, listeners and position for an explicit retry.
        const parent = dialog.parentNode,
          next = dialog.nextSibling;
        dialog.remove();
        dialog.removeAttribute("open");
        parent?.insertBefore(dialog, next);
      } catch {
        // Browser UI cleanup is best effort; never approve the pending action.
      }
    }
    try {
      if (pending.trigger?.isConnected)
        pending.trigger.focus({ preventScroll: true });
    } catch {
      failed = true;
    }
    if (failed)
      announce(
        "This browser could not use the decision dialog. Nothing was changed or saved. Export JSON to keep your working decision. You can retry the action.",
      );
    pending.resolve(failed ? null : value);
  }
  function askDecision({
    title,
    description,
    accept,
    name = null,
    returnFocus = document.activeElement,
  }) {
    // showModal makes the underlying page inert. Ignore programmatic re-entry;
    // native pointer/keyboard interaction remains inside the existing dialog.
    if (pendingDialog) return Promise.resolve(null);
    return new Promise((resolve) => {
      pendingDialog = { resolve, trigger: returnFocus, naming: name !== null };
      try {
        if (typeof dialog.showModal !== "function") throw new Error();
        dialog.querySelector("#dm-dialog-title").textContent = title;
        dialog.querySelector("#dm-dialog-description").textContent =
          description;
        dialog.querySelector("[data-dm-dialog-submit]").textContent = accept;
        dialog.querySelector("[data-dm-dialog-name]").hidden = name === null;
        dialog.querySelector("#dm-dialog-error").textContent = "";
        dialogInput.removeAttribute("aria-invalid");
        dialogInput.value = name === null ? "" : name;
        dialog.showModal();
        if (name === null) dialogCancel.focus();
        else {
          dialogInput.focus();
          dialogInput.select();
        }
      } catch {
        finishDialog(null, true);
      }
    });
  }
  dialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pendingDialog) return;
    if (pendingDialog.naming) {
      const name = dialogInput.value.trim();
      if (!name || name.length > 160) {
        dialog.querySelector("#dm-dialog-error").textContent =
          "Use a nonempty decision name of up to 160 characters.";
        dialogInput.setAttribute("aria-invalid", "true");
        try {
          dialogInput.focus();
        } catch {
          finishDialog(null, true);
        }
        return;
      }
      finishDialog(name);
    } else finishDialog(true);
  });
  dialogCancel.addEventListener("click", () => finishDialog(null));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finishDialog(null);
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open && pendingDialog) finishDialog(null);
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !pendingDialog) return;
    const controls = [
      ...dialog.querySelectorAll("button, input, select, textarea, a[href]"),
    ].filter((item) => !item.disabled && item.getClientRects().length > 0);
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      try {
        last?.focus();
      } catch {
        finishDialog(null, true);
      }
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      try {
        first?.focus();
      } catch {
        finishDialog(null, true);
      }
    }
  });

  return askDecision;
}
