// Independent of the game bundle so a failed game-module fetch has a recovery
// surface. This message is delayed; normal initialization shows no error flash.
export function initBretStartup(doc = document, host = window) {
  const root = doc.querySelector('[data-games-root]');
  const notice = root?.querySelector('[data-games-load-error]');
  if (!notice || root.dataset.gamesReady === 'true') return () => {};
  let timer;
  function stop() {
    host.clearTimeout(timer);
    root.removeEventListener('bret:ready', stop);
    root.removeEventListener('bret:failed', stop);
    doc.removeEventListener('error', resourceFailed, true);
  }
  function show() {
    if (root.dataset.gamesReady !== 'true') notice.hidden = false;
    stop();
  }
  function resourceFailed(event) {
    if (event.target?.matches?.('script[data-bret-games-module]')) show();
  }
  root.addEventListener('bret:ready', stop);
  root.addEventListener('bret:failed', stop);
  doc.addEventListener('error', resourceFailed, true);
  timer = host.setTimeout(show, 8000);
  return stop;
}

if (typeof document !== 'undefined') initBretStartup();
