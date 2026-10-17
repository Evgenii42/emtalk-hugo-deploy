import { createDecisionDialog } from "./dm-dialog.js";
import {
  createDecision,
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
    status = app.querySelector("[data-dm-status]");
  let activeHistoryId = null,
    exportSequence = 0;
  let state = createDecision(),
    pairIndex = 0,
    optionIndex = 0,
    dirty = false;
  const announce = (message) => {
    status.textContent = message;
  };
  const changed = () => {
    dirty = true;
  };
  const { readHistory, writeHistory } = createHistoryStorage({
    getStorage: () => globalThis.localStorage,
    parseHistory,
    parseDecision,
  });
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
    screen.replaceChildren();
    if (state.step === "options") showOptions();
    if (state.step === "compare") showComparison();
    if (state.step === "review") showReview();
    if (state.step === "pros") showPros();
    if (state.step === "results") showResults();
    if (focus) {
      const title = screen.querySelector("[data-step-heading]");
      title?.focus({ preventScroll: true });
      title?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  function transition(step) {
    state.step = step;
    if (step === "compare") resumeComparison();
    changed();
    announce("");
    show();
  }
  const askDecision = createDecisionDialog({
    dialog: document.querySelector("[data-dm-dialog]"),
    announce,
  });

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
    screen.append(heading("1. What are you deciding?"));
    const title = node("input", {
      type: "text",
      maxlength: 160,
      "aria-label": "Decision name",
      placeholder: "For example: choosing a work arrangement",
    });
    title.value = state.title;
    title.addEventListener("input", () => {
      state.title = title.value;
      changed();
    });
    screen.append(field("Decision name (optional)", title));
    const list = node("div", { "aria-label": "Your options" });
    state.options.forEach((option, index) => {
      const input = node("input", {
        type: "text",
        maxlength: 100,
        "aria-label": "Option " + (index + 1),
      });
      input.value = option.title;
      input.addEventListener("change", () => {
        const value = input.value.trim();
        if (
          !value ||
          state.options.some(
            (o) =>
              o.id !== option.id &&
              o.title.trim().toLowerCase() === value.toLowerCase(),
          )
        ) {
          input.value = option.title;
          announce("Use a different, nonempty name for each option.");
          return;
        }
        option.title = value;
        changed();
      });
      const remove = button("Remove", () => {
        state.options = state.options.filter((o) => o.id !== option.id);
        // Strict options-phase states already have no derived comparison data.
        // Reassert that invariant defensively when the option set changes.
        state.pairs = [];
        state.answers = {};
        state.selected = [];
        state.opinions = [];
        pairIndex = 0;
        optionIndex = 0;
        changed();
        show(false);
        screen.querySelector("[data-new-option]")?.focus();
      });
      remove.setAttribute("aria-label", "Remove option " + (index + 1));
      list.append(
        node("div", { class: "dm-workspace__row" }, [
          field("Option " + (index + 1), input),
          remove,
        ]),
      );
    });
    screen.append(list);
    const form = node("form"),
      input = node("input", {
        type: "text",
        maxlength: 100,
        required: "",
        "data-new-option": "",
        "aria-label": "New option",
      });
    const add = node("button", { type: "submit" }, ["Add option"]);
    if (state.options.length >= MAX_OPTIONS) {
      add.disabled = true;
      input.disabled = true;
    }
    form.append(
      field("Add an option (" + state.options.length + "/8)", input),
      add,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (
        !value ||
        state.options.some(
          (o) => o.title.trim().toLowerCase() === value.toLowerCase(),
        )
      ) {
        announce("Use a different, nonempty name for each option.");
        return;
      }
      if (state.options.length >= MAX_OPTIONS) return;
      const optionId = id("o");
      if (optionId === null) return disableWorkspace();
      state.options.push({ id: optionId, title: value });
      changed();
      announce("Option added.");
      show(false);
      screen.querySelector("[data-new-option]")?.focus();
    });
    screen.append(
      form,
      actions([
        button(
          "Start with these options",
          () => {
            if (!state.options.length) {
              announce("Add at least one option to begin.");
              input.focus();
              return;
            }
            if (state.options.length > 3) {
              state.pairs = makePairs(state.options);
              pairIndex = 0;
              transition("compare");
            } else {
              state.selected = state.options.map((o) => o.id);
              optionIndex = 0;
              transition("pros");
            }
          },
          true,
        ),
      ]),
      aiNotice(),
    );
  }
  function showComparison() {
    // Imported/UI states require pairs; keep the renderer safe if a future
    // internal caller nevertheless supplies an empty comparison.
    if (!state.pairs.length) {
      transition("options");
      return;
    }
    pairIndex = Math.max(0, Math.min(state.pairs.length - 1, pairIndex));
    screen.append(heading("2. Compare your options"));
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
        node("legend", {}, ["Choose an option or leave this pair undecided"]),
      ]);
    for (const winner of [...pair, null]) {
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
        announce("Answer saved in this working decision.");
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
    screen.append(
      choices,
      actions([
        previous,
        button(
          pairIndex < state.pairs.length - 1
            ? "Next pair"
            : "Review comparison",
          () => {
            if (!Object.hasOwn(state.answers, String(pairIndex))) {
              announce("Choose an option or Leave undecided.");
              return;
            }
            if (pairIndex < state.pairs.length - 1) {
              pairIndex++;
              show();
            } else {
              const missing = state.pairs.findIndex(
                (_, i) => !Object.hasOwn(state.answers, String(i)),
              );
              if (missing >= 0) {
                pairIndex = missing;
                announce("Answer this remaining pair.");
                show();
              } else transition("review");
            }
          },
          true,
        ),
        button("Edit options", editOptions),
      ]),
    );
  }
  function resultTable(rows) {
    const table = node("table"),
      head = node(
        "tr",
        {},
        ["Option", "Pairwise wins", "Pairwise /100", "Pros and cons /100"].map(
          (x) => node("th", { scope: "col" }, [x]),
        ),
      );
    table.append(node("thead", {}, [head]));
    const body = node("tbody");
    for (const r of rows)
      body.append(
        node("tr", {}, [
          node("th", { scope: "row" }, [r.title]),
          ...[
            state.pairs.length ? String(r.wins) : "Not used",
            r.comparison == null ? "Not used" : String(r.comparison),
            r.prosCons == null ? "Not reviewed" : String(r.prosCons),
          ].map((x) => node("td", {}, [x])),
        ]),
      );
    table.append(body);
    return node(
      "div",
      {
        class: "dm-workspace__table-wrap",
        role: "region",
        "aria-label": "Decision scores",
        tabindex: "0",
      },
      [table],
    );
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
    for (const option of state.options) {
      const input = node("input", { type: "checkbox", value: option.id });
      input.checked = state.selected.includes(option.id);
      input.addEventListener("change", () => {
        if (input.checked && state.selected.length >= 3) {
          input.checked = false;
          announce("Choose at most three options.");
          return;
        }
        state.selected = input.checked
          ? [...state.selected, option.id]
          : state.selected.filter((x) => x !== option.id);
        changed();
      });
      choices.append(
        node("label", { class: "dm-workspace__choice" }, [input, option.title]),
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
  function aiNotice() {
    return node("p", { class: "dm-workspace__notice" }, [
      "Want AI assistance with ideas or a summary? It is available in the DM app. Web support is coming later. ",
      node(
        "a",
        {
          href: "https://play.google.com/store/apps/details?id=org.emtalk.dm",
          target: "_blank",
          rel: "noopener noreferrer",
        },
        ["View the DM app on Google Play"],
      ),
    ]);
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
      );
      if (!notes.length)
        section.append(node("p", {}, ["No reasons added yet."]));
      notes.forEach((note, i) => {
        const input = node("textarea", {
          maxlength: 400,
          "aria-label": (type === "pros" ? "Pro " : "Con ") + (i + 1),
        });
        input.value = note.text;
        input.addEventListener("change", () => {
          if (!input.value.trim()) {
            input.value = note.text;
            announce("A reason cannot be empty. Use Remove reason instead.");
          } else {
            note.text = input.value.trim();
            changed();
          }
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
          changed();
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
          3,
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
      historyPanel.hidden = false;
      announce(
        "Saved data could not be read safely. Nothing was saved or changed. Export JSON keeps your current working decision; recovery exports are below.",
      );
    } else {
      announce(
        (error instanceof HistoryProblem && error.kind === "quota"
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
      node("h2", {}, [
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
          if (activeHistoryId === entry.id) activeHistoryId = null;
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
    if (open) historyPanel.hidden = false;
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
          ? " The earlier local save was retained on this device."
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
      try {
        localStorage.removeItem(HISTORY_KEY);
        localStorage.removeItem(STORAGE_KEY);
        activeHistoryId = null;
        renderHistory({ schemaVersion: 1, entries: [] });
        announce("All saved decisions deleted from this browser.");
      } catch {
        announce(
          "This browser could not clear its storage. Use browser settings to remove site data.",
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
          "Decision imported. It has not been saved on this device yet.",
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
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
