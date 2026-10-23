// Named tokens own transient messages and unresolved finished guidance separately.
// A later waiting/pause/form message cannot erase another concern's recovery note.
export function createPracticeFeedback(presentation) {
  const slots = new Map();
  const show = (owner, message, finished = null) => {
    const token = presentation.feedback(message);
    slots.set(owner, {token, finished});
    return token;
  };
  const clearCaptured = (owner, token) => {
    presentation.clearFeedback(token);
    if (slots.get(owner)?.token === token) slots.delete(owner);
  };
  return Object.freeze({
    show,
    current: owner => slots.get(owner)?.token ?? null,
    clear: owner => clearCaptured(owner, slots.get(owner)?.token ?? null),
    clearCaptured,
    reset() { slots.clear(); presentation.feedback(""); },
    finish() {
      // Preserve stable concern order, showing every still-unresolved failure.
      // Successful recovery removes only its captured concern, never a newer one.
      const notes = [...slots.values()].map(slot => slot.finished).filter(Boolean);
      slots.clear();
      // Transient waiting/pause guidance is no longer applicable at finish.
      presentation.feedback([...new Set(notes)].join(" "));
    },
  });
}
