// Local file naming and bounded object-URL lifetime. No persistence or app state.
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
export function createWorkspaceFiles({document, node, announce, fail, recoveryNotice, importLimitBytes,
  URL = globalThis.URL, Blob = globalThis.Blob, schedule = globalThis.setTimeout}) {
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
      schedule(release, 60000);
    } catch {
      release();
      fail(
        "The download could not be prepared. Your working decision and saved data have not changed. Try exporting again or use another browser.",
      );
      return false;
    } finally {
      a?.remove();
    }
    announce(
      type.startsWith("text/plain") ? recoveryNotice
      : type === "application/json" && new TextEncoder().encode(content).length > importLimitBytes
        ? "Recovery copy prepared. This individual decision JSON exceeds the 200,000-byte Import JSON limit and cannot be re-imported here. Keep the copy safe; the working decision is unchanged."
      : type.startsWith("text/csv")
        ? "CSV download prepared in UTF-8 with an encoding marker for spreadsheet apps. Keep this file private if it contains personal notes."
        : "Download prepared. Keep this file private if it contains personal notes.",
    );
    return true;
  }
  return Object.freeze({download});
}

// Progressive English page control. The OS picker stays native and retains its
// own language. Missing enhancement nodes leave the labelled file input usable.
export function enhanceDecisionImport(container) {
  const input=container?.querySelector('[data-dm-import]');
  const trigger=container?.querySelector('[data-dm-import-trigger]');
  const status=container?.querySelector('[data-dm-import-filename]');
  const inert=Object.freeze({selected(){},finished(){}});
  if(!input||!trigger||!status)return inert;
  const originalTabIndex=input.getAttribute('tabindex');
  let selectedName='';
  trigger.addEventListener('click',()=>{
    try{input.click();}
    catch{
      container.removeAttribute('data-enhanced');trigger.hidden=true;
      if(originalTabIndex===null)input.removeAttribute('tabindex');else input.setAttribute('tabindex',originalTabIndex);
      status.textContent='The file chooser could not be opened. Use the standard file control below.';
    }
  });
  input.addEventListener('cancel',()=>{status.textContent='No file selected. Your current decision is unchanged.';});
  input.tabIndex=-1;container.setAttribute('data-enhanced','');trigger.hidden=false;status.hidden=false;
  return Object.freeze({
    selected(file){selectedName=file.name;trigger.removeAttribute('aria-invalid');status.textContent='Selected file: '+selectedName+'. Checking JSON...';},
    finished(outcome){
      if(outcome==='imported')status.textContent='Imported: '+selectedName+'.';
      else if(outcome==='canceled')status.textContent='Import canceled: '+selectedName+'. Your current decision is unchanged.';
      else{trigger.setAttribute('aria-invalid','true');status.textContent='Not imported: '+selectedName+'. Check the error message.';}
    },
  });
}
