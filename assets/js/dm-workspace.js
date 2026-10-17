import { parseTopics } from "./dm-topics.js";
import { createDecisionDialog } from "./dm-dialog.js";
import {
  createDecision,
  createDraft, parseDraft, serializeDraft,
  makePairs,
  orderedResults,
  validateDecision,
  parseDecision,
  serializeDecision,
  resultsCsv,
  MAX_OPTIONS,
  MAX_HISTORY,
  parseHistory,
  recoverHistoryEntries,
  putHistory,
} from "./dm-model.js";

import {
  STORAGE_KEY,
  HISTORY_KEY,
  HistoryProblem,
  createHistoryStorage,
  DraftProblem, createDraftStorage,
} from "./dm-storage.js";

const priorityNames = new Map([
  [1, "Low (1)"],
  [3, "Middle (3)"],
  [5, "High (5)"],
  [8, "Emergency (8)"],
]);
export function createIdGenerator(cryptoSource = globalThis.crypto) {
  const randomPart = () => {
    if (typeof cryptoSource?.randomUUID === "function") {
      try {
        const value = cryptoSource.randomUUID().replaceAll("-", "");
        if (/^[a-f0-9]{32}$/i.test(value)) return value;
      } catch {
        // Older or restricted contexts may expose an unusable UUID method.
      }
    }
    if (typeof cryptoSource?.getRandomValues === "function") {
      try {
        const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, (value) =>
          value.toString(16).padStart(2, "0"),
        ).join("");
      } catch {
        // Refuse creation rather than inventing a non-crypto fallback.
      }
    }
    return null;
  };
  let first = randomPart();
  if (first === null) return null;
  return (prefix) => {
    const value = first ?? randomPart();
    first = null;
    return value === null ? null : prefix + value;
  };
}
export function decisionExportFilename(kind, entryId, timestamp, sequence) {
  const identifier =
    typeof entryId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(entryId)
      ? entryId
      : "draft";
  const category = ["decision", "recovered-decision", "results"].includes(kind)
    ? kind
    : "decision";
  const stamp =
    Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : 0;
  const serial = Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1;
  return `emtalk-dm-${category}-${identifier}-${stamp}-${serial}.${category === "results" ? "csv" : "json"}`;
}
function node(tag, attrs = {}, children = []) {
  const item = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") item.className = value;
    else item.setAttribute(key, String(value));
  }
  for (const child of children)
    item.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  return item;
}
function button(label, action, primary = false) {
  const b = node(
    "button",
    { type: "button", ...(primary ? { class: "dm-workspace__primary" } : {}) },
    [label],
  );
  b.addEventListener("click", action);
  return b;
}
const field = (label, input) =>
  node("label", { class: "dm-workspace__field" }, [label, input]);
function init() {
  const app = document.querySelector("[data-dm-app]");
  if (!app) return;
  const screen = app.querySelector("[data-dm-screen]"),
    status = app.querySelector("[data-dm-status]"),
    filesPanel = app.querySelector("[data-dm-files]");
  let activeHistoryId = null,
    exportSequence = 0;
  let state = createDecision(),
    pairIndex = 0,
    optionIndex = 0,
    dirty = false;
  let topicCategory = null, topics = null;
  try { topics = parseTopics(document.getElementById("emtalk-dm-topics").textContent); } catch { /* Manual decisions stay available if the optional catalog fails. */ }
  const announce = (message) => {
    status.textContent = message;
  };
  const changed = () => {
    dirty = true;
    draftSuppressed = false;
    persistDraft();
  };
  const { readHistory, writeHistory, resetHistoryObservation } = createHistoryStorage({
    getStorage: () => globalThis.localStorage,
    parseHistory,
    parseDecision,
  });
  const draftStore = createDraftStorage({getStorage: () => globalThis.localStorage, parseDraft, serializeDraft});
  let draftProblem = null, draftBlocked = false, draftSuppressed = false, draftResumed = false;
  let lastPersistedDraft = null;
  try {
    const draft = draftStore.readDraft();
    if (draft) {
      state = draft.decision;
      pairIndex = draft.pairIndex;
      optionIndex = draft.optionIndex;
      activeHistoryId = draft.savedEntryId;
      dirty = true;
      draftResumed = true;
      // Opening an existing draft is observation, not an edit. Preserve its
      // stored bytes so another tab does not receive a false stale-draft error.
      lastPersistedDraft = serializeDraft(createDraft(state, {
        pairIndex, optionIndex, savedEntryId: activeHistoryId,
      }, 0));
    }
  } catch (error) { draftProblem = error; draftBlocked = true; }
  const id = createIdGenerator();
  const heading = (title) =>
    node("h2", { tabindex: "-1", "data-step-heading": "" }, [title]);
  const actions = (children) =>
    node("div", { class: "dm-workspace__actions" }, children);
  function disableWorkspace() {
    app
      .querySelectorAll("button, input, select, textarea")
      .forEach((control) => {
        control.disabled = true;
      });
    screen.replaceChildren(
      heading("Workspace unavailable in this browser"),
      node("p", {}, [
        "This browser cannot create local decision IDs. Try an up-to-date browser on HTTPS. Your saved decisions have not changed. You can still read About Decision Matrix. If saved decisions can be read, export options appear below.",
      ]),
    );
    const exportCopy = (label, decision, entryId = activeHistoryId) => {
      screen.append(
        button(label, () => {
          try {
            download(
              serializeDecision(decision),
              "application/json",
              exportName("decision", entryId),
            );
          } catch {
            announce(
              "This decision could not be exported. Your saved data has not changed.",
            );
          }
        }),
      );
    };
    if (state.options.length) exportCopy("Export current decision JSON", state);
    try {
      for (const entry of readHistory().entries)
        exportCopy(
          "Export " + (entry.decision.title || "Untitled decision"),
          entry.decision,
          entry.id,
        );
    } catch (error) {
      const corrupt =
        error instanceof HistoryProblem && error.kind === "corrupt";
      screen.append(
        node("p", {}, [
          corrupt
            ? "Saved data could not be read safely. No stored data was changed. Any available recovery exports below do not restore or save anything."
            : "Saved decisions could not be accessed, so they cannot be exported here while access is blocked. No stored data was changed. Check this browser's site-data permissions and try again.",
        ]),
      );
      if (corrupt) {
        try {
          const legacy = error.slot === STORAGE_KEY;
          const recovered = recoverHistoryEntries(error.raw, legacy);
          screen.append(
            button("Download raw saved-data backup", () =>
              download(
                error.raw,
                "text/plain;charset=utf-8",
                "emtalk-dm-saved-data-backup.txt",
              ),
            ),
          );
          for (const entry of recovered.entries)
            exportCopy(
              "Export readable decision " + entry.position,
              entry.decision,
              "recovery" + entry.position,
            );
        } catch {
          screen.append(
            node("p", {}, [
              "This saved data exceeds the recovery limit or cannot be inspected. It was not parsed, exported or changed.",
            ]),
          );
        }
      }
    }
    app.hidden = false;
    announce(
      "Decision editing is unavailable in this browser. Existing saved data has not changed.",
    );
  }
  if (id === null) {
    disableWorkspace();
    return;
  }
  function show(focus = true) {
    screen.hidden = false;
    historyPanel.hidden = true;
    filesPanel.hidden = true;
    setNavigation("decision");
    screen.replaceChildren();
    if (state.step === "options") showOptions();
    if (state.step === "compare") showComparison();
    if (state.step === "review") showReview();
    if (state.step === "pros") showPros();
    if (state.step === "results") showResults();
    if (!draftSuppressed && (dirty || draftResumed || state.options.length || state.title)) persistDraft();
    if (focus) {
      const title = screen.querySelector("[data-step-heading]");
      title?.focus({ preventScroll: true });
      app.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  function transition(step) {
    state.step = step;
    if (step === "compare") resumeComparison();
    changed();
    announce("");
    show();
  }
  const askBaseDecision = createDecisionDialog({
    dialog: document.querySelector("[data-dm-dialog]"),
    announce,
  });

  const navButtons = [...app.querySelectorAll('.dm-workspace__nav button')];
  function setNavigation(view) {
    for(const item of navButtons) {
      const current = item.dataset.dmView || 'saved';
      if(current===view)item.setAttribute('aria-current','true');
      else item.removeAttribute('aria-current');
    }
  }
  function askDecision(options) { return askBaseDecision(options); }
  app.querySelector('[data-dm-view="decision"]').addEventListener('click',()=>{announce('');show();});
  app.querySelector('[data-dm-view="files"]').addEventListener('click',()=>{
    announce('');screen.hidden=true;historyPanel.hidden=true;filesPanel.hidden=false;
    setNavigation('files');filesPanel.querySelector('h2').focus({preventScroll:true});app.scrollIntoView({block:'start',behavior:'instant'});
  });
  app.querySelector('[data-dm-draft-notice]').textContent = draftResumed
    ? 'Draft resumed. Changes save in this browser only.'
    : 'Local draft: changes save in this browser only.';
  function persistDraft() {
    if (draftBlocked || draftSuppressed) return;
    try {
      const draft = createDraft(state, {
        pairIndex: Math.max(0, Math.min(pairIndex, state.pairs.length - 1)),
        optionIndex: Math.max(0, Math.min(optionIndex, state.selected.length - 1)),
        savedEntryId: activeHistoryId,
      });
      // Compare actual draft content, excluding its save timestamp. Navigation
      // alone must not rewrite storage or create a false conflict in another tab.
      const signature = serializeDraft({ ...draft, savedAt: 0 });
      if (signature === lastPersistedDraft) { draftResumed = false; return; }
      draftStore.writeDraft(draft);
      lastPersistedDraft = signature;
      draftResumed = false;
      app.querySelector('[data-dm-draft-notice]').textContent = 'Draft saved in this browser only. Nothing is uploaded.';
    } catch (error) { draftProblem = error; draftBlocked = true; showDraftProblem(); }
  }
  function showDraftProblem() {
    const panel = app.querySelector('[data-dm-draft-recovery]');
    panel.hidden = false;
    panel.replaceChildren(node('h3', {}, ['Your working decision is still here']), node('p', {}, [
      draftProblem?.kind === 'corrupt' || draftProblem?.kind === 'conflict'
        ? 'Another draft could not be restored safely or changed in another tab. It has not been overwritten. Export your work before deciding whether to delete the stored draft.'
        : 'Automatic draft saving is unavailable. Keep this tab open or use Export JSON to keep your work.'
    ]));
    app.querySelector('[data-dm-draft-notice]').textContent = 'Draft not saved automatically. Your working decision remains available for export.';
    panel.append(button('Export working decision', () => download(serializeDecision(state), 'application/json', exportName())));
    if (typeof draftProblem?.raw === 'string' && new TextEncoder().encode(draftProblem.raw).length <= 220000) {
      panel.append(button('Download raw draft backup', () => download(draftProblem.raw, 'text/plain;charset=utf-8', 'emtalk-dm-draft-backup.txt')));
    } else if (typeof draftProblem?.raw === 'string') {
      panel.append(node('p', {}, ['A raw draft backup is unavailable here because this stored draft exceeds the 220 KB recovery limit. The stored bytes have not been changed.']));
    }
    panel.append(button('Delete current draft', deleteCurrentDraft));
  }
  async function deleteCurrentDraft(event) {
    if (!(await askDecision({title:'Delete current draft?', description:'This deletes only the automatically saved draft from this browser. Your working decision, named saves and exported files remain. New edits start a new local draft.', accept:'Delete current draft', returnFocus:event?.currentTarget}))) return;
    try {
      draftStore.deleteDraft(typeof draftProblem?.raw === 'string' ? {expectedRaw:draftProblem.raw} : {});
      draftProblem = null; draftBlocked = false; draftSuppressed = true; draftResumed = false;
      lastPersistedDraft = null;
      app.querySelector('[data-dm-draft-recovery]').hidden = true;
      app.querySelector('[data-dm-draft-notice]').textContent = 'Current draft deleted. New edits will save a new draft in this browser.';
      announce('Current draft deleted. Named saved decisions are unchanged.');
    } catch (error) { draftProblem = error; draftBlocked = true; showDraftProblem(); }
  }
  app.querySelector('[data-dm-action="delete-draft"]').addEventListener('click', deleteCurrentDraft);
  async function editOptions(event) {
    if (
      !(await askDecision({
        title: "Edit options?",
        returnFocus: event?.currentTarget,
        description:
          "This starts a new comparison and clears the reasons in this working decision. Your saved decisions and exported files stay unchanged.",
        accept: "Edit options",
      }))
    )
      return;
    state.pairs = [];
    state.answers = {};
    state.selected = [];
    state.opinions = [];
    transition("options");
  }
  function showOptions() {
    screen.append(heading('What would you like to decide?'), aiEntry('Find options with AI'), availability());
    screen.append(topicCatalog());
    const naming = node('details', {}, [node('summary',{},['Name this decision (optional)'])]);
    const title = node('input', {type:'text', maxlength:160, 'aria-label':'Decision name', placeholder:'What are you deciding?'});
    title.value = state.title;
    title.addEventListener('input', () => { state.title = title.value; changed(); });
    naming.append(field('Decision name',title)); screen.append(naming);
    const list = node('div', {class:'dm-workspace__option-list', 'aria-label':'Your options'});
    state.options.forEach((option,index) => {
      const input = node('input', {type:'text',maxlength:100,'aria-label':'Option '+(index+1)}); input.value=option.title;
      input.addEventListener('change', () => {
        const value=input.value.trim();
        if (!value || state.options.some(o => o.id!==option.id && o.title.trim().toLowerCase()===value.toLowerCase())) {
          input.value=option.title; announce('Use a different, nonempty name for each option.'); return;
        }
        option.title=value; changed();
      });
      input.addEventListener('input', () => {
        const value=input.value.trim();
        if(value && !state.options.some(o=>o.id!==option.id && o.title.trim().toLowerCase()===value.toLowerCase())) { option.title=value;changed(); }
      });
      const remove=button('\u00d7', () => {
        state.options=state.options.filter(o=>o.id!==option.id); pairIndex=0;optionIndex=0;
        changed();show(false);screen.querySelector('[data-new-option]')?.focus();announce('Option removed.');
      });
      remove.setAttribute('aria-label','Remove option '+(index+1));
      list.append(node('div',{class:'dm-workspace__row'},[field('Option '+(index+1),input),remove]));
    });
    screen.append(list);
    const form=node('form',{class:'dm-workspace__new-option'}),input=node('input',{type:'text',maxlength:100,required:'','data-new-option':'','aria-label':'New option',placeholder:state.options.length ? 'Another option...' : 'Enter your first option...'});
    const submit=node('button',{type:'submit'},['Add option']);
    if(state.options.length>=MAX_OPTIONS){input.disabled=true;submit.disabled=true;}
    form.append(field('Your options ('+state.options.length+'/8)',input),submit);
    form.addEventListener('submit',event=>{
      event.preventDefault();const value=input.value.trim();
      if(!value || state.options.some(o=>o.title.trim().toLowerCase()===value.toLowerCase())){announce('Use a different, nonempty name for each option.');input.focus();return;}
      if(state.options.length>=MAX_OPTIONS)return;
      const optionId=id('o');if(optionId===null)return disableWorkspace();
      state.options.push({id:optionId,title:value});changed();show(false);screen.querySelector('[data-new-option]')?.focus();announce('Option added.');
    });
    screen.append(form);
    const start=button(state.options.length>3?'Compare options':state.options.length?'Start pros and cons':'Add your options',()=>{
      if(!state.options.length){form.requestSubmit();return;}
      // Commit any typed extra option explicitly; never silently discard it.
      if(input.value.trim()){announce('Add or clear the option you are typing before starting.');input.focus();return;}
      if(state.options.length>3){state.pairs=makePairs(state.options);pairIndex=0;transition('compare');}
      else{state.selected=state.options.map(o=>o.id);optionIndex=0;transition('pros');}
    },true);
    const add=button('+',()=>form.requestSubmit());add.className='dm-workspace__add';add.setAttribute('aria-label','Add option');add.disabled=state.options.length>=MAX_OPTIONS;
    screen.append(node('div',{class:'dm-workspace__bottom'},state.options.length?[start,add]:[start]));
  }
  function topicCatalog() {
    const card=node('section',{class:'dm-workspace__topics'},[node('h3',{},['Topics'])]);
    if(!topics){card.append(node('p',{},['Topics could not be loaded. Add your own options below to start a decision.']));return card;}
    const category=topics.categories.find(c=>c.id===topicCategory)||topics.categories[0];
    topicCategory=category.id;
    const categories=node('div',{class:'dm-workspace__categories',role:'group','aria-label':'Topic categories'});
    const list=node('div',{class:'dm-workspace__topic-list','aria-label':category.label+' topics'});
    for(const c of topics.categories){
      const select=button(c.label,()=>{
        topicCategory=c.id;show(false);
        [...screen.querySelectorAll('[data-dm-category]')].find(b=>b.dataset.dmCategory===c.id)?.focus({preventScroll:true});
      });
      select.dataset.dmCategory=c.id;select.setAttribute('aria-pressed',String(c.id===category.id));categories.append(select);
    }
    for(const topic of category.topics){const select=button(topic.title,()=>showTopic(topic));select.dataset.dmTopic=topic.id;list.append(select);}
    card.append(categories,list);return card;
  }
  function showTopic(topic) {
    screen.replaceChildren(heading(topic.title),node('p',{},['Choose one to eight options that fit your situation. You can edit them before starting.']));
    const selected=new Set(), count=node('p',{'role':'status','aria-live':'polite'},['0 of 8 selected']);
    const choices=node('fieldset',{class:'dm-workspace__choices','data-dm-topic-options':''},[node('legend',{},['Options for this topic'])]);
    const apply=button('Use selected options',async event=>{
      if(selected.size<1 || selected.size>8)return;
      if((state.options.length || state.title) && !(await askDecision({title:'Use this topic?',description:'This replaces the current decision name and options. Named saved decisions and exported files remain unchanged.',accept:'Use selected options',returnFocus:event.currentTarget})))return;
      const next=createDecision();next.title=topic.title;
      for(const title of topic.options.filter(t=>selected.has(t))){const optionId=id('o');if(optionId===null)return disableWorkspace();next.options.push({id:optionId,title});}
      state=next;activeHistoryId=null;pairIndex=0;optionIndex=0;changed();show();announce('Topic added. Edit the options or start your exercise.');
    },true);apply.disabled=true;
    for(const title of topic.options){
      const input=node('input',{type:'checkbox',value:title});
      input.addEventListener('change',()=>{
        if(input.checked && selected.size>=8){input.checked=false;announce('Choose up to eight options. Uncheck one to choose another.');return;}
        if(input.checked)selected.add(title);else selected.delete(title);
        count.textContent=selected.size+' of 8 selected';apply.disabled=selected.size===0;
      });
      choices.append(node('label',{class:'dm-workspace__choice'},[input,title]));
    }
    screen.append(count,choices,actions([apply,button('Back to my options',()=>show())]));
    const title=screen.querySelector('[data-step-heading]');title.focus({preventScroll:true});app.scrollIntoView({block:'start',behavior:'instant'});
  }
  function showComparison() {
    // Imported/UI states require pairs; keep the renderer safe if a future
    // internal caller nevertheless supplies an empty comparison.
    if (!state.pairs.length) {
      transition("options");
      return;
    }
    pairIndex = Math.max(0, Math.min(state.pairs.length - 1, pairIndex));
    screen.append(heading("Which option would you choose?"));
    const answered = Object.keys(state.answers).length;
    const undecided = Object.values(state.answers).filter(
      (answer) => answer === null,
    ).length;
    screen.append(
      node("p", {}, [
        "Pair " +
          (pairIndex + 1) +
          " of " +
          state.pairs.length +
          ". " +
          answered +
          " answered. Includes " +
          undecided +
          " marked undecided. Which would you choose right now?",
      ]),
      node("progress", {
        value: answered,
        max: state.pairs.length,
        "aria-label": "Answered pairs, including undecided",
      }),
    );
    const pair = state.pairs[pairIndex],
      choices = node("fieldset", { class: "dm-workspace__choices" }, [
        node("legend", {}, ["Choose one of these two options"]),
      ]);
    for (const winner of pair) {
      const radio = node("input", {
        type: "radio",
        name: "comparison",
        value: winner || "undecided",
      });
      radio.checked =
        Object.hasOwn(state.answers, String(pairIndex)) &&
        state.answers[pairIndex] === winner;
      radio.addEventListener("change", () => {
        state.answers[pairIndex] = winner;
        changed();
        next.disabled = false;
        announce("Choice saved in this browser draft.");
      });
      choices.append(
        node("label", { class: "dm-workspace__choice" }, [
          radio,
          winner
            ? state.options.find((o) => o.id === winner).title
            : "Leave undecided",
        ]),
      );
    }
    const previous = button("Previous pair", () => {
      pairIndex = Math.max(0, pairIndex - 1);
      show();
    });
    previous.disabled = pairIndex === 0;
    const next = button(pairIndex < state.pairs.length-1 ? 'Next pair' : 'Review comparison', () => {
      if(!pair.includes(state.answers[pairIndex])){announce('Choose one of the two options to continue.');return;}
      if(pairIndex<state.pairs.length-1){pairIndex++;show();}
      else {
        const missing=state.pairs.findIndex((p,i)=>!p.includes(state.answers[i]));
        if(missing>=0){pairIndex=missing;show();announce('Choose an option for this remaining pair.');}
        else transition('review');
      }
    },true);
    next.disabled = !pair.includes(state.answers[pairIndex]);
    const card=node('div',{class:'dm-workspace__choice-card'},[choices]);
    if(Object.hasOwn(state.answers,String(pairIndex)) && state.answers[pairIndex]===null)
      card.append(node('p',{class:'dm-workspace__legacy'},['This earlier saved pair was undecided. Choose one option to continue; the old answer is kept until you choose.']));
    screen.append(card,actions([previous,next,button('Edit options',editOptions)]));
  }
  function resultTable(rows) {
    const list=node('div',{class:'dm-workspace__result-list', 'aria-label':'Decision scores'});
    for(const row of rows){
      const card=node('article',{class:'dm-workspace__result','data-dm-result':'','data-option-id':row.id,'data-wins':row.wins},[
        node('div',{class:'dm-workspace__result-top'},[node('h3',{},[row.title]),node('strong',{},[state.pairs.length?row.wins+' points':row.prosCons+'/100'])])
      ]);
      if(state.pairs.length)card.append(node('p',{},['Chosen '+row.wins+' times in '+(state.options.length-1)+' pairs.']));
      if(row.prosCons!==null){card.append(node('meter',{min:0,max:100,value:row.prosCons,'aria-label':'Pros and cons score for '+row.title}),node('p',{},['Pros and cons: '+row.prosCons+'/100']));}
      else if(state.pairs.length)card.append(node('p',{},['Pros and cons not reviewed.']));
      list.append(card);
    }
    return list;
  }
  function showReview() {
    screen.append(
      heading("3. Choose what to explore next"),
      resultTable(orderedResults(state)),
      node("p", {}, [
        "Select up to three options for pros and cons. Your existing reasons are kept when you deselect an option; only selected options receive a pros-and-cons score.",
      ]),
    );
    const choices = node("fieldset", { class: "dm-workspace__choices" }, [
      node("legend", {}, ["Options for a closer look"]),
    ]);
    for (const option of orderedResults(state)) {
      const input = node("input", { type: "checkbox", value: option.id });
      input.checked = state.selected.includes(option.id);
      input.addEventListener("change", () => {
        if (input.checked && state.selected.length >= 3) {
          input.checked = false;
          announce("Choose at most three options.");
          return;
        }
        const chosen = input.checked ? [...state.selected,option.id] : state.selected.filter(x=>x!==option.id);
        state.selected = orderedResults(state).map(o=>o.id).filter(id=>chosen.includes(id));
        changed();
      });
      choices.append(
        node("label", { class: "dm-workspace__choice" }, [input, node("span",{class:"dm-workspace__choice-name"},[option.title]),node("span",{class:"dm-workspace__points"},[option.wins+" points"])]),
      );
    }
    screen.append(
      choices,
      actions([
        button(
          "Explore pros and cons",
          () => {
            if (!state.selected.length)
              return announce("Choose one to three options first.");
            optionIndex = 0;
            transition("pros");
          },
          true,
        ),
        button("Keep comparison results", () => transition("results")),
        button("Review pairs", () => transition("compare")),
      ]),
    );
  }
  function prioritySelect(value, label) {
    const select = node("select", { "aria-label": label });
    for (const [weight, optionLabel] of priorityNames) {
      const option = node("option", { value: weight }, [optionLabel]);
      option.selected = weight === value;
      select.append(option);
    }
    return select;
  }
  function storeLink(label) {
    return node('a',{href:'https://play.google.com/store/apps/details?id=org.emtalk.dm',target:'_blank',rel:'noopener noreferrer'},[label]);
  }
  function availability(){return node('p',{class:'dm-workspace__availability'},['Coming soon to the website. Coming soon to the App Store.']);}
  function aiEntry(label){
    const link=storeLink('');link.className='dm-workspace__ai';
    link.append(node('span',{class:'dm-workspace__ai-icon','aria-hidden':'true'},[node('img',{src:(document.documentElement.dataset.mountPrefix||'')+'/media/dm/ai-options.svg',alt:'',width:24,height:24})]),node('span',{},[node('strong',{},[label]),node('small',{},['Available in the app on Google Play'])]),node('span',{'aria-hidden':'true'},['\u2197']));return link;
  }
  function aiNotice() {
    return node('aside',{class:'dm-workspace__notice'},[node('p',{},['AI assistance is available in the app. Coming soon to the website.']),storeLink('Get DM on Google Play'),node('p',{},['Coming soon to the App Store.'])]);
  }
  function showPros() {
    optionIndex = Math.max(0, Math.min(state.selected.length - 1, optionIndex));
    const option = state.options.find(
      (o) => o.id === state.selected[optionIndex],
    );
    if (!option) {
      transition("options");
      return;
    }
    screen.append(heading("Weigh the reasons for and against"));
    const tabs = node("div", {
      class: "dm-workspace__tabs",
      role: "group",
      "aria-label": "Options to review",
    });
    state.selected.forEach((oid, i) => {
      const tab = button(state.options.find((o) => o.id === oid).title, () => {
        optionIndex = i;
        show();
      });
      if (i === optionIndex) tab.setAttribute("aria-current", "true");
      tabs.append(tab);
    });
    screen.append(tabs, node("h3", {}, [option.title]));
    const columns = node("div", { class: "dm-workspace__columns" });
    for (const type of ["pros", "cons"]) {
      const section = node("section", { "data-dm-reasons": type }, [
        node("h3", {}, [type === "pros" ? "Reasons for" : "Reasons against"]),
      ]);
      const notes = state.opinions.filter(
        (n) => n.optionId === option.id && n.type === type,
      ).sort((a,b)=>b.priority-a.priority);
      if (!notes.length)
        section.append(node("p", {}, ["No reasons added yet."]));
      notes.forEach((note, i) => {
        const input = node("textarea", {
          maxlength: 400,
          "aria-label": (type === "pros" ? "Pro " : "Con ") + (i + 1),
          "data-dm-note-id":note.id,
        });
        input.value = note.text;
        input.addEventListener("change", () => {
          if (!input.value.trim() || state.opinions.some(n=>n.id!==note.id && n.optionId===option.id && n.text.trim().toLowerCase()===input.value.trim().toLowerCase())) {
            input.value = note.text;
            announce("Use a nonempty reason that is different from the other reasons for this option.");
          } else {
            note.text = input.value.trim();
            changed();
          }
        });
        input.addEventListener('input', () => {
          const value=input.value.trim();
          if(value && !state.opinions.some(n=>n.id!==note.id && n.optionId===option.id && n.text.trim().toLowerCase()===value.toLowerCase())){note.text=value;changed();}
        });
        const priority = prioritySelect(
          note.priority,
          "Importance of " +
            type +
            " reason " +
            (i + 1) +
            " for " +
            option.title,
        );
        priority.addEventListener("change", () => {
          note.priority = Number(priority.value);
          changed();show(false);screen.querySelector('[data-dm-note-id="'+note.id+'"]')?.parentElement.querySelector("select")?.focus();
        });
        section.append(
          node("div", { class: "dm-workspace__note" }, [
            input,
            priority,
            button("Remove reason", () => {
              state.opinions = state.opinions.filter((x) => x.id !== note.id);
              changed();
              show(false);
              const updated = screen.querySelector(
                "[data-dm-reasons=" + type + "]",
              );
              const remaining = updated.querySelectorAll(
                ".dm-workspace__note textarea",
              );
              (
                remaining[Math.min(i, remaining.length - 1)] ||
                updated.querySelector("form textarea")
              )?.focus();
              announce("Reason removed.");
            }),
          ]),
        );
      });
      const form = node("form"),
        input = node("textarea", {
          required: "",
          maxlength: 400,
          "aria-label":
            type === "pros" ? "New reason for" : "New reason against",
        }),
        priority = prioritySelect(
          8,
          "Importance of new " + type + " reason for " + option.title,
        );
      form.append(
        field(
          type === "pros" ? "Add a reason for" : "Add a reason against",
          input,
        ),
        field("Importance of this reason", priority),
        node("button", { type: "submit" }, ["Add reason"]),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        if (state.opinions.some(n=>n.optionId===option.id && n.text.trim().toLowerCase()===value.toLowerCase())) return announce("This reason already exists for this option. Add a different reason.");
        if (state.opinions.length >= 120)
          return announce(
            "This decision already has 120 reasons. Remove a reason before adding another.",
          );
        const reasonId = id("r");
        if (reasonId === null) return disableWorkspace();
        state.opinions.push({
          id: reasonId,
          optionId: option.id,
          type,
          text: value,
          priority: Number(priority.value),
        });
        changed();
        announce("Reason added.");
        show(false);
        screen
          .querySelector(
            type === "pros"
              ? '[aria-label="New reason for"]'
              : '[aria-label="New reason against"]',
          )
          ?.focus();
      });
      section.append(form);
      columns.append(section);
    }
    screen.append(
      columns,
      actions([
        button(
          optionIndex < state.selected.length - 1
            ? "Next option"
            : "See results",
          () => {
            if (optionIndex < state.selected.length - 1) {
              optionIndex++;
              show();
            } else transition("results");
          },
          true,
        ),
        button(
          state.pairs.length ? "Choose options to review" : "Edit options",
          state.pairs.length ? () => transition("review") : editOptions,
        ),
      ]),
      aiNotice(),
    );
  }
  function showResults() {
    screen.append(
      heading("Your decision, reflected back"),
      node("p", {}, [state.title || "Untitled decision"]),
      resultTable(orderedResults(state)),
      node("p", { class: "dm-workspace__notice" }, [
        "These are your preferences, not a prediction or a recommendation. Scores do not decide for you. Pros and cons with no reasons have the neutral score of 50. Pairwise and pros-and-cons scores are shown separately, as distinct exercises.",
      ]),
      actions([
        ...(state.selected.length
          ? [button("Edit pros and cons", () => transition("pros"))]
          : []),
        ...(state.pairs.length
          ? [button("Review comparison", () => transition("review"))]
          : []),
        button("Export results CSV", () =>
          download(
            resultsCsv(state),
            "text/csv;charset=utf-8",
            exportName("results"),
          ),
        ),
        button("New decision", async (event) => {
          if (
            await askDecision({
              title: "Start a new decision?",
              returnFocus: event?.currentTarget,
              description:
                "This replaces the current working decision. Your saved decisions and exported files will not be deleted.",
              accept: "Start new decision",
            })
          ) {
            state = createDecision();
            pairIndex = 0; optionIndex = 0;
            activeHistoryId = null;
            changed();
            show();
          }
        }),
      ]),
      aiNotice(),
    );
  }
  function exportName(kind = "decision", entryId = activeHistoryId) {
    return decisionExportFilename(kind, entryId, Date.now(), ++exportSequence);
  }
  function download(content, type, name) {
    let url = null,
      a = null;
    const release = () => {
      if (url === null) return;
      try {
        URL.revokeObjectURL(url);
      } catch {
        // The document also releases its object URLs when it unloads.
      }
      url = null;
    };
    try {
      url = URL.createObjectURL(new Blob([content], { type }));
      a = node("a", { href: url, download: name });
      document.body.append(a);
      a.click();
      // Allow a minute for asynchronous download pickup, then release this
      // invocation's URL. This is a bounded grace, not a completion signal.
      setTimeout(release, 60000);
    } catch {
      release();
      announce(
        "The download could not be prepared. Your working decision and saved data have not changed. Try exporting again or use another browser.",
      );
      return false;
    } finally {
      a?.remove();
    }
    announce(
      type.startsWith("text/csv")
        ? "CSV download prepared in UTF-8 with an encoding marker for spreadsheet apps. Keep this file private if it contains personal notes."
        : "Download prepared. Keep this file private if it contains personal notes.",
    );
    return true;
  }
  const historyPanel = app.querySelector("[data-dm-history]");
  function resumeComparison() {
    const missing =
      state.step === "compare"
        ? state.pairs.findIndex(
            (_, index) => !Object.hasOwn(state.answers, String(index)),
          )
        : -1;
    pairIndex = missing < 0 ? 0 : missing;
  }
  function showHistoryFailure(error, saving = false) {
    if (error instanceof HistoryProblem && error.kind === "corrupt") {
      historyPanel.replaceChildren(
        node("h2", {}, ["Saved-data recovery (export only)"]),
        node("p", {}, [
          "Saved data could not be read safely. No entries were removed or repaired. Saving will not overwrite it. Export a raw backup before deciding whether to clear saved decisions yourself.",
        ]),
      );
      try {
        const legacy = error.slot === STORAGE_KEY;
        const recovered = recoverHistoryEntries(error.raw, legacy);
        historyPanel.append(
          node("p", {}, [
            recovered.problem
              ? "The stored JSON or history structure is invalid. Only a raw backup is available."
              : recovered.entries.length +
                " readable decision(s); " +
                recovered.unreadable +
                " unreadable entry/entries. Recovery exports do not restore or save anything.",
          ]),
        );
        historyPanel.append(
          button(
            "Download raw " + (legacy ? "earlier-save" : "history") + " backup",
            () => {
              download(
                error.raw,
                "text/plain;charset=utf-8",
                legacy
                  ? "emtalk-dm-earlier-save-backup.txt"
                  : "emtalk-dm-history-backup.txt",
              );
            },
          ),
        );
        for (const entry of recovered.entries)
          historyPanel.append(
            button(
              "Export readable decision " +
                entry.position +
                ": " +
                (entry.decision.title || "Untitled decision"),
              () => {
                download(
                  serializeDecision(entry.decision),
                  "application/json",
                  exportName("recovered-decision", "recovery" + entry.position),
                );
              },
            ),
          );
      } catch {
        historyPanel.append(
          node("p", {}, [
            "The stored data exceeds the recovery limit (2 MB history or 200 KB earlier save), or cannot be inspected. It was not parsed, exported or changed. Use your browser's site-data tools to keep a copy.",
          ]),
        );
      }
      filesPanel.hidden=true;setNavigation("saved");screen.hidden=true;historyPanel.hidden = false;
      announce(
        "Saved data could not be read safely. Nothing was saved or changed. Export JSON keeps your current working decision; recovery exports are below.",
      );
    } else {
      announce(
        (error instanceof HistoryProblem && error.kind === "conflict"
          ? "Saved decisions changed in another tab. They were not overwritten; review the latest saves and try again. "
          : error instanceof HistoryProblem && error.kind === "quota"
          ? "This browser's storage is full. "
          : "This browser could not read or write saved decisions. ") +
          (saving
            ? "This decision was not saved. "
            : "The requested change could not be completed. ") +
          "Your working decision is still here. Use Export JSON to keep a copy.",
      );
    }
  }
  function renderHistory(history, open = false) {
    historyPanel.replaceChildren(
      button("Back to decision",()=>{announce("");show();}),
      node("h2", {tabindex:"-1"}, [
        "Saved decisions on this device (" + history.entries.length + "/20)",
      ]),
    );
    if (!history.entries.length)
      historyPanel.append(
        node("p", {}, ["No saved decisions were found in this browser."]),
      );
    for (const entry of history.entries) {
      const name = entry.decision.title || "Untitled decision";
      const row = node("div", { class: "dm-workspace__history-row" }, [
        node("h3", {}, [name]),
        node("p", {}, [
          entry.savedAt
            ? "Saved " + new Date(entry.savedAt).toLocaleString()
            : "Earlier local save",
        ]),
      ]);
      const openButton = button("Open " + name, async (event) => {
        try {
          const fresh = readHistory().entries.find(
            (item) => item.id === entry.id,
          );
          if (!fresh) {
            announce(
              "That saved decision no longer exists. Refresh Saved decisions.",
            );
            return;
          }
          if (
            dirty &&
            !(await askDecision({
              title: "Open saved decision?",
              returnFocus: event?.currentTarget,
              description:
                "This replaces your current unsaved work with the saved decision. Existing saved decisions and exported files stay unchanged.",
              accept: "Open saved decision",
            }))
          )
            return;
          state = validateDecision(fresh.decision);
          activeHistoryId = fresh.id;
          dirty = false;
          resumeComparison();
          optionIndex = 0;
          show();
          announce("Saved decision restored: " + name);
        } catch (error) {
          if (error instanceof HistoryProblem) return showHistoryFailure(error);
          announce(
            "Saved decisions could not be read. Your working decision has not changed.",
          );
        }
      });
      const remove = button("Delete " + name, async (event) => {
        if (
          !(await askDecision({
            title: "Delete saved decision?",
            returnFocus: event?.currentTarget,
            description:
              'Delete "' +
              name +
              '" from this browser? Your working decision and exported files will not be deleted.',
            accept: "Delete saved decision",
          }))
        )
          return;
        try {
          const history = readHistory();
          history.entries = history.entries.filter(
            (item) => item.id !== entry.id,
          );
          writeHistory(history);
          if (activeHistoryId === entry.id) { activeHistoryId = null; persistDraft(); }
          renderHistory(history, true);
          (
            historyPanel.querySelector("button") ||
            app.querySelector('[data-dm-action="restore"]')
          )?.focus();
          announce("Saved decision deleted.");
        } catch (error) {
          if (error instanceof HistoryProblem) return showHistoryFailure(error);
          announce(
            "This browser could not delete the saved decision. Your working decision is unchanged.",
          );
        }
      });
      const exportButton = button("Export " + name, () =>
        download(
          serializeDecision(entry.decision),
          "application/json",
          exportName("decision", entry.id),
        ),
      );
      row.append(actions([openButton, exportButton, remove]));
      historyPanel.append(row);
    }
    if (open) { filesPanel.hidden=true;setNavigation("saved");screen.hidden=true;historyPanel.hidden=false;historyPanel.querySelector("h2")?.focus({preventScroll:true});app.scrollIntoView({block:"start",behavior:"instant"}); }
  }
  async function saveDecision(asNew, trigger) {
    let history;
    try {
      history = readHistory();
    } catch (error) {
      showHistoryFailure(error, true);
      return;
    }
    if ((asNew || !activeHistoryId) && history.entries.length >= MAX_HISTORY) {
      announce(
        "This browser has 20 saved decisions. Export and delete one before saving a new decision.",
      );
      return;
    }
    const enteredName =
      asNew || !state.title.trim()
        ? await askDecision({
            title: "Save a decision",
            returnFocus: trigger,
            description:
              "Choose a name to find this decision in this browser later. Nothing is uploaded.",
            accept: "Save decision",
            name: state.title,
          })
        : state.title;
    if (enteredName === null) return;
    const name = enteredName.trim();
    if (!name || name.length > 160) {
      announce("Use a nonempty decision name of up to 160 characters.");
      return;
    }
    let saved;
    try {
      saved = validateDecision({ ...state, title: name });
    } catch {
      announce(
        "This decision contains invalid options or reasons and was not saved. Check the working decision before exporting it.",
      );
      return;
    }
    const replacing = !asNew && activeHistoryId !== null;
    const entryId = replacing ? activeHistoryId : id("d");
    if (entryId === null) return disableWorkspace();
    const entry = {
      id: entryId,
      savedAt: Date.now(),
      decision: saved,
    };
    let next;
    try {
      next = putHistory(readHistory(), entry, replacing);
    } catch (error) {
      if (error instanceof HistoryProblem) showHistoryFailure(error, true);
      else
        announce(
          "The saved entry changed or disappeared. Nothing was saved. Use Save as a new decision, or Export JSON to keep your working decision.",
        );
      return;
    }
    let legacyRetained;
    try {
      legacyRetained = writeHistory(next);
    } catch (error) {
      showHistoryFailure(error, true);
      return;
    }
    state = saved;
    activeHistoryId = entry.id;
    dirty = false;
    show(false);
    renderHistory(next);
    announce(
      "Saved on this device: " +
        name +
        ". No data was uploaded." +
        (legacyRetained
          ? " Earlier-save cleanup could not be completed. Check Files and privacy before removing site data."
          : ""),
    );
  }
  app
    .querySelector('[data-dm-action="save"]')
    .addEventListener("click", (event) =>
      saveDecision(false, event.currentTarget),
    );
  app
    .querySelector('[data-dm-action="save-new"]')
    .addEventListener("click", (event) =>
      saveDecision(true, event.currentTarget),
    );
  app
    .querySelector('[data-dm-action="restore"]')
    .addEventListener("click", () => {
      try {
        const history = readHistory();
        renderHistory(history, true);
        announce(
          history.entries.length
            ? "Choose a saved decision to open, export or delete."
            : "No saved decisions were found in this browser.",
        );
      } catch (error) {
        showHistoryFailure(error);
      }
    });
  app.querySelector('[data-dm-action="json"]').addEventListener("click", () => {
    try {
      download(serializeDecision(state), "application/json", exportName());
    } catch {
      announce(
        "This decision could not be exported. Check your options and reasons.",
      );
    }
  });
  app
    .querySelector('[data-dm-action="clear"]')
    .addEventListener("click", async (event) => {
      if (
        !(await askDecision({
          title: "Delete all saved decisions?",
          returnFocus: event?.currentTarget,
          description:
            "This removes every saved decision from this browser. Your working decision and exported files will not be deleted.",
          accept: "Delete all saved decisions",
        }))
      )
        return;
      let modernCleared = false;
      try {
        localStorage.removeItem(HISTORY_KEY);
        modernCleared = true;
        // Owner-confirmed partial deletion also changes the observed snapshot.
        // Reset before legacy cleanup, which can independently be denied.
        resetHistoryObservation();
        activeHistoryId = null;
        persistDraft();
        localStorage.removeItem(STORAGE_KEY);
        renderHistory({ schemaVersion: 1, entries: [] });
        announce("All saved decisions deleted from this browser.");
      } catch {
        if (modernCleared) {
          try { renderHistory(readHistory()); } catch (error) { showHistoryFailure(error); }
        }
        announce(
          modernCleared
            ? "Current-format saved decisions were cleared, but an earlier-format save could not be removed. Your working decision remains. Use Files and privacy to review or export the earlier save."
            : "Saved decisions could not be cleared. Use browser settings to remove site data.",
        );
      }
    });
  app
    .querySelector("[data-dm-import]")
    .addEventListener("change", async (event) => {
      const input = event.target,
        file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > 200000) throw new Error();
        const imported = parseDecision(await file.text());
        if (
          dirty &&
          !(await askDecision({
            title: "Import decision?",
            description:
              "This replaces your current unsaved work with the imported file. Your saved decisions and the original file stay unchanged.",
            accept: "Import decision",
            returnFocus: input,
          }))
        )
          return;
        state = validateDecision(imported);
        activeHistoryId = null;
        dirty = true;
        resumeComparison();
        optionIndex = 0;
        show();
        announce(
          "Decision imported into the current local draft. Named saved decisions are unchanged.",
        );
      } catch {
        announce(
          "Invalid decision file. Your current work has not changed. Use an exported EmTalk JSON file of 200,000 bytes or fewer.",
        );
      } finally {
        input.value = "";
      }
    });
  app.hidden = false;
  show(false);
  if(draftProblem)showDraftProblem();
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
