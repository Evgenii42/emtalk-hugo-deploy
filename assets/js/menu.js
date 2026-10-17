export function initMenus() {
  // Shared site navigation is owned by site-navigation.js. This controller
  // handles content FAQ disclosures only; the former header is no longer rendered.
  // Independent replacement for the source's non-hover Webflow FAQ dropdowns.
  const dropdowns = [...document.querySelectorAll('.w-dropdown')].map((root, index) => {
    const toggle = root.querySelector('.w-dropdown-toggle');
    const panel = root.querySelector('.w-dropdown-list');
    if (!toggle || !panel) return null;
    if (!panel.id) panel.id = `emt-disclosure-${index}`;
    toggle.setAttribute('role', 'button');
    toggle.tabIndex = 0;
    toggle.setAttribute('aria-controls', panel.id);
    toggle.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    const setOpen = open => {
      dropdowns.forEach(other => {
        if (other.root === root) return;
        if (open && !root.contains(other.root) && !other.root.contains(root)) other.setOpen(false);
        if (!open && root.contains(other.root) && other.toggle.getAttribute('aria-expanded') === 'true') other.setOpen(false);
      });
      root.classList.toggle('w--open', open);
      toggle.classList.toggle('w--open', open);
      panel.classList.toggle('w--open', open);
      toggle.setAttribute('aria-expanded', String(open));
      panel.setAttribute('aria-hidden', String(!open));
      panel.inert = !open;
    };
    toggle.addEventListener('click', event => {
      event.preventDefault();
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    toggle.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setOpen(toggle.getAttribute('aria-expanded') !== 'true');
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      toggle.focus();
    });
    return { root, toggle, setOpen };
  }).filter(Boolean);
  document.addEventListener('click', event => {
    dropdowns.forEach(({ root, setOpen }) => {
      if (!root.contains(event.target)) setOpen(false);
    });
  });
}
