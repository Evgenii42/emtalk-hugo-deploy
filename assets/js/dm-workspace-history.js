import { serializeDecision, validateDecision, recoverHistoryEntries, putHistory, MAX_HISTORY } from "./dm-model.js";
import { HistoryProblem, STORAGE_KEY, HISTORY_KEY } from "./dm-storage.js";

// Named-save persistence and its recovery UI. Working decision/generation commits
// remain coordinator-owned; all accepted writes still use the observed-byte adapter.
export function createWorkspaceHistory({app,screen,filesPanel,historyPanel,dom,storage,work,ui,files,recoveryNotice,
  getStorage = () => globalThis.localStorage}) {
  const {node,button,actions} = dom;
  const {readHistory,writeHistory,resetHistoryObservation} = storage;
  const {show,setNavigation,askDecision,announce,fail} = ui;
  const {download,exportName} = files;
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
            "The stored data exceeds the recovery limit (2,000,000 bytes for history or 200,000 bytes for an earlier individual save), or cannot be inspected. It was not parsed, exported or changed. Use your browser's site-data tools to keep a copy.",
          ]),
        );
      }
      historyPanel.append(node("p", {class:"dm-workspace__notice"}, [recoveryNotice]));
      filesPanel.hidden=true;setNavigation("saved");screen.hidden=true;historyPanel.hidden = false;
      fail(
        "Saved data could not be read safely. Nothing was saved or changed. Export JSON keeps your current working decision; recovery exports are below.",
      );
    } else {
      const message =
        (error instanceof HistoryProblem && error.kind === "conflict"
          ? "Saved decisions changed in another tab. They were not overwritten; review the latest saves and try again. "
          : error instanceof HistoryProblem && error.kind === "quota"
          ? "This browser's storage is full. "
          : "This browser could not read or write saved decisions. ") +
        (saving ? "This decision was not saved. " : "The requested change could not be completed. ") +
        "Your working decision is still here. Use Export JSON to keep a copy.";
      historyPanel.replaceChildren(
        node("h2", { tabindex: "-1" }, ["Saved decisions could not be loaded or changed"]),
        node("p", { class: "dm-workspace__notice" }, [message]),
        actions([
          button("Back to decision", () => { announce(""); show(); }),
          button("Reload saved decisions", () => {
            try { renderHistory(readHistory(), true); announce("Saved decisions reloaded. Nothing was saved or deleted."); }
            catch (retryError) { showHistoryFailure(retryError); }
          }),
          button("Export working decision", () => download(serializeDecision(work.read().decision), "application/json", exportName())),
          button("Files and privacy", () => app.querySelector('[data-dm-view="files"]').click()),
        ]),
      );
      filesPanel.hidden = true;
      screen.hidden = true;
      historyPanel.hidden = false;
      setNavigation("saved");
      historyPanel.querySelector("h2").focus({ preventScroll: true });
      app.scrollIntoView({ block: "start", behavior: "auto" });
      fail(message);
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
            fail(
              "That saved decision no longer exists. Refresh Saved decisions.",
            );
            return;
          }
          if (
            work.read().dirty &&
            !(await askDecision({
              title: "Open saved decision?",
              returnFocus: event?.currentTarget,
              description:
                "This replaces your current unsaved work with the saved decision. Existing saved decisions and exported files stay unchanged.",
              accept: "Open saved decision",
            }))
          )
            return;
          const restored = validateDecision(fresh.decision);
          work.restore(restored, fresh.id);
          show();
          announce("Saved decision restored: " + name);
        } catch (error) {
          if (error instanceof HistoryProblem) return showHistoryFailure(error);
          fail(
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
          work.forgetSaved(entry.id);
          renderHistory(history, true);
          (
            historyPanel.querySelector("button") ||
            app.querySelector('[data-dm-action="restore"]')
          )?.focus();
          announce("Saved decision deleted.");
        } catch (error) {
          if (error instanceof HistoryProblem) return showHistoryFailure(error);
          fail(
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
    if (open) { filesPanel.hidden=true;setNavigation("saved");screen.hidden=true;historyPanel.hidden=false;historyPanel.querySelector("h2")?.focus({preventScroll:true});app.scrollIntoView({block:"start",behavior:"auto"}); }
  }
  async function saveDecision(asNew, trigger) {
    work.flush();
    let history;
    try {
      history = readHistory();
    } catch (error) {
      showHistoryFailure(error, true);
      return;
    }
    if ((asNew || !work.read().activeHistoryId) && history.entries.length >= MAX_HISTORY) {
      fail(
        "This browser has 20 saved decisions. Export and delete one before saving a new decision.",
      );
      return;
    }
    const enteredName =
      asNew || !work.read().decision.title.trim()
        ? await askDecision({
            title: "Save a decision",
            returnFocus: trigger,
            description:
              "Choose a name to find this decision in this browser later. Your decision text stays in this browser.",
            accept: "Save decision",
            name: work.read().decision.title,
          })
        : work.read().decision.title;
    if (enteredName === null) return;
    const name = enteredName.trim();
    if (!name || name.length > 160) {
      fail("Use a nonempty decision name of up to 160 characters.");
      return;
    }
    let saved;
    try {
      saved = validateDecision({ ...work.read().decision, title: name });
    } catch {
      fail(
        "This decision contains invalid options or reasons and was not saved. Check the working decision before exporting it.",
      );
      return;
    }
    const replacing = !asNew && work.read().activeHistoryId !== null;
    const entryId = replacing ? work.read().activeHistoryId : work.newId("d");
    if (entryId === null) return work.unavailable();
    const entry = {
      id: entryId,
      savedAt: Date.now(),
      decision: saved,
    };
    let next;
    try {
      // Reuse the reviewed snapshot. writeHistory still checks current stored
      // bytes immediately before writing, including changes during the dialog.
      next = putHistory(history, entry, replacing);
    } catch (error) {
      if (error instanceof HistoryProblem) showHistoryFailure(error, true);
      else
        fail(
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
    work.saved(saved, entry.id);
    show(false);
    renderHistory(next);
    announce(
      "Saved on this device: " +
        name +
        ". Your decision text was not uploaded." +
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
      download(serializeDecision(work.read().decision), "application/json", exportName());
    } catch {
      fail(
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
        getStorage().removeItem(HISTORY_KEY);
        modernCleared = true;
        // Owner-confirmed partial deletion also changes the observed snapshot.
        // Reset before legacy cleanup, which can independently be denied.
        resetHistoryObservation();
        work.forgetSaved();
        getStorage().removeItem(STORAGE_KEY);
        renderHistory({ schemaVersion: 1, entries: [] });
        announce("All saved decisions deleted from this browser.");
      } catch {
        if (modernCleared) {
          try { renderHistory(readHistory()); } catch (error) { showHistoryFailure(error); }
        }
        fail(
          modernCleared
            ? "Current-format saved decisions were cleared, but an earlier-format save could not be removed. Your working decision remains. Use Files and privacy to review or export the earlier save."
            : "Saved decisions could not be cleared. Use browser settings to remove site data.",
        );
      }
    });
  return Object.freeze({showHistoryFailure,renderHistory,saveDecision});
}
