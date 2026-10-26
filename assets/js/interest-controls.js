import { createInterestMeasurement } from './analytics-events.js';
import { createInterestSecurity } from './interest-security.js';

const dialog = document.querySelector('[data-interest-dialog]');
function unavailableFeedback() {
  document.querySelectorAll('[data-interest-open],.interest-entry__features').forEach(node => {
    node.hidden = true; node.dataset.interestUnavailable = 'true';
  });
  document.querySelectorAll('.interest-entry').forEach(entry => {
    const note = document.createElement('p'), link = document.createElement('a');
    note.textContent = 'Feedback is unavailable here. ';
    link.href = 'mailto:info@emtalk.org'; link.textContent = 'Email EmTalk';
    note.append(link); entry.append(note);
  });
}
function initializeInterest(dialog) {
  const form = dialog.querySelector('[data-interest-form]');
  const status = dialog.querySelector('[data-interest-status]');
  const requiredNodes = ['data-interest-form', 'data-interest-status', 'data-interest-close', 'data-interest-comment-label',
    'data-interest-email-label', 'data-interest-pending-note', 'data-interest-receipt',
    'data-interest-saved-reference', 'data-interest-security', 'data-interest-challenge',
    'data-interest-security-status', 'data-interest-security-retry'];
  const requiredControls = ['featureId', 'intent', 'email', 'comment', 'updatesConsent', 'website'];
  const controlTags = {featureId: 'SELECT', intent: 'SELECT', email: 'INPUT',
    comment: 'TEXTAREA', updatesConsent: 'INPUT', website: 'INPUT'};
  const complete = form && form.tagName === 'FORM' && status && typeof dialog.showModal === 'function'
    && requiredNodes.every(name => dialog.querySelectorAll(`[${name}]`).length === 1)
    && requiredControls.every(name => {
      const controls = form.querySelectorAll(`[name="${name}"]`);
      return controls.length === 1 && [...form.elements].filter(control => control.name === name).length === 1
        && controls[0].tagName === controlTags[name]
        && form.elements.namedItem(name) === controls[0];
    })
    && form.elements.email.type === 'email' && form.elements.updatesConsent.type === 'checkbox'
    && (!form.elements.audience || (form.elements.audience.tagName === 'SELECT'
      && form.querySelectorAll('[name="audience"]').length === 1
      && [...form.elements].filter(control => control.name === 'audience').length === 1
      && form.elements.namedItem('audience') === form.querySelector('[name="audience"]')))
    && form.querySelectorAll('[type="submit"]').length === 1
    && form.querySelectorAll('button[type="submit"]').length === 1;
  if (!complete) {
    // Fail before binding open/submit handlers or creating the measurement port.
    // Keep the native contact route usable if a co-owned template drifts.
    unavailableFeedback();
    return;
  }
  const measurement = createInterestMeasurement();
  const submit = form.querySelector('[type=submit]');
  const feature = form.elements.featureId;
  const audience = form.elements.audience;
  const endpoint = dialog.dataset.interestEndpoint;
  let opener, busy = false, configPromise;
  let submissionId = null, submittedFields = null, draftActive = false, outcome = 'idle', retryAt = 0;
  const say = (text) => { status.textContent = text; };
  const uncertainMessage = 'We could not confirm that your feedback was saved. It may already have been received. Your text is still here. Sending the same feedback again uses the same reference.';
  const earlierUnconfirmed = ' Earlier feedback remains unconfirmed.';
  const draftValues = () => ({pageId:dialog.dataset.pageId,featureId:feature.value,audience:audience?.value || dialog.dataset.interestDefaultAudience,intent:form.elements.intent.value,email:form.elements.email.value.trim(),comment:form.elements.comment.value.trim(),updatesConsent:form.elements.updatesConsent.checked,website:form.elements.website.value});
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
  function rejectionMessage(httpStatus, result, captchaMode) {
    if (!result || result.ok !== false || typeof result.code !== 'string') return null;
    const securityMessage = captchaMode === 'none'
      ? 'This attempt was rejected before saving because the feedback service configuration changed. Copy your text, then reload this page or email info@emtalk.org. Your text is still here.'
      : 'This attempt was rejected before saving. Complete the new security check, then send again. Your text is still here.';
    const messages = {
      '400:invalid_submission': 'This attempt was rejected before saving. Review the selected feature, email and comment, then send again. Your text is still here.',
      '400:security_check_required': securityMessage,
      '403:security_check_failed': securityMessage,
      '403:origin_not_allowed': 'This attempt was rejected before saving because this website address is not supported. Reload the page at www.emtalk.org or email info@emtalk.org. Your text is still here.',
      '415:json_required': 'This attempt was rejected before saving because its format was not accepted. Reload this page or email info@emtalk.org. Your text is still here.',
      '429:too_many_requests': 'Too many attempts. This attempt was rejected before saving. Wait at least one minute before sending again. Your text is still here.',
    };
    return messages[httpStatus + ':' + result.code] || null;
  }
  // Every endpoint outcome requires a bounded JSON receipt. A bodyless/opaque
  // response (including204) cannot identify the saved reference and audience,
  // nor prove a rejection before saving. After dispatch it remains unconfirmed,
  // even with a familiar HTTP status; an unchanged retry keeps the same UUID.
  // Only a matching JSON acknowledgement may render Saved, never status alone.
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
  // Keep the deadline active through response-body parsing and clear it on
  // settlement. This works without the newer AbortSignal.timeout convenience.
  function requestDeadline(milliseconds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    return {signal:controller.signal, dispose:() => clearTimeout(timer)};
  }
  function configuration() {
    if (!configPromise) {
      configPromise = (async () => {
        const deadline = requestDeadline(10000);
        try {
          const response = await fetch(endpoint, {
            credentials:'omit', cache:'no-store', signal:deadline.signal,
          });
          if (!response.ok) throw Error('Unavailable');
          const value = await response.json();
          const captchaMode = value.captchaMode === undefined ? 'turnstile' : value.captchaMode;
          if (value.enabled !== true || !['none', 'turnstile'].includes(captchaMode)
              || (captchaMode === 'turnstile' && (typeof value.sitekey !== 'string' || !value.sitekey))) throw Error('Unavailable');
          return {...value, captchaMode};
        } finally { deadline.dispose(); }
      })().catch(error => {configPromise = null; throw error;});
    }
    return configPromise;
  }
  const security = createInterestSecurity(dialog, configuration);
  function setIdle(message = '') {
    outcome = 'idle';
    say(message);
  }
  function setUncertain() {
    outcome = 'uncertain';
    say(uncertainMessage);
  }
  function preserveEarlierAttempt(previousOutcome, message) {
    outcome = previousOutcome === 'uncertain' ? 'uncertain' : 'idle';
    say(message);
  }
  function setRejected(previousOutcome, httpStatus, message, attemptMeasurement) {
    attemptMeasurement.rejected();
    if (httpStatus === 429) retryAt = Date.now() + 60000;
    outcome = previousOutcome === 'uncertain' ? 'uncertain' : 'rejected';
    say(message + (previousOutcome === 'uncertain' ? earlierUnconfirmed : ''));
  }
  function setSaved(payload, attemptMeasurement) {
    attemptMeasurement.saved();
    // Keep the last acknowledged reference outside form controls. Resetting
    // the draft, closing, or a later uncertain attempt must not erase it.
    dialog.querySelector('[data-interest-saved-reference]').textContent = payload.submissionId;
    dialog.querySelector('[data-interest-receipt]').hidden = false;
    form.reset();
    feature.value = payload.featureId;
    submissionId = null;
    submittedFields = null;
    draftActive = false;
    outcome = 'saved';
    requiredFields();
    say('Thank you. Your feedback has been saved.');
  }
  function settleFailure(requestIssued, previousOutcome, attemptMeasurement) {
    if (requestIssued) attemptMeasurement?.unconfirmed();
    if (requestIssued || previousOutcome === 'uncertain') setUncertain();
    else setIdle('This attempt could not be sent. Your text is still here. Please try again later or email info@emtalk.org.');
  }
  function lockDispatch() {
    const previousOutcome = outcome;
    busy = true;
    draftActive = true;
    outcome = 'pending';
    submit.disabled = true;
    dialog.querySelector('[data-interest-pending-note]').hidden = true;
    for (const control of form.elements) if (control !== submit) control.disabled = true;
    security.setBusy(true);
    say('Preparing your feedback. Your text is kept here.' + (previousOutcome === 'uncertain' ? earlierUnconfirmed : ''));
    return previousOutcome;
  }
  function unlockDispatch(requestIssued, challengeRequired) {
    busy = false;
    dialog.querySelector('[data-interest-pending-note]').hidden = true;
    submit.disabled = false;
    for (const control of form.elements) control.disabled = false;
    security.setBusy(false);
    if (requestIssued && challengeRequired) security.finishAttempt(true);
  }
  function preparePayload(token, previousOutcome) {
    const values = draftValues(), signature = JSON.stringify(values);
    // Unchanged retries retain their reference. Explicitly edited content is
    // a new submission, never a different payload under the previous key.
    if (!submissionId || submittedFields !== signature) {
      let reference;
      try {
        if (typeof globalThis.crypto?.randomUUID === 'function') reference = globalThis.crypto.randomUUID();
      } catch { /* No insecure reference fallback. */ }
      if (!reference) {
        preserveEarlierAttempt(previousOutcome, 'This browser cannot create a secure feedback reference. Use an up-to-date browser over HTTPS or email info@emtalk.org. Your text is still here.' + (previousOutcome === 'uncertain' ? earlierUnconfirmed : ''));
        return null;
      }
      submissionId = reference;
      measurement.newSubmission();
    }
    submittedFields = signature;
    return {schemaVersion:1,submissionId,...values,privacyVersion:'interest-2026-10-23',
      ...(token ? {turnstileToken:token} : {})};
  }
  function matchingReceipt(response, result, payload) {
    return response.ok && result?.ok === true
      && result.submissionId === payload.submissionId && result.audience === payload.audience;
  }
  function open(trigger) {
    opener=trigger;
    // Reopening another entry must not silently relabel an unsent, pending or
    // unconfirmed draft. The user can explicitly change About after settlement.
    if (!busy && !draftActive && submissionId === null) {
      const selected=trigger.dataset.interestFeature || 'page';
      const next=validFeature(selected)?selected:'page';
      if (outcome==='saved' || feature.value!==next) setIdle();
      feature.value=next;
      if (audience) {
        const preset=trigger.dataset.interestAudience || dialog.dataset.interestDefaultAudience;
        audience.value=[...audience.options].some(option => option.value===preset) ? preset : dialog.dataset.interestDefaultAudience;
      }
    }
    if (!dialog.open) {
      dialog.showModal();
      const surface = trigger.closest('.interest-entry') ? 'footer' : trigger.closest('.news-main') ? 'news_cta' : trigger.closest('.dm-workspace,.bret-practice') ? 'tool_exit' : trigger.hasAttribute('data-tapl-interest') ? 'feature_prompt' : 'page_prompt';
      measurement.opened(surface);
    }
    (busy ? dialog.querySelector('[data-interest-close]') : feature).focus({preventScroll:true});
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
    } else if (outcome === 'saved' || outcome === 'rejected') setIdle();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (Date.now() < retryAt) {
      say('Please wait for the one-minute pause to finish, then send again. Your text is still here.' + (outcome==='uncertain' ? earlierUnconfirmed : ''));
      return;
    }
    // A server-selected CAPTCHA-free form sends on this explicit action.
    // Turnstile mode still needs another explicit Send after its check finishes.
    // Lock before the bounded config request so concurrent clicks cannot dispatch
    // twice; fields become editable again while an optional widget is running.
    const previousOutcome=lockDispatch();
    let requestIssued=false, challengeRequired=false, needsChallenge=false, attemptMeasurement, deadline;
    try {
      const config = await configuration();
      challengeRequired = config.captchaMode === 'turnstile';
      const token = challengeRequired ? security.token() : '';
      if (challengeRequired && !token) {
        needsChallenge = true;
        preserveEarlierAttempt(previousOutcome, previousOutcome==='uncertain'?'Choose Retry security check if the check is missing or expired, complete it, then send again. Earlier delivery remains unconfirmed. Your text is still here.':'Choose Retry security check if the check is missing or expired, complete it, then send again. Your text is still here.');
        return;
      }
      const payload=preparePayload(token, previousOutcome);
      if (!payload) return;
      deadline=requestDeadline(20000);
      const requestOptions={method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:deadline.signal};
      requestIssued=true;
      dialog.querySelector('[data-interest-pending-note]').hidden=false;
      say('Sending your feedback. You can close this window while we wait.');
      attemptMeasurement=measurement.attempt();
      const response=await fetch(endpoint,requestOptions);
      const result=await responseResult(response);
      const rejected=rejectionMessage(response.status,result,config.captchaMode);
      if (rejected) {
        setRejected(previousOutcome, response.status, rejected, attemptMeasurement);
        return;
      }
      if (!matchingReceipt(response, result, payload)) throw Error('Not confirmed');
      setSaved(payload, attemptMeasurement);
    } catch {
      settleFailure(requestIssued, previousOutcome, attemptMeasurement);
    }
    finally {
      deadline?.dispose();
      unlockDispatch(requestIssued, challengeRequired);
      if (needsChallenge) void security.prepare();
    }
  });
}
if (dialog) initializeInterest(dialog);
else unavailableFeedback();
