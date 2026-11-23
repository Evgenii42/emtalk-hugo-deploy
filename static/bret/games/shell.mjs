export function setupBretShell(root) {
  const footer = document.querySelector('[data-site-footer-boundary]');
  if (!footer || typeof IntersectionObserver !== "function") return;
  const observer = new IntersectionObserver(entries => {
    const visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.15);
    root.classList.toggle("has-site-footer", visible);
  }, { threshold: [0, 0.15] });
  observer.observe(footer);
}
