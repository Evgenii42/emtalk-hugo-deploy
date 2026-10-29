import { emitInterfaceEvent, analyticsEpoch } from './analytics-events.js';
// Source-derived test controller. API scoring is independent; no local scoring assumptions.
const initializedLayouts = new WeakSet();

// Shared by model validation and the runtime's unexpected initialization failure boundary.
export function failTestInitialization(layout = document.querySelector('.test-layout')) {
  if (!layout) return;
  if (!layout.previousElementSibling?.classList.contains('test-initialization-error')) {
    var error = document.createElement('p');
    error.className = 'test-initialization-error';
    error.setAttribute('role', 'alert');
    error.textContent = 'Interactive answering and result calculation could not start. You can read all questions below, reload the page or choose another test.';
    layout.before(error);
  }
  layout.inert = false;
  layout.hidden = false;
  layout.style.removeProperty('display');
  layout.dataset.testReady = 'invalid';
  const experience = layout.closest('.tests-experience');
  if (experience) experience.dataset.testReady = 'invalid';
  for (const slide of layout.querySelectorAll('.question-slide')) {
    slide.style.removeProperty('display');
    slide.inert = false;
    slide.removeAttribute('aria-hidden');
    for (const option of slide.querySelectorAll('.answer-option')) {
      for (const name of ['role','tabindex','aria-checked']) option.removeAttribute(name);
    }
    const list = slide.querySelector('.collection-list-3');
    if (list) list.removeAttribute('role');
  }
  var start = document.querySelector('.tests-start');
  if (start) start.hidden = true;
  var loader = document.querySelector('.load-screen');
  if (loader) loader.style.display = 'none';
  var requestStatus = document.querySelector('.tests-request-status');
  if (requestStatus) requestStatus.textContent = '';
}

export function initTests() {
  'use strict';

  var testModel;
  try {
    testModel = JSON.parse(document.querySelector('#emtalk-test-model')?.textContent || 'null');
  } catch { testModel = null; }
  // This audited source endpoint is fixed, not a CMS-body override.
  var API_URL = 'https://api-web.emtalk.org/v1/tests';
  var slug = testModel?.slug;
  var apiTitles = {
    'social-phobia-inventory-spin': 'spin',
    'maslach-burnout-inventory': 'maslach',
    'mobbing-test': 'mobbing',
    'spielberger-state-trait-anxiety-inventory': 'spielberger',
    'motivation-test-by-gerchikov': 'gerchikov'
  };
  var layout = document.querySelector('.test-layout');
  var slides = Array.from((layout || document).querySelectorAll('.question-slide'));
  var next = (layout || document).querySelector('.nav-next');
  var prev = (layout || document).querySelector('.nav-prev');
  var nextLabel = next?.querySelector('.tests-next-label');
  var nextArrow = next?.querySelector('.tests-next-arrow');
  var bar = layout?.querySelector(':scope > .progress-bar');
  var progress = bar?.querySelector('.progress-fill');
  var loader = document.querySelector('.load-screen');
  var requestStatus = document.querySelector('.tests-request-status');
  var result = document.querySelector('.result-screen');
  var consentPanel = layout?.querySelector('[data-result-consent]');
  var consentCheck = consentPanel?.querySelector('[data-result-consent-check]');
  var selected = new Map();
  var current = 0;
  var submitting = false;
  // Factual work-start survives consent changes; telemetry latches do not. No
  // answer, test identity, result or run identifier is sent or persisted here.
  var workStarted = false;
  var measuredEpoch = null;
  var measuredRun = false;
  var measuredOutcome = false;
  function disarmMeasurement() { measuredRun = false; measuredEpoch = null; measuredOutcome = false; }
  window.addEventListener('emtalk:analytics-availability', disarmMeasurement);
  window.addEventListener('pagehide', disarmMeasurement);
  function measurementActive(epoch = measuredEpoch) {
    return measuredRun && epoch !== null && epoch === measuredEpoch && analyticsEpoch() === epoch;
  }
  function measure(state, error_kind = 'not_applicable', epoch = measuredEpoch) {
    return measurementActive(epoch) && emitInterfaceEvent('emtalk_assessment_state', {state, error_kind});
  }
  function startMeasurement() {
    if (workStarted) return;
    workStarted = true;
    measuredEpoch = analyticsEpoch();
    measuredRun = measuredEpoch !== null;
    if (!measure('started')) disarmMeasurement();
  }

  if (!layout || initializedLayouts.has(layout)) return;
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!slides.length || !next || !prev || !nextLabel || !nextArrow || !loader || !requestStatus || !result || !consentPanel || !consentCheck || consentCheck.type !== 'checkbox' || !testModel || testModel.apiEndpoint !== API_URL || testModel.apiTitle !== apiTitles[slug] || !Array.isArray(testModel.questions) || testModel.questions.length !== slides.length) {
    failTestInitialization(layout);
    throw new Error('Invalid test model');
  }

  if (loader) {
    loader.classList.add('et-star-loader');
    loader.innerHTML = '<div class="et-star-loader__sky" aria-hidden="true">' +
      '<span class="et-star-loader__star" style="--x:9%;--size:3px;--duration:5.8s;--delay:-1.2s"></span>' +
      '<span class="et-star-loader__star" style="--x:23%;--size:5px;--duration:7.1s;--delay:-5.1s"></span>' +
      '<span class="et-star-loader__star" style="--x:38%;--size:3px;--duration:6.4s;--delay:-3.6s"></span>' +
      '<span class="et-star-loader__star" style="--x:54%;--size:4px;--duration:7.7s;--delay:-6.2s"></span>' +
      '<span class="et-star-loader__star" style="--x:68%;--size:3px;--duration:6.8s;--delay:-2.4s"></span>' +
      '<span class="et-star-loader__star" style="--x:81%;--size:5px;--duration:7.4s;--delay:-4.3s"></span>' +
      '<span class="et-star-loader__star" style="--x:92%;--size:3px;--duration:6.1s;--delay:-.7s"></span>' +
      '</div><div class="et-star-loader__content">' +
      '<div class="et-star-loader__mark">&#10022;</div>' +
      '<h2 class="et-star-loader__title">Requesting your result</h2>' +
      '<p class="et-star-loader__text">Your answers are being sent to the result service. If it does not respond within 30 seconds, you can try again. Keep this tab open.</p>' +
      '<div class="et-star-loader__track"><span class="et-star-loader__line"></span></div>' +
      '</div>';
  }

  // Hugo owns question/answer rendering. Validate its exact source-derived model
  // before enabling interaction; never silently repair mismatched test content.
  try {
    slides.forEach(function (slide, index) {
      var model = testModel.questions[index];
      if (model.number !== index + 1 || !['single','multiple'].includes(model.mode) || !Array.isArray(model.answers)) throw new Error('Invalid question model');
      slide.dataset.selectionMode = model.mode;
      slide.dataset.maxAnswers = model.maxAnswers == null ? '' : String(model.maxAnswers);
      var list = slide.querySelector('.collection-list-3');
      var existing = Array.from(slide.querySelectorAll('.answer-option'));
      if (!list || existing.length !== model.answers.length || !existing.length ||
          typeof model.question !== 'string' || slide.querySelector('.test-question-title')?.textContent.trim() !== model.question.trim()) throw new Error('Question content mismatch');
      model.answers.forEach(function (answer, answerIndex) {
        if (answer.index !== answerIndex || typeof answer.text !== 'string') throw new Error('Invalid answer model');
        var existingText = existing[answerIndex].querySelector('.text-answer');
        if (!existingText || existingText.textContent !== answer.text) throw new Error('Answer content mismatch');
      });
    });
  } catch {
    failTestInitialization(layout);
    throw new Error('Test content does not match its model');
  }

  slides.forEach(function (slide, index) {
    slide.querySelectorAll('.answer-option').forEach(function (option) {
      option.setAttribute('role', isMulti(slide) ? 'checkbox' : 'radio');
    });
    var heading = slide.querySelector('.test-question-title');
    if (heading) {
      if (!heading.id) heading.id = 'emtalk-question-' + (index + 1);
      heading.tabIndex = -1;
      var list = slide.querySelector('.collection-list-3');
      if (list) { list.setAttribute('role', isMulti(slide) ? 'group' : 'radiogroup'); list.setAttribute('aria-labelledby', heading.id); }
    }
  });

  var count = document.querySelector('.test-question-count');
  if (count) count.textContent = String(slides.length);
  // A fresh document never inherits an affirmative processing choice from
  // browser form restoration. The active document keeps its own user work.
  consentCheck.checked = false;

  function selectionLimit(slide) {
    var multiple = slide.dataset.selectionMode === 'multiple';

    // Single choice always permits exactly one answer.
    if (!multiple) return 1;

    // For Multiple choice, apply Max answers only when the CMS field is filled.
    var limitText = (slide.dataset.maxAnswers || '').trim();
    if (/^\d+$/.test(limitText) && Number(limitText) > 0) return Number(limitText);

    // Empty Max answers means no selection limit for Multiple choice.
    return Infinity;
  }

  function isMulti(slide) {
    return slide.dataset.selectionMode === 'multiple';
  }

  function setDisabled(node, disabled) {
    if (!node) return;
    node.setAttribute('aria-disabled', String(disabled));
    if (node.tagName === 'BUTTON') node.disabled = disabled;
  }

  function paint(slide, slideIndex) {
    var chosen = selected.get(slideIndex) || new Set();
    var radioTabStop = chosen.size ? Array.from(chosen)[0] : 0;
    Array.from(slide.querySelectorAll('.answer-option')).forEach(function (option, answerIndex) {
      var active = chosen.has(answerIndex);
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-checked', String(active));
      option.setAttribute('tabindex', isMulti(slide) || answerIndex === radioTabStop ? '0' : '-1');
    });
  }
  function focusQuestion() {
    var heading = slides[current].querySelector('.test-question-title');
    heading?.focus({preventScroll:true});
    var bounds = layout.getBoundingClientRect();
    var headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
    if (bounds.top < Math.max(0, headerBottom) + 12 || bounds.bottom > innerHeight) {
      layout.scrollIntoView({behavior:reduceMotion.matches ? 'auto' : 'smooth', block:'start'});
    }
  }

  function update() {
    slides.forEach(function (slide, index) {
      slide.style.display = index === current ? 'block' : 'none';
      slide.setAttribute('aria-hidden', String(index !== current));
      slide.inert = index !== current;
      if (index === current) paint(slide, index);
    });
    var chosen = selected.get(current);
    var answered = Array.from(selected.values()).filter(function (set) { return set.size; }).length;
    var complete = answered === slides.length;
    var position = layout.querySelector('.tests-position');
    var answeredLabel = layout.querySelector('.tests-answered');
    var nextHint = layout.querySelector('.tests-next-hint');
    var positionText = 'Question ' + (current + 1) + ' of ' + slides.length;
    if (position && position.textContent !== positionText) position.textContent = positionText;
    if (answeredLabel) answeredLabel.textContent = answered + ' answered';
    if (nextLabel) nextLabel.textContent = current === slides.length - 1 ? (complete ? 'Get my result' : 'Next unanswered') : 'Next';
    if (nextArrow) nextArrow.hidden = current === slides.length - 1 && complete;
    var readyForResult = current === slides.length - 1 && complete;
    consentPanel.hidden = !readyForResult;
    if (nextHint) nextHint.textContent = chosen?.size ? (current === slides.length - 1 ? (complete ? (consentCheck.checked ? 'Ready to request your result.' : 'Read the processing notice and choose whether to send your answers.') : 'Answer the remaining questions first.') : 'You can change this answer.') : 'Choose an answer to continue.';
    layout.querySelectorAll('.tests-jump').forEach(function (button) {
      var index = Number(button.dataset.questionIndex);
      var hasAnswer = Boolean(selected.get(index)?.size);
      button.classList.toggle('is-answered', hasAnswer);
      button.setAttribute('aria-label', 'Question ' + (index + 1) + ', ' + (hasAnswer ? 'answered' : 'not answered'));
      if (index === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    layout.dataset.currentQuestion = String(current + 1);
    if (progress) progress.style.width = Math.round(answered / slides.length * 100) + '%';
    if (bar) {
      bar.setAttribute('role','progressbar');
      bar.setAttribute('aria-label','Questions answered');
      bar.setAttribute('aria-valuemin','0');
      bar.setAttribute('aria-valuemax',String(slides.length));
      bar.setAttribute('aria-valuenow',String(answered));
      bar.setAttribute('aria-valuetext',answered + ' of ' + slides.length + ' questions answered');
    }
    setDisabled(prev, current === 0 || submitting);
    setDisabled(next, !chosen || !chosen.size || submitting || (readyForResult && !consentCheck.checked));
  }

  function announceLimit(slide, limit) {
    var note = slide.querySelector('.et-answer-limit-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'et-answer-limit-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      var list = slide.querySelector('.collection-list-3');
      if (list) list.after(note); else slide.appendChild(note);
    }
    note.textContent = 'You can select up to ' + limit + ' answers.';
    clearTimeout(note._hideTimer);
    note._hideTimer = setTimeout(function () { note.textContent = ''; }, 3000);
  }

  function choose(option) {
    if (submitting || layout.dataset.testReady !== 'true') return;
    var slide = option.closest('.question-slide');
    var slideIndex = slides.indexOf(slide);
    var options = Array.from(slide.querySelectorAll('.answer-option'));
    var answerIndex = options.indexOf(option);
    if (slideIndex < 0 || answerIndex < 0) return;
    startMeasurement();
    if (isMulti(slide)) {
      var set = selected.get(slideIndex) || new Set();
      if (set.has(answerIndex)) {
        set.delete(answerIndex);
      } else if (set.size < selectionLimit(slide)) {
        set.add(answerIndex);
      } else {
        announceLimit(slide, selectionLimit(slide));
      }
      if (set.size) selected.set(slideIndex, set); else selected.delete(slideIndex);
    } else {
      selected.set(slideIndex, new Set([answerIndex]));
    }
    paint(slide, slideIndex);
    update();
  }

  layout.addEventListener('click', function (event) {
    var option = event.target.closest('.answer-option');
    if (option) choose(option);
  });

  layout.addEventListener('keydown', function (event) {
    var option = event.target.closest('.answer-option');
    if (option && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key) && option.getAttribute('role') === 'radio') {
      event.preventDefault();
      var options = Array.from(option.closest('.question-slide').querySelectorAll('.answer-option'));
      var position = options.indexOf(option);
      var target = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (position + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + options.length) % options.length;
      options[target].focus();
      choose(options[target]);
    } else if (option && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      choose(option);
    }
  });

  function payload() {
    return {
      language: document.documentElement.lang || 'en',
      title: testModel.apiTitle || apiTitles[slug] || slug,
      answers: slides.map(function (_, index) {
        return {
          question: index + 1,
          answers: Array.from(selected.get(index) || []).sort(function (a, b) { return a - b; })
        };
      })
    };
  }

  // Legacy result-service format: title, lead, optional tip title, then body lines.
  // A one-line response remains intact as the lead under a generic heading.
  // Finite structured score fields take precedence. Legacy "n out of m" copy
  // supplies a displayed pair only when a structured score is unavailable.
  // This is display parsing only; calculation remains entirely on the backend.
  function resultNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
  }

  function resultText(data) {
    if (typeof data?.result === 'string' && data.result.trim()) return data.result;
    return typeof data?.message === 'string' ? data.message : '';
  }

  function splitResult(value) {
    return String(value || '').replace(/\r/g, '').split(/\n+/).map(function (line) {
      return line.trim();
    }).filter(Boolean);
  }

  function render(data, error) {
    var lines = splitResult(resultText(data));
    var singleLine = lines.length === 1;
    var title = singleLine ? (error ? 'We could not calculate your result' : 'Your result is ready') : (lines.shift() || (error ? 'We could not calculate your result' : 'Your result is ready'));
    var lead = lines.shift() || '';
    var tipTitle = lines.shift() || '';
    var scoreMatch = [title, lead].join(' ').match(/(\d+)\s*(?:out of|\/)\s*(\d+)/i);
    var score = resultNumber(data?.score) ?? resultNumber(data?.totalScore);
    var total = resultNumber(data?.maxScore) ?? resultNumber(data?.total);
    if (score == null && scoreMatch) {
      score = scoreMatch[1];
      total = scoreMatch[2];
    }

    if (bar) bar.style.display = 'none';
    layout.style.display = 'none';
    if (loader) loader.style.display = 'none';
    if (result) result.style.display = 'block';

    var pageTitle = document.querySelector('.test-hero-title');
    var heading = document.querySelector('.test-results-heading');
    var scoreValue = document.querySelector('.test-score-value');
    var scoreTotal = document.querySelector('.test-score-total');
    var resultTitle = document.querySelector('.test-result-title');
    var resultLead = document.querySelector('.test-result-lead');
    var tipHeading = document.querySelector('.test-tip-title');
    var tipBody = document.querySelector('.test-tip-body');

    if (heading) heading.textContent = 'Your ' + (pageTitle ? pageTitle.textContent.trim() : 'Test') + ' Result';
    // A question count is not a score or a maximum. Show only supplied result values.
    var scoreContainer = document.querySelector('.test-results-score');
    var showScore = !error && score != null;
    if (scoreContainer) scoreContainer.hidden = !showScore;
    if (scoreValue) { scoreValue.hidden = !showScore; scoreValue.textContent = showScore ? String(score) : ''; }
    if (scoreTotal) { scoreTotal.hidden = !showScore; scoreTotal.textContent = !showScore ? '' : total == null ? 'Your score' : 'OUT OF ' + total; }
    if (resultTitle) resultTitle.textContent = title;
    if (resultLead) resultLead.textContent = lead;
    if (tipHeading) tipHeading.textContent = tipTitle;
    if (tipBody) {
      tipBody.textContent = '';
      lines.forEach(function (line) {
        var paragraph = document.createElement('p');
        paragraph.className = 'test-tip-paragraph';
        paragraph.textContent = line;
        tipBody.appendChild(paragraph);
      });
    }
    var tips = document.querySelector('.test-results-tips');
    if (tips) tips.style.display = tipTitle || lines.length ? 'block' : 'none';
    var retry = document.querySelector('.test-retry-button');
    var reviewAnswers = document.querySelector('.tests-review-answers');
    if (reviewAnswers) reviewAnswers.hidden = false;
    var email = document.querySelector('.tests-email');
    if (email) email.hidden = error;
    var perspective = document.querySelector('.tests-result-perspective');
    if (perspective) perspective.hidden = error;
    if (error) {
      if (heading) heading.textContent = 'Your answers are kept in this tab';
      if (resultTitle) resultTitle.textContent = 'We could not send your answers';
      var safeReasons = {
        connection: 'The result service could not be reached. Check your connection and try again. ',
        invalid_json: 'The result service returned an unreadable response. Please try again. ',
        response: 'The result service returned an incomplete response. Please try again. ',
        server: 'The result service could not complete this request' + (Number.isInteger(data.status) ? ' (' + data.status + ')' : '') + '. Please try again. '
      };
      if (resultLead) resultLead.textContent = (data.timeout ? 'The result service took too long. Please try again. ' : safeReasons[data.reason] || safeReasons.connection) + 'Keep this tab open so you will not need to retake the test.';
      if (tips) tips.style.display = 'none';
      if (retry) {
        retry.textContent = 'Try sending again';
        retry.dataset.action = 'resubmit';
      }
    } else if (retry) {
      retry.textContent = 'Take the test again';
      retry.dataset.action = 'reset';
    }
    if (result) {
      result.tabIndex = -1;
      result.focus({preventScroll:true});
      result.scrollIntoView({behavior:reduceMotion.matches ? 'auto' : 'smooth', block:'start'});
    }
  }

  async function submit() {
    if (submitting || layout.dataset.testReady !== 'true') return;
    // This function is also used by retry. Validate the local questionnaire
    // before recording or sending an attempt, not from result-screen visibility.
    if (slides.some(function (_, index) { return !selected.get(index)?.size; })) return;
    if (!consentCheck.checked) {
      if (result) result.style.display = 'none';
      layout.style.removeProperty('display');
      update();
      consentPanel.hidden = false;
      requestStatus.textContent = 'Your answers have not been sent. Choose whether to allow processing before requesting a result.';
      consentCheck.focus();
      return;
    }
    var attemptEpoch = measuredEpoch;
    measuredOutcome = false;
    var attemptMeasured = measure('submit_attempt', 'not_applicable', attemptEpoch);
    submitting = true;
    update();
    if (loader) loader.style.display = 'flex';
    layout.setAttribute('aria-busy','true');
    layout.inert = true;
    // This live region is always exposed and outside the inert questionnaire.
    // Mutate it when submitting; the visual loader itself is hidden from AT.
    requestStatus.textContent = 'Requesting your result. Your answers are being sent to the result service. If it does not respond within 30 seconds, you can try again. Keep this tab open.';
    var controller = new AbortController();
    // Observed real results can arrive after the source UI's 15-second cutoff.
    var timer = setTimeout(function () { controller.abort(); }, 30000);
    var failureReason = 'connection';
    var failureStatus;
    try {
      var response = await fetch(API_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: {'Content-Type':'application/json', 'Accept':'application/json'},
        body: JSON.stringify(payload()),
        signal: controller.signal
      });
      failureStatus = response.status;
      if (!response.ok) { failureReason = 'server'; throw new Error('Result service failed'); }
      failureReason = 'invalid_json';
      var data = await response.json();
      failureReason = 'response';
      if (!data || typeof data !== 'object' || Array.isArray(data) || (!resultText(data).trim() && (resultNumber(data.score) ?? resultNumber(data.totalScore)) == null)) {
        throw new Error('The result service returned an incomplete response.');
      }
      render(data, false);
      // Only validated data successfully accepted by the renderer is ready.
      if (attemptMeasured && !measuredOutcome) { measuredOutcome = true; measure('result_ready', 'not_applicable', attemptEpoch); }
    } catch (error) {
      render({timeout: error.name === 'AbortError', reason: failureReason, status: failureStatus}, true);
      if (attemptMeasured && !measuredOutcome) {
        measuredOutcome = true;
        measure('result_failed', error.name === 'AbortError' ? 'timeout' : failureReason === 'server' ? 'server' : ['response', 'invalid_json'].includes(failureReason) ? 'invalid_response' : 'network', attemptEpoch);
      }
    } finally {
      clearTimeout(timer);
      submitting = false;
      layout.removeAttribute('aria-busy');
      layout.inert = false;
      if (loader) loader.style.display = 'none';
      requestStatus.textContent = '';
    }
  }

  consentCheck.addEventListener('change', function () { update(); });

  if (next) next.addEventListener('click', function (event) {
    event.preventDefault();
    var chosen = selected.get(current);
    if (!chosen || !chosen.size || submitting) return;
    if (current < slides.length - 1) {
      current += 1;
      update();
      focusQuestion();
    } else if (slides.some(function (_, index) { return !selected.get(index)?.size; })) {
      // Overview navigation may jump ahead. Never submit an incomplete questionnaire.
      current = slides.findIndex(function (_, index) { return !selected.get(index)?.size; });
      update();
      focusQuestion();
    } else {
      submit();
    }
  });

  layout.querySelectorAll('.tests-jump').forEach(function (button) {
    button.addEventListener('click', function () {
      if (submitting) return;
      var target = Number(button.dataset.questionIndex);
      if (!Number.isInteger(target) || target < 0 || target >= slides.length) return;
      current = target;
      var overview = layout.querySelector('.tests-question-map');
      if (overview) overview.open = false;
      update();
      focusQuestion();
    });
  });

  if (prev) prev.addEventListener('click', function (event) {
    event.preventDefault();
    if (current > 0 && !submitting) {
      current -= 1;
      update();
      focusQuestion();
    }
  });

  var reviewAnswers = document.querySelector('.tests-review-answers');
  if (reviewAnswers) reviewAnswers.addEventListener('click', function () {
    if (submitting) return;
    if (result) result.style.display = 'none';
    if (bar) bar.style.removeProperty('display');
    layout.style.removeProperty('display');
    update();
    focusQuestion();
  });

  var retry = document.querySelector('.test-retry-button');
  if (retry) retry.addEventListener('click', function (event) {
    event.preventDefault();
    if (submitting) return;
    if (retry.dataset.action === 'resubmit') {
      if (result) result.style.display = 'none';
      submit();
      return;
    }
    measure('retake');
    disarmMeasurement();
    workStarted = false;
    consentCheck.checked = false;
    selected.clear();
    slides.forEach(paint);
    current = 0;
    if (result) result.style.display = 'none';
    if (bar) bar.style.removeProperty('display');
    layout.style.removeProperty('display');
    update();
    focusQuestion();
  });

  if (loader) loader.style.display = 'none';
  if (result) result.style.display = 'none';
  slides.forEach(paint);
  update();
  initializedLayouts.add(layout);
  layout.dataset.testReady = 'true';
  const experience = layout.closest('.tests-experience');
  if (experience) experience.dataset.testReady = 'true';
  document.querySelector('.tests-start')?.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (!submitting && !layout.hidden && !layout.inert && layout.dataset.testReady === 'true') startMeasurement();
  });
}
