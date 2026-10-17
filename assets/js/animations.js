const starConfigs = [
  { x: 10, size: 4, duration: 8.8, delay: -1.2, drift: 22, dot: true },
  { x: 23, size: 7, duration: 10.6, delay: -7.1, drift: 32 },
  { x: 38, size: 4, duration: 7.9, delay: -4.8, drift: -13, dot: true },
  { x: 54, size: 6, duration: 11.8, delay: -9.4, drift: 25 },
  { x: 68, size: 4, duration: 9.5, delay: -2.9, drift: -18, dot: true },
  { x: 81, size: 8, duration: 12.5, delay: -6.3, drift: 28 },
  { x: 92, size: 4, duration: 8.4, delay: -5.2, drift: -12, dot: true },
];

function addFallingStars(hero, prefix = 'emt') {
  if (hero.querySelector(`.${prefix}-sky`)) return false;
  const sky = document.createElement('div');
  sky.className = `${prefix}-sky`;
  sky.setAttribute('aria-hidden', 'true');
  starConfigs.forEach(config => {
    const star = document.createElement('span');
    star.className = `${prefix}-star${config.dot ? ` ${prefix}-star--dot` : ''}`;
    for (const key of ['x', 'size', 'duration', 'delay', 'drift']) {
      const unit = key === 'x' ? '%' : ['duration', 'delay'].includes(key) ? 's' : 'px';
      star.style.setProperty(`--${key}`, `${config[key]}${unit}`);
    }
    sky.append(star);
  });
  hero.append(sky);
  return true;
}

// Stars are idempotent per container; Hugo uses full-page navigation.
// Per-node listener ownership also allows safe repeated initialization.
const pulseNodes = new WeakSet();
const pulses = new WeakMap();
export function initAnimations() {
  for (const [selector, prefix] of [
    ['.tests-scene', 'emt'],
    ['.article-catalog__hero', 'emt'],
    ['.section-24', 'emt'],
    ['.about-page .about-hero', 'emt-about'],
  ]) {
    document.querySelectorAll(selector).forEach(hero => addFallingStars(hero, prefix));
  }
  // Dormant public IX3 i-c719fde7/t-5d0fd902. Source CSS hides these controls.
  document.querySelectorAll('.scroll-text').forEach(node => {
    if (pulseNodes.has(node)) return;
    node.addEventListener('click', () => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      pulses.get(node)?.cancel();
      const animation = node.animate([
        { scale: '1', opacity: 1, easing: 'cubic-bezier(.333333,.666667,.666667,1)' },
        { scale: '0.96', opacity: 0.96, offset: 0.5, easing: 'cubic-bezier(.333333,.666667,.666667,1)' },
        { scale: '1', opacity: 1 },
      ], { duration: 1000 });
      pulses.set(node, animation);
    });
    pulseNodes.add(node);
  });
}
