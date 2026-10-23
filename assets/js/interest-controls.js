const dialog = document.querySelector('[data-interest-dialog]');
if (dialog) {
  const form = dialog.querySelector('[data-interest-form]');
  const status = dialog.querySelector('[data-interest-status]');
  const submit = form.querySelector('[type=submit]');
  const feature = form.elements.featureId;
  const endpoint = dialog.dataset.interestEndpoint;
  let opener, busy = false, config, configPromise, widget, challengePromise;
  let submissionId = null, submittedFields = null, draftActive = false, outcome = 'idle', retryAt = 0;
  const say = (text) => { status.textContent = text; };
  const uncertainMessage = 'We could not confirm that your feedback was saved. It may already have been received. Your text is still here. Sending the same feedback again uses the same reference.';
  const earlierUnconfirmed = ' Earlier feedback remains unconfirmed.';
  const draftValues = () => ({pageId:dialog.dataset.pageId,featureId:feature.value,intent:form.elements.intent.value,email:form.elements.email.value.trim(),comment:form.elements.comment.value.trim(),updatesConsent:form.elements.updatesConsent.checked,website:form.elements.website.value});
  const validFeature = (id) => [...feature.options].some(option => option.value === id);
  const requiredFields = () => {
    form.elements.email.required=form.elements.updatesConsent.checked;
    form.elements.comment.required=form.elements.intent.value!=='interested';
    dialog.querySelector('[data-interest-comment-label]').textContent=form.elements.comment.required?'(required)':'(optional)';
    dialog.querySelector('[data-interest-email-label]').textContent=form.elements.email.required?'(required for feature updates)':"(optional, if you'd like a reply)";
  };
  // Only finite status/code pairs from our endpoint prove this attempt was
  // rejected before a write. An intermediary, malformed body or lost receipt
  // cannot establish that, even if it reports a familiar HTTP status.
  function rejectionMessage(httpStatus, result) {
    if (!result || result.ok !== false || typeof result.code !== 'string') return null;
    const messages = {
      '400:invalid_submission': 'This attempt was rejected before saving. Review the selected feature, email and comment, then send again. Your text is still here.',
      '400:security_check_required': 'This attempt was rejected before saving. Complete the new security check, then send again. Your text is still here.',
      '403:security_check_failed': 'This attempt was rejected before saving. Complete the new security check, then send again. Your text is still here.',
      '403:origin_not_allowed': 'This attempt was rejected before saving because this website address is not supported. Reload the page at www.emtalk.org or email info@emtalk.org. Your text is still here.',
      '415:json_required': 'This attempt was rejected before saving because its format was not accepted. Reload this page or email info@emtalk.org. Your text is still here.',
      '429:too_many_requests': 'Too many attempts. This attempt was rejected before saving. Wait at least one minute before sending again. Your text is still here.',
    };
    return messages[httpStatus + ':' + result.code] || null;
  }
  async function responseResult(response) {
    if (Number(response.headers.get('Content-Length')) > 2048) throw Error('Response too large');
    const reader = response.body?.getReader();
    if (!reader) throw Error('Missing response');
    const chunks = []; let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2048) { await reader.cancel(); throw Error('Response too large'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const value of chunks) { bytes.set(value, offset); offset += value.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    } finally { reader.releaseLock(); }
  }
  function configuration() {
    if (!configPromise) configPromise = fetch(endpoint, {credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(10000)})
      .then(r => {if (!r.ok) throw Error('Unavailable'); return r.json();})
      .then(value => {if (value.enabled !== true || typeof value.sitekey !== 'string' || !value.sitekey) throw Error('Unavailable'); config = value; return value;})
      .catch(error => {configPromise = null; throw error;});
    return configPromise;
  }
  function challenge() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!challengePromise) challengePromise = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      const timer = setTimeout(() => {script.remove(); challengePromise=null; reject(Error('Challenge unavailable'));}, 12000);
      script.onload = () => {clearTimeout(timer); if (window.turnstile) resolve(window.turnstile); else {challengePromise=null;reject(Error('Challenge unavailable'));}};
      script.onerror = () => {clearTimeout(timer);script.remove();challengePromise=null;reject(Error('Challenge unavailable'));};
      document.head.append(script);
    });
    return challengePromise;
  }
  async function prepare() {
    try {
      await configuration();
      const turnstile = await challenge();
      if (widget === undefined) widget = turnstile.render(dialog.querySelector('[data-interest-challenge]'), {sitekey:config.sitekey, action:'interest', theme:'light'});
    } catch {
      if (!busy && outcome === 'idle') say('The feedback service is not available right now. This attempt has not been sent. Please try again later or email info@emtalk.org.');
    }
  }
  function open(trigger) {
    opener=trigger;
    // Reopening another entry must not silently relabel an unsent, pending or
    // unconfirmed draft. The user can explicitly change About after settlement.
    if (!busy && !draftActive && submissionId === null) {
      const selected=trigger.dataset.interestFeature || 'page';
      const next=validFeature(selected)?selected:'page';
      if (outcome==='saved' || feature.value!==next) {outcome='idle';say('');}
      feature.value=next;
    }
    if (!dialog.open) dialog.showModal();
    (busy ? dialog.querySelector('[data-interest-close]') : feature).focus({preventScroll:true});
    if (!busy && outcome !== 'uncertain') prepare();
  }
  document.addEventListener('click', event => {
    const trigger=event.target.closest('[data-interest-open]');
    if (trigger) {event.preventDefault();open(trigger);}
  });
  // Closing hides only this window. The bounded request continues, and neither
  // browser cancellation nor a timeout would undo a write already received.
  const close = () => dialog.close();
  dialog.querySelector('[data-interest-close]').addEventListener('click', close);
  dialog.addEventListener('close', () => {opener?.focus({preventScroll:true});});
  form.addEventListener('input', () => {
    if (busy) return;
    requiredFields();
    draftActive=true;
    if (outcome === 'uncertain') {
      say(JSON.stringify(draftValues()) === submittedFields ? uncertainMessage
        : 'Earlier feedback may already have been received. Your changes are kept here. Sending these changes creates a new submission.');
    } else if (outcome === 'saved' || outcome === 'rejected') {outcome='idle';say('');}
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (Date.now() < retryAt) {
      say('Please wait for the one-minute pause to finish, then send again. Your text is still here.' + (outcome==='uncertain' ? earlierUnconfirmed : ''));
      return;
    }
    const previousOutcome=outcome;
    let requestIssued=false;
    busy=true;draftActive=true;outcome='pending';submit.disabled=true;
    dialog.querySelector('[data-interest-pending-note]').hidden=false;
    for(const control of form.elements) if(control!==submit) control.disabled=true;
    say('Sending your feedback. You can close this window while we wait.');
    try {
      await configuration();
      const token=window.turnstile?.getResponse(widget);
      if (!token) {
        outcome=previousOutcome==='uncertain'?'uncertain':'idle';
        say(previousOutcome==='uncertain'?'Please complete the security check before retrying. Earlier delivery remains unconfirmed. Your text is still here.':'Please complete the security check, then send again.');return;
      }
      const values=draftValues(), signature=JSON.stringify(values);
      // Unchanged retries retain their reference. Explicitly edited content is
      // a new submission, never a different payload under the previous key.
      if (!submissionId || submittedFields !== signature) {
        let reference;
        try { if (typeof globalThis.crypto?.randomUUID === 'function') reference=globalThis.crypto.randomUUID(); } catch { /* No insecure reference fallback. */ }
        if (!reference) {
          outcome=previousOutcome==='uncertain'?'uncertain':'idle';
          say('This browser cannot create a secure feedback reference. Use an up-to-date browser over HTTPS or email info@emtalk.org. Your text is still here.' + (previousOutcome==='uncertain' ? earlierUnconfirmed : ''));
          return;
        }
        submissionId=reference;
      }
      submittedFields=signature;
      const payload={schemaVersion:1,submissionId,...values,privacyVersion:'interest-2026-10-23',turnstileToken:token};
      requestIssued=true;
      const response=await fetch(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
      const result=await responseResult(response);
      const rejected=rejectionMessage(response.status,result);
      if (rejected) {
        if (response.status===429) retryAt=Date.now()+60000;
        outcome=previousOutcome==='uncertain'?'uncertain':'rejected';
        say(rejected + (previousOutcome==='uncertain' ? earlierUnconfirmed : ''));
        return;
      }
      if (!response.ok || result.ok!==true || result.submissionId!==payload.submissionId) throw Error('Not confirmed');
      // Keep the last acknowledged reference outside form controls. Resetting
      // the draft, closing, or a later uncertain attempt must not erase it.
      dialog.querySelector('[data-interest-saved-reference]').textContent=payload.submissionId;
      dialog.querySelector('[data-interest-receipt]').hidden=false;
      form.reset();feature.value=payload.featureId;submissionId=null;submittedFields=null;draftActive=false;outcome='saved';
      requiredFields();
      say('Thank you. Your feedback has been saved.');
    } catch {
      outcome=requestIssued || previousOutcome==='uncertain'?'uncertain':'idle';
      say(outcome==='uncertain'?uncertainMessage:'This attempt could not be sent. Your text is still here. Please try again later or email info@emtalk.org.');
    }
    finally {busy=false;dialog.querySelector('[data-interest-pending-note]').hidden=true;submit.disabled=false;for(const control of form.elements)control.disabled=false;if(widget!==undefined)window.turnstile?.reset(widget);}
  });
}
