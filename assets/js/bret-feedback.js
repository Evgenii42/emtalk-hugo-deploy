// Named tokens are the sole owners of transient feedback. Clearing one concern
// cannot clear a newer message from another concern, even with identical text.
export function createPracticeFeedback(presentation) {
  const slots = new Map();
  const show = (owner, message, finished = null) => {
    const token = presentation.feedback(message, finished);
    slots.set(owner, token);
    return token;
  };
  const clearCaptured = (owner, token) => {
    presentation.clearFeedback(token);
    if (slots.get(owner) === token) slots.delete(owner);
  };
  return Object.freeze({
    show,
    current: owner => slots.get(owner) ?? null,
    clear: owner => clearCaptured(owner, slots.get(owner) ?? null),
    clearCaptured,
    message: (message, finished = null) => presentation.feedback(message, finished),
  });
}
