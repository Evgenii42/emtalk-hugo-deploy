// This finite story uses prepared examples. No storage, telemetry or network calls.
const landing = document.querySelector('[data-tapl-landing]');
if (landing) {
  const quest = landing.querySelector('[data-tapl-quest]');
  const all = selector => [...(quest?.querySelectorAll(selector) || [])];
  const one = selector => quest?.querySelector(selector);
  const chapters = all('[data-tapl-chapter]');
  const headings = chapters.map(chapter => chapter.querySelector('h3'));
  const storyTitleKeys = Object.freeze({
    personal: 'taplPersonalTitle', business: 'taplBusinessTitle', partner: 'taplPartnerTitle'
  });
  const validHeadingTitles = headings.every(heading => heading &&
    Object.values(storyTitleKeys).every(key => typeof heading.dataset[key] === 'string' && heading.dataset[key].trim()));
  const indicators = all('[data-tapl-step-indicator]');
  const position = one('[data-tapl-quest-position]');
  const back = one('[data-tapl-back]'), next = one('[data-tapl-next]'), restart = one('[data-tapl-restart]');
  const complete = one('[data-tapl-complete]'), task = one('[data-tapl-movable-task]'), interest = one('[data-tapl-interest]');
  const interestLabel = interest?.querySelector('[data-tapl-interest-label]');
  const interestArrow = interest?.querySelector('[data-tapl-interest-arrow]');
  const mobileUpcoming = landing.querySelector('[data-tapl-mobile-upcoming]');
  const roleButtons = all('[data-tapl-audience]');
  const roleOptions = new Map(roleButtons.filter(button => button.dataset.taplFeature).map(button => [button.dataset.taplAudience,
    {feature:button.dataset.taplFeature, action:button.dataset.taplActionLabel, label:button.dataset.taplLabel}]));
  const daySlots = new Map(all('[data-tapl-day]').map(slot => [slot.dataset.taplDay, slot]));
  const programs = all('[data-tapl-goal-program]');
  const goalButtons = all('[data-tapl-goal-choice]');
  const weekButtons = all('[data-tapl-week-choice]');
  const readText = (parent, selector) => parent.querySelector(selector)?.textContent.trim();
  const examples = new Map(programs.map(program => [program.dataset.taplGoalProgram, {
    element:program, label:program.dataset.taplGoalLabel,
    weeks:new Map([...program.querySelectorAll('[data-tapl-program-week]')].map(week => [week.dataset.taplProgramWeek, {
      tasks:[...week.querySelectorAll('[data-tapl-goal-task]')].map(node => node.textContent.trim()),
      notes:[...week.querySelectorAll('[data-tapl-goal-task-note]')].map(node => node.textContent.trim()),
      actors:[...week.querySelectorAll('[data-tapl-task-actor-source]')].map(node => node.textContent.trim())
    }])),
    metric:readText(program,'[data-tapl-goal-metric]'), summary:readText(program,'[data-tapl-goal-summary]'),
    milestones:[...program.querySelectorAll('[data-tapl-phase-source]')].map(node => node.textContent.trim()),
    support:readText(program,'[data-tapl-support-source]'),
    smaller:readText(program,'[data-tapl-smaller-task-source]'), smallerNote:readText(program,'[data-tapl-smaller-note-source]')
  }]));
  const requiredExamples = ['running','language','weight','time','business','partner'];
  const validExamples = examples.size === 6 && programs.length === 6 && goalButtons.length === 4 &&
    requiredExamples.every(key => examples.has(key)) &&
    requiredExamples.slice(0,4).every(key => goalButtons.some(button => button.dataset.taplGoalChoice === key)) && [...examples.entries()].every(([exampleKey, example]) =>
      example.label && example.metric && example.summary && example.support && example.smaller && example.smallerNote &&
      example.milestones.length === 3 && example.milestones.every(Boolean) && ['1','2'].every(key => {
        const week = example.weeks.get(key);
        return week?.tasks.length === 3 && week.notes.length === 3 && week.tasks.every(Boolean) && week.notes.every(Boolean) &&
          week.actors.length === (['business','partner'].includes(exampleKey) ? 3 : 0) && week.actors.every(Boolean);
      }));
  const outputSelectors = ['[data-tapl-selection-status]','[data-tapl-support-panel]','[data-tapl-support-instruction]','[data-tapl-original-step]','[data-tapl-goal-selection]','[data-tapl-story-selection]','[data-tapl-selected-week-label]',
    '[data-tapl-monday-status]','[data-tapl-completed-count]','[data-tapl-moved-count]',
    '[data-tapl-week-note]','[data-tapl-support-copy]','[data-tapl-smaller-explanation]','[data-tapl-generated-task]',
    '[data-tapl-generated-note]','[data-tapl-preparation-status]','[data-tapl-goal-milestone-view]',
    '[data-tapl-goal-metric-view]','[data-tapl-goal-summary-view]','[data-tapl-recap]','[data-tapl-suggestion-status]',
    '[data-tapl-clear-audience]','[data-tapl-less-time]','[data-tapl-preview-adjusted]','[data-tapl-show-generated]',
    '[data-tapl-use-generated]','[data-tapl-celebration]','[data-tapl-celebrate]','[data-tapl-celebration-status]','#tapl-generated-step'];
  // Hero lives outside the quest. Guard both ordered slots before any DOM mutation.
  const validHero = ['task','note','actor','when'].every(key => {
    const nodes = [...landing.querySelectorAll('[data-tapl-hero-' + key + ']')];
    return nodes.length === 2 && nodes.every((node,index) => node.getAttribute('data-tapl-hero-' + key) === String(index));
  }) && landing.querySelectorAll('[data-tapl-hero-context]').length === 1;
  const validOutputs = validHero && outputSelectors.every(selector => all(selector).length === 1) &&
    ['[data-tapl-task-text]','[data-tapl-task-note]','[data-tapl-task-actor]','[data-tapl-milestone-phase]'].every(selector => all(selector).length === 3);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  // Keep the activated choice focused for every input method. CSS :focus-visible
  // decides ring visibility; no click metadata is used to infer input origin.
  const focusChoice = event => event.currentTarget.focus({preventScroll:true});
  // MediaQueryList.matches is live. Clear in-flight classes when motion is reduced
  // so allowing motion again cannot restart a stale chapter/reveal/celebration.
  reduceMotion.addEventListener('change', event => {
    if (event.matches) landing.querySelectorAll('.tapl-entering,.tapl-revealing,.tapl-celebration--active').forEach(node => {
      node.classList.remove('tapl-entering','tapl-revealing','tapl-celebration--active');
    });
  });
  const plainAnchor = event => !event.defaultPrevented && event.button === 0 &&
    !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  if (quest && validExamples && validOutputs && chapters.length === 5 && validHeadingTitles && indicators.length === 5 &&
      position && back && next && restart && complete && task && interest &&
      interestLabel && interestArrow && interestArrow.getAttribute('aria-hidden') === 'true' &&
      interest.querySelectorAll('[data-tapl-interest-label]').length === 1 && interest.querySelectorAll('[data-tapl-interest-arrow]').length === 1 &&
      mobileUpcoming && landing.querySelectorAll('[data-tapl-mobile-upcoming]').length === 1 && roleOptions.size === 3 &&
      daySlots.has('wednesday') && daySlots.has('thursday') && weekButtons.length === 2 &&
      chapters.every((chapter,index) => chapter.dataset.taplChapter === String(index))) {
    let current = 0, audience = 'unspecified', selectedGoal = 'language', selectedWeek = '1';
    let weekState = {'1':{day:'wednesday',complete:false}, '2':{day:'wednesday',complete:false}};
    let lessTime = false, smallerWeek2 = false;
    const sample = () => weekState[selectedWeek];
    const story = () => audience === 'business' || audience === 'partner' ? audience : 'personal';
    const example = () => examples.get(story() === 'personal' ? selectedGoal : story());
    const celebration = one('[data-tapl-celebration]');
    const clearCelebration = () => {
      celebration.classList.remove('tapl-celebration--active');
      one('[data-tapl-celebration-status]').textContent = "The planned experience would recognize meaningful milestones and help you choose what comes next. Here, you can celebrate exploring this sample story.";
    };
    const announce = message => { one('[data-tapl-selection-status]').textContent = message; };
    const setGeneratedVisible = visible => {
      one('#tapl-generated-step').hidden = !visible;
      for (const selector of ['[data-tapl-preview-adjusted]','[data-tapl-show-generated]']) one(selector).setAttribute('aria-expanded',String(visible));
    };
    const resetWeeks = () => {
      selectedWeek = '1'; lessTime = false; smallerWeek2 = false;
      weekState = {'1':{day:'wednesday',complete:false}, '2':{day:'wednesday',complete:false}};
      one('[data-tapl-suggestion-status]').textContent = '';
      one('[data-tapl-less-time]').setAttribute('aria-pressed','false');
      setGeneratedVisible(false);
      clearCelebration();
    };
    const renderStory = (activeStory, activeExample) => {
      all('[data-tapl-story]').forEach(node => {
        node.hidden = node.dataset.taplStory !== activeStory;
      });
      headings.forEach(heading => {
        heading.textContent = heading.dataset[storyTitleKeys[activeStory]];
      });
      roleButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.taplAudience === audience)));
      programs.forEach(program => { program.hidden = program !== activeExample.element; });
      goalButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.taplGoalChoice === selectedGoal)));
      one('[data-tapl-goal-selection]').textContent = `Selected example: ${examples.get(selectedGoal).label}.`;
      one('[data-tapl-story-selection]').textContent = audience === 'unspecified' ? 'Personal example shown. No perspective selected.' : `Exploring ${roleOptions.get(audience).label}.`;
      const option = roleOptions.get(audience);
      interest.dataset.interestAudience = audience;
      interest.dataset.interestFeature = option?.feature || 'programs';
      interestLabel.textContent = option?.action || 'Share feedback or interest';
    };
    const renderHero = (activeExample) => {
      landing.querySelectorAll('[data-tapl-hero-task]').forEach((node,index) => { node.textContent=activeExample.weeks.get('1').tasks[index]; });
      landing.querySelectorAll('[data-tapl-hero-note]').forEach((node,index) => { node.textContent=activeExample.weeks.get('1').notes[index]; });
      const heroContext=landing.querySelector('[data-tapl-hero-context]');
      if (heroContext) heroContext.textContent=activeExample.label;
      landing.querySelectorAll('[data-tapl-hero-actor]').forEach((node,index) => { node.textContent=activeExample.weeks.get('1').actors[index] || ''; node.hidden=!activeExample.weeks.get('1').actors[index]; });
      const upcomingActor = activeExample.weeks.get('1').actors[1];
      mobileUpcoming.textContent = `Later: Wednesday${upcomingActor ? ' / '+upcomingActor : ''} (sample)`;
    };
    const renderWeek = (activeExample) => {
      weekButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.taplWeekChoice === selectedWeek)));
      const week = activeExample.weeks.get(selectedWeek);
      all('[data-tapl-task-text]').forEach((node,index) => { node.textContent = index === 1 && selectedWeek === '2' && smallerWeek2 ? activeExample.smaller : week.tasks[index]; });
      all('[data-tapl-task-note]').forEach((node,index) => { node.textContent = index === 1 && selectedWeek === '2' && smallerWeek2 ? activeExample.smallerNote : week.notes[index]; });
      all('[data-tapl-task-actor]').forEach((node,index) => { node.textContent = week.actors[index] || ''; node.hidden = !week.actors[index]; });
      complete.checked = sample().complete;
      const slot = daySlots.get(sample().day);
      slot.insertBefore(task, slot.querySelector('[data-tapl-day-empty]'));
      all('[data-tapl-day-empty]').forEach(node => { node.hidden = node.dataset.taplDayEmpty === sample().day; });
      all('[data-tapl-day-choice]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.taplDayChoice === sample().day)));
      one('[data-tapl-selected-week-label]').textContent = `Week ${selectedWeek} sample: ${activeExample.label}${selectedWeek === '2' && smallerWeek2 ? ' / smaller-step version' : ''}.`;
      one('[data-tapl-monday-status]').textContent = complete.checked ? 'Sample: marked complete' : 'Sample: not completed';
      one('[data-tapl-completed-count]').textContent = complete.checked ? '1' : '0';
      one('[data-tapl-moved-count]').textContent = sample().day === 'thursday' ? '1' : '0';
      one('[data-tapl-week-note]').textContent = `Week ${selectedWeek} sample: ${sample().day === 'thursday' ? 'Thursday' : 'Wednesday'}. ${complete.checked ? 'One sample step' : 'No sample step'} marked complete.`;
    };
    const renderSupport = (activeExample) => {
      one('[data-tapl-support-panel]').hidden = !lessTime;
      one('[data-tapl-support-instruction]').hidden = lessTime;
      one('[data-tapl-support-copy]').textContent = activeExample.support;
      one('[data-tapl-original-step]').textContent = `Original example Week 2 action: ${activeExample.weeks.get('2').tasks[1]}.`;
      one('[data-tapl-smaller-explanation]').textContent = `Smaller week 2 example: ${activeExample.smaller}. ${activeExample.smallerNote}`;
      one('[data-tapl-generated-task]').textContent = activeExample.smaller;
      one('[data-tapl-generated-note]').textContent = activeExample.smallerNote;
    };
    const renderMilestones = (activeExample) => {
      all('[data-tapl-milestone-phase]').forEach((node,index) => { node.textContent=activeExample.milestones[index]; });
      // This milestone illustrates Week 1 readiness, independently of the
      // selected week's checkbox total and the planned program metric.
      one('[data-tapl-preparation-status]').textContent = weekState['1'].complete ? "Marked complete in sample Week 1" : "Not marked complete in sample Week 1";
      one('[data-tapl-goal-milestone-view]').textContent = activeExample.metric;
      one('[data-tapl-goal-metric-view]').textContent = 'A planned example metric, not a value calculated by marking the sample task. Program metrics would need their own suitable observations and review.';
    };
    const renderSummary = (activeStory, activeExample) => {
      const option = roleOptions.get(audience);
      one('[data-tapl-goal-summary-view]').textContent = activeExample.summary;
      all('[data-tapl-summary-concept]').forEach(node => { node.hidden = node.dataset.taplSummaryConcept !== (activeStory === 'personal' ? 'personal' : 'creator'); });
      one('[data-tapl-recap]').textContent = `Week ${selectedWeek} sample, exploring ${option?.label || 'without an audience choice'}. ${complete.checked ? 'One sample action' : 'No sample action'} marked complete; ${sample().day === 'thursday' ? 'one task moved' : 'no task moved'}.`;
    };
    const renderPosition = () => {
      const stepLabel = `Discovery step ${current+1} of 5 ${String.fromCodePoint(0x00b7)} ${headings[current].textContent}`;
      if (position.textContent !== stepLabel) position.textContent = stepLabel;
    };
    // Rendering maps current state to owned DOM regions. Choice announcements
    // remain in the action handlers; these functions never announce or navigate.
    const render = () => {
      const activeStory = story(), activeExample = example();
      renderStory(activeStory, activeExample);
      renderHero(activeExample);
      renderWeek(activeExample);
      renderSupport(activeExample);
      renderMilestones(activeExample);
      renderSummary(activeStory, activeExample);
      renderPosition();
    };
    // Public incoming fragments are honored; local demo navigation deliberately does not
    // write URL/history state. Reloading a shared fragment restarts at that incoming chapter.
    // SSR keeps all chapters readable until every enhancement guard passes, accepting a
    // possible five-to-one layout transition rather than hiding fallback content pre-init.
    const go = (index, focus=true, animate=true) => {
      if (!Number.isInteger(index) || index<0 || index>=chapters.length) return;
      const previous=current; current=index;
      chapters.forEach((chapter,i) => { chapter.classList.remove('tapl-entering'); chapter.hidden=i!==current; });
      indicators.forEach((indicator,i) => { if (i===current) indicator.setAttribute('aria-current','step'); else indicator.removeAttribute('aria-current'); });
      back.disabled=current===0; next.disabled=current===chapters.length-1;
      render();
      if (animate && previous!==current && !reduceMotion.matches) {
        void chapters[current].offsetWidth; chapters[current].classList.add('tapl-entering');
      }
      if (focus) { headings[current].focus({preventScroll:true}); position.scrollIntoView({block:'start',behavior:'instant'}); }
    };
    roleButtons.forEach(button => button.addEventListener('click',event => {
      focusChoice(event); const previous=story(); audience=button.dataset.taplAudience;
      const changed = story() !== previous;
      if (changed) resetWeeks();
      if (changed && button.closest('.tapl-story-switch')) go(0); else render();
      announce(`Story selected ${roleOptions.get(audience).label}.${changed ? ' Sample weeks reset.' : ''}`);
    }));
    one('[data-tapl-clear-audience]').addEventListener('click',event => { focusChoice(event); const previous=story(); audience='unspecified'; if (story()!==previous) resetWeeks(); render(); announce('Exploring without an audience choice.'+(story()!==previous ? ' Sample weeks reset.' : '')); });
    goalButtons.forEach(button => button.addEventListener('click',event => {
      focusChoice(event);
      if (story()!=='personal' || selectedGoal===button.dataset.taplGoalChoice) return;
      selectedGoal=button.dataset.taplGoalChoice; resetWeeks(); render(); announce(`${example().label} example selected. Sample weeks reset.`);
    }));
    weekButtons.forEach(button => button.addEventListener('click',event => {
      focusChoice(event); if (selectedWeek===button.dataset.taplWeekChoice) return;
      selectedWeek=button.dataset.taplWeekChoice; clearCelebration(); render(); announce(one('[data-tapl-week-note]').textContent);
    }));
    all('[data-tapl-day-choice]').forEach(button => button.addEventListener('click',event => { focusChoice(event); sample().day=button.dataset.taplDayChoice; render(); announce(one('[data-tapl-week-note]').textContent); }));
    complete.addEventListener('change',() => { sample().complete=complete.checked; render(); announce(one('[data-tapl-week-note]').textContent); });
    one('[data-tapl-less-time]').addEventListener('click',event => {
      focusChoice(event); lessTime=!lessTime;
      event.currentTarget.setAttribute('aria-pressed',String(lessTime)); render();
      announce(lessTime ? 'Prepared support options shown.' : 'Prepared support options hidden.');
    });
    one('[data-tapl-preview-adjusted]').addEventListener('click',event => { focusChoice(event); setGeneratedVisible(true); go(3); one('[data-tapl-suggestion-status]').textContent='Prepared sample step shown. Nothing has been added to the sample week.'; });
    one('[data-tapl-show-generated]').addEventListener('click',event => { focusChoice(event); const visible=one('#tapl-generated-step').hidden; setGeneratedVisible(visible); one('[data-tapl-suggestion-status]').textContent=visible ? 'Prepared sample step shown. Nothing has been added to the sample week.' : 'Prepared sample step hidden.'; });
    one('[data-tapl-use-generated]').addEventListener('click',event => { focusChoice(event); selectedWeek='2'; smallerWeek2=true; clearCelebration(); render(); one('[data-tapl-suggestion-status]').textContent = "Sample Week 2 updated. You can review the revised plan."; });
    one('[data-tapl-celebrate]').addEventListener('click',event => {
      focusChoice(event); celebration.classList.remove('tapl-celebration--active');
      one('[data-tapl-celebration-status]').textContent = "A moment to celebrate exploring this example. Your real goal remains yours to work towards.";
      if (!reduceMotion.matches) { void celebration.offsetWidth; celebration.classList.add('tapl-celebration--active'); }
    });
    celebration.addEventListener('animationend',() => celebration.classList.remove('tapl-celebration--active'));
    all('[data-tapl-go]').forEach(anchor => anchor.addEventListener('click',event => { if (!plainAnchor(event)) return; event.preventDefault(); go(Number(anchor.dataset.taplGo)); }));
    back.addEventListener('click',() => go(current-1)); next.addEventListener('click',() => go(current+1));
    restart.addEventListener('click',() => { audience='unspecified'; selectedGoal='language'; resetWeeks(); go(0); announce('Sample reset. Learn a language, Week 1, without an audience choice.'); });
    chapters.forEach(chapter => chapter.addEventListener('animationend',() => chapter.classList.remove('tapl-entering')));
    resetWeeks(); quest.classList.add('tapl-quest--enhanced');
    all('[data-tapl-enhanced]').forEach(node => { node.hidden=false; });
    const fragmentChapter = () => { let id; try { id=decodeURIComponent(location.hash.slice(1)); } catch { return -1; } return chapters.findIndex(chapter => chapter.id===id); };
    const initial=fragmentChapter(); go(initial>=0?initial:0,false,false);
    // Reveal the requested incoming chapter without moving keyboard focus.
    // Explicit navigation and later hash changes still focus its heading.
    if (initial>=0) position.scrollIntoView({block:'start',behavior:'instant'});
    window.addEventListener('hashchange',() => { const index=fragmentChapter(); if(index>=0) go(index,true,false); });
    landing.querySelector('.tapl-hero a[href="#tapl-quest"]')?.addEventListener('click',event => { if (plainAnchor(event)) go(0,false,false); });
  }
  landing.querySelector('.tapl-hero a[href="#tapl-details"]')?.addEventListener('click',event => {
    if (!plainAnchor(event)) return;
    const details=landing.querySelector('#tapl-details'); if (details instanceof HTMLDetailsElement) details.open=true;
  });
  // A single finite entrance; all content is visible if enhancement fails.
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      if (!reduceMotion.matches) entry.target.classList.add('tapl-revealing');
    }), {threshold:.12});
    landing.querySelectorAll('[data-tapl-circles]').forEach(group => {
      observer.observe(group);
      group.addEventListener('animationend', () => group.classList.remove('tapl-revealing'), {once:true});
    });
  }
}
