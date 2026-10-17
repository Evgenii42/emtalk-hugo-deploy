import { initMenus } from './menu.js';
import { initAnimations } from './animations.js';
import { initPlayers } from './player.js';
import { initTests, failTestInitialization } from './tests.js';
import { initScroll } from './scroll.js';

function start() {
  document.documentElement.classList.add('emt-js');
  const routeId = document.documentElement.dataset.routeId || location.pathname;
  if (routeId !== '/' && routeId !== '') document.documentElement.classList.add('emt-inner-page');
  const status = {};
  for (const [name, init] of Object.entries({ menus: initMenus, animations: initAnimations, players: initPlayers, tests: initTests, scroll: initScroll })) {
    try { init(); status[name] = 'ready'; }
    catch {
      status[name] = 'failed';
      if (name === 'tests') failTestInitialization();
      console.error(`EmTalk ${name} controller could not initialize`);
      document.dispatchEvent(new CustomEvent('emtalk:initerror', { detail: { controller: name } }));
    }
  }
  document.documentElement.dataset.emtalkControllers = JSON.stringify(status);
  document.documentElement.dataset.emtalkRuntimeStatus = Object.values(status).includes('failed') ? 'degraded' : 'ready';
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
    if (!event.target.closest('#back-button')) return;
    event.preventDefault();
    if (history.length > 1) history.back();
    else {
      const prefix = (document.documentElement.dataset.mountPrefix || '').replace(/\/+$/, '');
      location.href = document.documentElement.dataset.articlesUrl || `${prefix}/articles`;
    }
  });
  document.documentElement.dataset.emtalkReady = 'true';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
