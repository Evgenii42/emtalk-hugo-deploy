export function setTextIfChanged(node, value) {
  if (node.textContent === value) return false;
  node.textContent = value;
  return true;
}

export function playedTimeLabel(milliseconds) {
  const seconds = Math.floor((Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0) / 1000);
  if (seconds < 60)
    return `${seconds} second${seconds === 1 ? "" : "s"} of play`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"} of play`;
}

export function formatClock(milliseconds) {
  const seconds = Math.floor((Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
