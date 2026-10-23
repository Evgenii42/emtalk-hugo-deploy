import {createWorkspaceState} from "./dm-workspace-state.js";
import {createWorkspaceSteps} from "./dm-workspace-steps.js";
import { createWorkspaceHistory } from "./dm-workspace-history.js";
import { createWorkspaceDom } from "./dm-workspace-dom.js";
import { createWorkspaceFeedback } from "./dm-workspace-feedback.js";
import { createWorkspaceDraft } from "./dm-workspace-draft.js";
import { createWorkspaceFiles, decisionExportFilename, enhanceDecisionImport } from "./dm-workspace-files.js";
export { decisionExportFilename } from "./dm-workspace-files.js";
import { createTrialAnalytics } from "./trial-analytics.js";
import { parseTopics } from "./dm-topics.js";
import { createDecisionDialog } from "./dm-dialog.js";
import {
  createDraft, parseDraft, serializeDraft,
  validateDecision,
  parseDecision,
  serializeDecision,
  parseHistory,
  recoverHistoryEntries,
} from "./dm-model.js";

import {
  STORAGE_KEY,
  HistoryProblem,
  createHistoryStorage,
  createDraftStorage,
} from "./dm-storage.js";

const DRAFT_DEBOUNCE_MS = 200;
const DECISION_IMPORT_MAX_BYTES = 200000;
const DRAFT_BACKUP_MAX_BYTES = 220000;
const RECOVERY_BACKUP_NOTICE = "Raw draft and history backups are recovery-only files. They are not individual decision JSON files and cannot be opened with Import JSON, regardless of size. Use Export working decision for a decision copy; Import JSON accepts up to 200,000 bytes.";

export function createIdGenerator(cryptoSource = globalThis.crypto) {
  const randomPart = () => {
    if (typeof cryptoSource?.randomUUID === "function") {
      try {
        const value = cryptoSource.randomUUID().split("-").join("");
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
function init() {
  const app = document.querySelector("[data-dm-app]");
  if (!app) return;
  const trial = createTrialAnalytics("dm");
  const dom = createWorkspaceDom(document, {mountPrefix:document.documentElement.dataset.mountPrefix || ""});
  const {node,button,heading} = dom;
  const screen = app.querySelector("[data-dm-screen]"),
    status = app.querySelector("[data-dm-status]"),
    filesPanel = app.querySelector("[data-dm-files]");
  let exportSequence=0,topics=null;
  try{topics=parseTopics(document.getElementById("emtalk-dm-topics").textContent);}catch{/* Manual decisions remain available. */}
  const {announce,fail,clearError,validateVisibleFields}=createWorkspaceFeedback({app,screen,status,node});
  const work=createWorkspaceState({trial,onChanged:defer=>draftController.changed(defer),flush:()=>draftController.flush(),render:focus=>show(focus),announce,fail,validateVisibleFields});
  const hasDecisionWork=work.hasWork;
  const emptyDraftNotice = 'Ready for a new decision. Add an option to start; changes stay in this browser.';
  const flushDraft = () => draftController.flush();
  const persistDraft = () => draftController.persist();

  const { readHistory, writeHistory, resetHistoryObservation } = createHistoryStorage({
    getStorage: () => globalThis.localStorage,
    parseHistory,
    parseDecision,
  });
  const draftStore = createDraftStorage({getStorage: () => globalThis.localStorage, parseDraft, serializeDraft});
  const draftController = createWorkspaceDraft({
    store:draftStore,
    snapshot:()=>{const {decision,pairIndex,optionIndex,activeHistoryId}=work.read();return createDraft(decision,{
      pairIndex:Math.max(0,Math.min(pairIndex,decision.pairs.length-1)),
      optionIndex:Math.max(0,Math.min(optionIndex,decision.selected.length-1)),savedEntryId:activeHistoryId,
    });},
    signature:value=>serializeDraft({...value,savedAt:0}),
    onSaved:()=> {
      app.querySelector('[data-dm-draft-notice]').textContent = hasDecisionWork() ? 'Draft saved in this browser only. Your decision text is not uploaded.' : emptyDraftNotice;
      app.querySelector('[data-dm-draft-recovery]').hidden = true;
      app.querySelector('[data-dm-action="retry-draft"]').hidden = true;
    },
    onProblem:showDraftProblem, delay:DRAFT_DEBOUNCE_MS,
  });
  draftController.restore(work.restoreDraft);
  const id = createIdGenerator();
  const {download} = createWorkspaceFiles({document,node,announce,fail,recoveryNotice:RECOVERY_BACKUP_NOTICE,importLimitBytes:DECISION_IMPORT_MAX_BYTES});
  function disableWorkspace() {
    trial.failed("required_capability_failed");
    trial.replacement();
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
    const exportCopy = (label, decision, entryId = work.read().activeHistoryId) => {
      screen.append(
        button(label, () => {
          try {
            download(
              serializeDecision(decision),
              "application/json",
              exportName("decision", entryId),
            );
          } catch {
            fail(
              "This decision could not be exported. Your saved data has not changed.",
            );
          }
        }),
      );
    };
    if(work.read().decision.options.length)exportCopy("Export current decision JSON",work.read().decision);
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
    fail(
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
    steps.render();
    const {decision,dirty}=work.read();
    if(!draftController.suppressed&&(dirty||draftController.resumed||decision.options.length||decision.title))persistDraft();
    if (focus) {
      const title = screen.querySelector("[data-step-heading]");
      title?.focus({ preventScroll: true });
      app.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }
  const askBaseDecision = createDecisionDialog({
    dialog: document.querySelector("[data-dm-dialog]"),
    announce: fail,
  });

  const navButtons = [...app.querySelectorAll('.dm-workspace__nav button')];
  function setNavigation(view) {
    for(const item of navButtons) {
      const current = item.dataset.dmView || 'saved';
      item.removeAttribute('aria-pressed');
      if(current===view)item.setAttribute('aria-current','true');
      else item.removeAttribute('aria-current');
    }
  }
  function askDecision(options) { flushDraft(); return askBaseDecision(options); }
  function validateWorkingFields() {
    if(screen.querySelector('[data-dm-pending-edit], [aria-invalid="true"]')) {
      // Reveal the existing controls without rebuilding away uncommitted text.
      screen.hidden=false;historyPanel.hidden=true;filesPanel.hidden=true;
      setNavigation('decision');
    }
    return validateVisibleFields();
  }
  app.querySelector('[data-dm-view="decision"]').addEventListener('click',()=>{if(!validateWorkingFields())return;announce('');show();});
  app.querySelector('[data-dm-view="files"]').addEventListener('click',()=>{
    if(!validateWorkingFields())return;
    flushDraft();
    announce('');screen.hidden=true;historyPanel.hidden=true;filesPanel.hidden=false;
    setNavigation('files');filesPanel.querySelector('h2').focus({preventScroll:true});app.scrollIntoView({block:'start',behavior:'auto'});
  });
  app.querySelector('[data-dm-draft-notice]').textContent = draftController.resumed
    ? hasDecisionWork() ? 'Draft resumed. Changes save in this browser only.' : emptyDraftNotice
    : 'Local draft: changes save in this browser only.';
  function showDraftProblem() {
    const draftProblem = draftController.problem;
    const panel = app.querySelector('[data-dm-draft-recovery]');
    app.querySelector('[data-dm-action="retry-draft"]').hidden = !draftController.canRetry;
    panel.hidden = false;
    panel.replaceChildren(node('h3', {}, ['Your working decision is still here']), node('p', {}, [
      draftProblem?.kind === 'corrupt' || draftProblem?.kind === 'conflict'
        ? 'Another draft could not be restored safely or changed in another tab. It has not been overwritten. Export your work before deciding whether to delete the stored draft.'
        : draftController.canRetry
          ? 'Automatic draft saving is paused. Keep this tab open or export your working decision. Once browser storage is available, choose Retry saving. A changed stored draft will not be overwritten.'
          : 'This draft could not be saved safely. Keep this tab open or export your working decision, and review the recovery options before changing stored data.'
    ]));
    app.querySelector('[data-dm-draft-notice]').textContent = 'Draft not saved automatically. Your working decision remains available for export.';
    panel.append(button('Export working decision', () => download(serializeDecision(work.read().decision), 'application/json', exportName())));
    if (typeof draftProblem?.raw === 'string' && new TextEncoder().encode(draftProblem.raw).length <= DRAFT_BACKUP_MAX_BYTES) {
      panel.append(button('Download raw draft backup', () => download(draftProblem.raw, 'text/plain;charset=utf-8', 'emtalk-dm-draft-backup.txt')));
    } else if (typeof draftProblem?.raw === 'string') {
      panel.append(node('p', {}, ['A raw draft backup is unavailable here because this stored draft exceeds the 220,000-byte recovery limit. The stored bytes have not been changed.']));
    }
    panel.append(node('p', {class:'dm-workspace__notice'}, [RECOVERY_BACKUP_NOTICE]));
    panel.append(button('Delete current draft', deleteCurrentDraft));
    fail('Automatic draft saving could not be completed. Your working decision is still here; review the recovery options.');
  }
  app.querySelector('[data-dm-action="retry-draft"]').addEventListener('click', event => {
    if (!validateWorkingFields()) return;
    const retry = event.currentTarget;
    retry.disabled = true;
    try {
      if (draftController.retry()) {
        announce('Draft saved in this browser. Automatic saving is available again.');
        app.querySelector('[data-dm-draft-notice]').focus({preventScroll:true});
      }
    } finally { retry.disabled = false; }
  });
  async function deleteCurrentDraft(event) {
    if (!(await askDecision({title:'Delete current draft?', description:'This deletes only the automatically saved draft from this browser. Your working decision, named saves and exported files remain. New edits start a new local draft.', accept:'Delete current draft', returnFocus:event?.currentTarget}))) return;
    const draftProblem = draftController.problem;
    if (draftController.remove(typeof draftProblem?.raw === 'string' ? {expectedRaw:draftProblem.raw} : {})) {
      app.querySelector('[data-dm-draft-recovery]').hidden = true;
      app.querySelector('[data-dm-action="retry-draft"]').hidden = true;
      app.querySelector('[data-dm-draft-notice]').textContent = 'Current draft deleted. New edits will save a new draft in this browser.';
      announce('Current draft deleted. Named saved decisions are unchanged.');
    }
  }
  app.querySelector('[data-dm-action="delete-draft"]').addEventListener('click', deleteCurrentDraft);
  function exportName(kind = "decision", entryId = work.read().activeHistoryId) {
    return decisionExportFilename(kind, entryId, Date.now(), ++exportSequence);
  }
  const historyPanel = app.querySelector("[data-dm-history]");
  createWorkspaceHistory({
    app,screen,filesPanel,historyPanel,dom,
    storage:{readHistory,writeHistory,resetHistoryObservation},
    work:{
      read:work.read,
      flush:flushDraft,newId:prefix=>id(prefix),unavailable:disableWorkspace,
      restore:(restored,savedId)=>work.replace(restored,{savedId,dirty:false,resume:true}),
      saved:work.saved,
      forgetSaved:savedId=>{if(work.forgetSaved(savedId))persistDraft();},
    },
    ui:{show,setNavigation,askDecision,announce,fail,validateVisibleFields:validateWorkingFields},files:{download,exportName},recoveryNotice:RECOVERY_BACKUP_NOTICE,
  });
  const importControl=enhanceDecisionImport(app.querySelector('.dm-workspace__import'));
  app.querySelector("[data-dm-import]").addEventListener("input", event => clearError(event.currentTarget));
  app
    .querySelector("[data-dm-import]")
    .addEventListener("change", async (event) => {
      const input = event.target,
        file = input.files?.[0];
      if (!file) return;
      importControl.selected(file);
      let outcome="canceled";
      try {
        clearError(input);
        if (file.size > DECISION_IMPORT_MAX_BYTES) throw new Error();
        const imported = parseDecision(await file.text());
        if (
          work.read().dirty &&
          !(await askDecision({
            title: "Import decision?",
            description:
              "This replaces your current unsaved work with the imported file. Your saved decisions and the original file stay unchanged.",
            accept: "Import decision",
            returnFocus: input,
          }))
        )
          return;
        const accepted = validateDecision(imported);
        work.replace(accepted,{dirty:true,resume:true});
        show();
        outcome="imported";
        announce(
          "Decision imported into the current local draft. Named saved decisions are unchanged.",
        );
      } catch {
        outcome="error";
        fail(
          "Invalid decision file. Your current work has not changed. Use an individual exported EmTalk decision JSON file of 200,000 bytes or fewer. Raw draft/history backups are recovery-only and cannot be imported.", input,
        );
      } finally {
        input.value = "";
        importControl.finished(outcome);
      }
    });
  const steps=createWorkspaceSteps({app,screen,dom,work,id,disableWorkspace,download,exportName,topics,
    ui:{show,announce,fail,clearError,validateVisibleFields,askDecision,flushDraft},
  });
  window.addEventListener("pagehide", flushDraft);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushDraft(); });
  app.hidden = false;
  show(false);
  if(draftController.problem)showDraftProblem();
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
