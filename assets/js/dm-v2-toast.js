// Pure placement. A null result asks the controller for normal-flow feedback;
// it never puts a notice over an action/header merely to keep it floating.
export function findToastPlacement(notice, obstacles, viewport, margin = 8, gap = 12) {
  const {width, height} = notice;
  if (![notice.left, notice.top, width, height, viewport.width, viewport.height, margin, gap].every(Number.isFinite) ||
      width <= 0 || height <= 0 || margin < 0 || gap < 0 || width > viewport.width - 2 * margin || height > viewport.height - 2 * margin) return null;
  const boxes = obstacles.filter(box =>
    [box.left, box.right, box.top, box.bottom].every(Number.isFinite) &&
    box.right > box.left && box.bottom > box.top && box.right > 0 &&
    box.left < viewport.width && box.bottom > 0 && box.top < viewport.height);
  const xs = new Set([notice.left, margin, viewport.width - margin - width]);
  const ys = new Set([notice.top, margin, viewport.height - margin - height]);
  for (const box of boxes) {
    xs.add(box.left - gap - width); xs.add(box.right + gap);
    ys.add(box.top - gap - height); ys.add(box.bottom + gap);
  }
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const candidates = [];
  for (const left of xs) for (const top of ys) {
    const box = {left, top, right: left + width, bottom: top + height, width, height};
    if (Number.isFinite(left) && Number.isFinite(top) && left >= margin && top >= margin &&
        box.right <= viewport.width - margin && box.bottom <= viewport.height - margin &&
        !boxes.some(obstacle => intersects(box, obstacle))) candidates.push(box);
  }
  candidates.sort((a, b) =>
    (Math.abs(a.left - notice.left) + Math.abs(a.top - notice.top)) -
    (Math.abs(b.left - notice.left) + Math.abs(b.top - notice.top)));
  return candidates[0] || null;
}
