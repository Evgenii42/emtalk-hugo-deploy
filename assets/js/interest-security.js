// Widget lifecycle only. Delivery outcomes, drafts and submission references
// belong to the form controller; security callbacks never write that status.
export function createInterestSecurity(dialog, configuration) {
  const container = dialog.querySelector('[data-interest-challenge]');
  const notice = dialog.querySelector('[data-interest-security-status]');
  const retry = dialog.querySelector('[data-interest-security-retry]');
  const panel = dialog.querySelector('[data-interest-security]');
  let widget, task, scriptPromise, state = 'idle', busy = false, generation = 0;
  const messages = {
    loading: 'Loading the security check. Complete it, then choose Send feedback.',
    waiting: 'Complete the security check below, then choose Send feedback. If it does not appear, choose Retry security check.',
    ready: 'Security check complete. Choose Send feedback to send your message.',
    failed: 'The security check could not finish. Retry the security check, or use an up-to-date browser. Your draft is unchanged.',
    expired: 'The security check expired. Retry the security check before sending. Your draft is unchanged.',
    timeout: 'The security check timed out. Retry the security check before sending. Your draft is unchanged.',
    unsupported: 'This browser could not run the security check. Try an up-to-date browser, or email info@emtalk.org.',
    unavailable: 'The feedback service or security check is unavailable. Retry later, or email info@emtalk.org. Your draft is unchanged.',
    needed: 'Complete a new security check before sending again. Choose Retry security check.',
  };
  function show(next) {
    state = next;
    notice.textContent = messages[next] || '';
    retry.hidden = next === 'idle';
    retry.disabled = busy || next === 'loading';
    container.setAttribute('aria-busy', String(next === 'loading'));
  }
  function discard() {
    generation++;
    task = null;
    if (widget !== undefined) {
      try { window.turnstile?.remove(widget); } catch { /* Old callbacks are invalidated regardless. */ }
      widget = undefined;
    }
    container.replaceChildren();
  }
  function loadScript() {
    if (typeof window.turnstile?.render === 'function') return Promise.resolve(window.turnstile);
    if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) { script.remove(); scriptPromise = null; reject(error); }
        else resolve(window.turnstile);
      };
      const timer = setTimeout(() => finish(Error('Security script unavailable')), 12000);
      script.onload = () => finish(typeof window.turnstile?.render === 'function' ? null : Error('Security script unavailable'));
      script.onerror = () => finish(Error('Security script unavailable'));
      document.head.append(script);
    });
    return scriptPromise;
  }
  function prepare(manual = false) {
    panel.hidden = false;
    if (busy || task) return task;
    // Closing/reopening must not create a hidden retry loop after a failure.
    if (!manual && state !== 'idle') return Promise.resolve();
    discard();
    const current = generation;
    show('loading');
    const pending = Promise.resolve().then(async () => {
      try {
        const config = await configuration();
        const turnstile = await loadScript();
        if (current !== generation) return;
        let terminal = false;
        const change = (next, stop = false) => {
          if (current !== generation || terminal) return;
          if (stop) terminal = true;
          show(next);
        };
        widget = turnstile.render(container, {
          sitekey: config.sitekey, action: 'interest', theme: 'light', size: 'compact',
          retry: 'never', 'refresh-expired': 'never', 'refresh-timeout': 'never',
          'response-field': false,
          callback: () => change('ready'),
          'before-interactive-callback': () => change('waiting'),
          'error-callback': () => { change('failed', true); return true; },
          'expired-callback': () => change('expired', true),
          'timeout-callback': () => change('timeout', true),
          'unsupported-callback': () => change('unsupported', true),
        });
        if (state === 'loading') show('waiting');
      } catch {
        if (current === generation) show('unavailable');
      } finally {
        if (task === pending) task = null;
      }
    });
    task = pending;
    return task;
  }
  retry.addEventListener('click', () => { if (!busy) void prepare(true); });
  return {
    prepare: () => prepare(),
    setBusy(value) { busy = value; retry.disabled = busy || state === 'loading'; },
    token() {
      if (state !== 'ready' || widget === undefined) return '';
      try {
        const response = window.turnstile?.getResponse(widget) || '';
        if (!response) show('needed');
        return response;
      }
      catch { show('failed'); return ''; }
    },
    finishAttempt(requestIssued) {
      // A submitted proof is single-use. Do not silently start another check.
      const next = !requestIssued && ['failed','expired','timeout','unsupported','unavailable'].includes(state) ? state : 'needed';
      discard();
      show(next);
    },
  };
}
