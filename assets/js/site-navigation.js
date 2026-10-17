// Hugo renders the complete header before this module; no header injection or
// client-side routing occurs. Re-run initialization if that contract changes.
const disclosures = [...document.querySelectorAll('.site-header__disclosure')];
function closeDisclosure(disclosure, restoreFocus = false) {
  if (!disclosure.open) return;
  disclosure.open = false;
  if (restoreFocus) disclosure.querySelector('summary').focus();
}
for (const disclosure of disclosures) {
  disclosure.addEventListener('toggle', () => {
    if (disclosure.open) for (const other of disclosures) if (other !== disclosure) closeDisclosure(other);
  });
  disclosure.addEventListener('keydown', event => {
    if (event.key === 'Escape' && disclosure.open) {
      event.preventDefault();
      closeDisclosure(disclosure, true);
    }
  });
  disclosure.addEventListener('focusout', event => {
    if (event.relatedTarget && !disclosure.contains(event.relatedTarget)) closeDisclosure(disclosure);
  });
}
document.addEventListener('pointerdown', event => {
  for (const disclosure of disclosures) if (!disclosure.contains(event.target)) closeDisclosure(disclosure);
});
// CSS preserves the focused navigation through viewport changes. Keep focus
// and the disclosure state until the visitor navigates, clicks outside or
// presses Escape, consistently with the native no-JS behavior.
