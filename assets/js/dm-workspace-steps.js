import {createDecision,orderedResults,resultsCsv,MAX_OPTIONS} from "./dm-model.js";
import {MAX_REVIEW_OPTIONS} from "./dm-workspace-state.js";
const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const MAX_REASONS=120;

// Intra-step navigation never focuses a heading or scrolls the app to its top.
// Rebuilt controls keep their action identity; disabled endpoints use the first
// concrete choice instead. Browser focus may minimally reveal the target.
function focusPairAction(screen,direction){
  const action=screen.querySelector('[data-dm-pair-nav="'+direction+'"]');
  const target=action&&!action.disabled?action:screen.querySelector('input[name="comparison"]');
  target?.focus();
}

// Screen renderer ownership only: no storage adapter, file parsing or accepted
// model replacement lives here. work.read() is immutable; edits use its port.
export function createWorkspaceSteps(ports){
  const context={...ports,topicCategory:null};
  const renderers={options:showOptions,compare:showComparison,review:showReview,pros:showPros,results:showResults};
  return Object.freeze({render(){renderers[context.work.read().decision.step]?.(context);}});
}
  async function editOptions(context,event) {
    const {work,ui}=context;
    const {askDecision}=ui;

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
    work.editOptions();
  }
  function showOptions(context) {
    const {screen,work,id,disableWorkspace,dom,ui}=context;
    const {node,button,field,heading,aiEntry,availability}=dom;
    const {show,announce,fail,clearError,validateVisibleFields,flushDraft}=ui;
    const {decision:state,pairIndex,optionIndex}=work.read();

    screen.append(heading('What would you like to decide?'), aiEntry('Find options with AI'), availability());
    screen.append(topicCatalog(context));
    const naming = node('details', {}, [node('summary',{},['Name this decision (optional)'])]);
    const title = node('input', {type:'text', maxlength:160, 'aria-label':'Decision name', placeholder:'What are you deciding?'});
    title.value = state.title;
    title.addEventListener('input',()=>work.edit(current=>{current.decision.title=title.value;},{defer:true}));
    title.addEventListener('change', flushDraft);
    naming.append(field('Decision name',title)); screen.append(naming);
    const list = node('div', {class:'dm-workspace__option-list', 'aria-label':'Your options'});
    state.options.forEach((option,index) => {
      const input = node('input', {type:'text',maxlength:100,'aria-label':'Option '+(index+1)}); input.value=option.title;
      const errorId='dm-option-edit-error-'+index;
      const editError=node('span',{id:errorId,'data-dm-option-edit-error':'',role:'status','aria-live':'polite','aria-atomic':'true',hidden:''});
      function commitOption(defer) {
        const value=input.value.trim();
        const currentOption=work.read().decision.options.find(o=>o.id===option.id);
        const duplicate=work.read().decision.options.some(o=>o.id!==option.id && o.title.trim().toLowerCase()===value.toLowerCase());
        if(!value || duplicate) {
          const message=(duplicate?'This name is already used.':'Enter a nonempty option name.')+
            ' This edit has not been applied. The working decision keeps "'+currentOption.title+'" until you correct this field.';
          editError.textContent=message;editError.hidden=false;
          // Typing can pass through empty/duplicate names. Retain the last
          // valid model and describe the pending edit politely until commit.
          input.setAttribute('data-dm-pending-edit','');
          input.setAttribute('aria-describedby',errorId);
          if(defer) clearError(input);
          else fail(message,input);
          return;
        }
        editError.hidden=true;editError.textContent='';
        input.removeAttribute('data-dm-pending-edit');
        clearError(input);input.removeAttribute('aria-describedby');
        work.edit(current=>{current.decision.options.find(o=>o.id===option.id).title=value;},{defer});
      }
      input.addEventListener('change',()=>commitOption(false));
      input.addEventListener('input',()=>commitOption(true));
      const remove=button('\u00d7', () => {
        work.edit(current=>{current.decision.options=current.decision.options.filter(o=>o.id!==option.id);current.pairIndex=0;current.optionIndex=0;},{replacement:true});show(false);screen.querySelector('[data-new-option]')?.focus();announce('Option removed.');
      });
      remove.setAttribute('aria-label','Remove option '+(index+1));
      const optionField=field('Option '+(index+1),input);optionField.append(editError);
      list.append(node('div',{class:'dm-workspace__row'},[optionField,remove]));
    });
    screen.append(list);
    const form=node('form',{class:'dm-workspace__new-option'}),input=node('input',{type:'text',maxlength:100,required:'','data-new-option':'','aria-label':'New option',placeholder:state.options.length ? 'Another option...' : 'Enter your first option...'});
    input.addEventListener('input', () => { if(!input.value.trim() || !work.read().decision.options.some(o=>o.title.trim().toLowerCase()===input.value.trim().toLowerCase())) clearError(input); });
    input.addEventListener('invalid', () => fail('Enter a nonempty option before adding it.',input));
    const submit=node('button',{type:'submit'},['Add option']);
    if(state.options.length>=MAX_OPTIONS){input.disabled=true;submit.disabled=true;}
    form.append(field('Your options ('+state.options.length+'/8)',input),submit);
    form.addEventListener('submit',event=>{
      event.preventDefault();if(!validateVisibleFields())return;const value=input.value.trim();
      if(!value || work.read().decision.options.some(o=>o.title.trim().toLowerCase()===value.toLowerCase())){fail('Use a different, nonempty name for each option.',input);input.focus();return;}
      if(work.read().decision.options.length>=MAX_OPTIONS)return;
      const optionId=id('o');if(optionId===null)return disableWorkspace();
      work.edit(current=>{current.decision.options.push({id:optionId,title:value});},{replacement:true});show(false);screen.querySelector('[data-new-option]')?.focus();announce('Option added.');
    });
    screen.append(form);
    const start=button(state.options.length>MAX_REVIEW_OPTIONS?'Compare options':state.options.length?'Start pros and cons':'Add your options',()=>{
      if(!state.options.length){form.requestSubmit();return;}
      if (!validateVisibleFields()) return;
      // Commit any typed extra option explicitly; never silently discard it.
      if(input.value.trim()){fail('Add or clear the option you are typing before starting.',input);input.focus();return;}
      // Flush while the current options model is still valid, before selected
      // or pairs are assigned for the next step.
      work.start();
    },true);
    const add=button('+',()=>form.requestSubmit());add.className='dm-workspace__add';add.setAttribute('aria-label','Add option');add.disabled=state.options.length>=MAX_OPTIONS;
    screen.append(node('div',{class:'dm-workspace__bottom'},state.options.length?[start,add]:[start]));
  }
  function topicCatalog(context) {
    const {dom}=context;

    const rendered=dom.topicCatalog({topics:context.topics,categoryId:context.topicCategory,onTopic:topic=>showTopic(context,topic),onCategory:categoryId=>{
      context.topicCategory=categoryId;
    }});
    context.topicCategory=rendered.categoryId;return rendered.element;
  }
  function showTopic(context,topic) {
    const {app,screen,dom,work,id,disableWorkspace,ui}=context;
    const {heading}=dom;
    const {show,announce,fail,askDecision}=ui;

    const onApply = async (selectedTitles,event) => {
      if(selectedTitles.length<1 || selectedTitles.length>MAX_OPTIONS)return;
      if((work.read().decision.options.length || work.read().decision.title) && !(await askDecision({title:'Use this topic?',description:'This replaces the current decision name and options. Named saved decisions and exported files remain unchanged.',accept:'Use selected options',returnFocus:event.currentTarget})))return;
      const next=createDecision();next.title=topic.title;
      for(const title of selectedTitles){const optionId=id('o');if(optionId===null)return disableWorkspace();next.options.push({id:optionId,title});}
      work.replace(next,{persist:true});show();announce('Topic added. Edit the options or start your exercise.');
    };
    screen.replaceChildren(...dom.topicSelection({topic,maxOptions:MAX_OPTIONS,onApply,onBack:()=>show(),onLimit:fail}));
    screen.querySelector('[data-step-heading]').focus({preventScroll:true});app.scrollIntoView({block:'start',behavior:'auto'});
  }
  function showComparison(context) {
    const {screen,work,id,dom,ui}=context;
    const {node,button,heading,actions}=dom;
    const {announce}=ui;
    work.position({pairIndex:work.read().pairIndex});
    const transition=work.transition;
    const {decision:state,pairIndex}=work.read();

    // Imported/UI states require pairs; keep the renderer safe if a future
    // internal caller nevertheless supplies an empty comparison.
    if (!state.pairs.length) {
      transition("options");
      return;
    }
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
        value: winner,
      });
      radio.checked =
        hasOwn(state.answers, String(pairIndex)) &&
        state.answers[pairIndex] === winner;
      radio.addEventListener("change", () => {
        work.edit(current=>{current.decision.answers[pairIndex]=winner;});
        next.disabled = false;
        announce("Choice selected.");
      });
      choices.append(
        node("label", { class: "dm-workspace__choice" }, [
          radio,
          state.options.find((o) => o.id === winner).title,
        ]),
      );
    }
    const previous=button("Previous pair",()=>{if(work.previousPair())focusPairAction(screen,"previous");});
    previous.dataset.dmPairNav="previous";previous.disabled=pairIndex===0;
    const next=button(pairIndex<state.pairs.length-1?'Next pair':'Review comparison',()=>{if(work.nextPair())focusPairAction(screen,"next");},true);
    next.dataset.dmPairNav="next";
    next.disabled = !pair.includes(state.answers[pairIndex]);
    const card=node('div',{class:'dm-workspace__choice-card'},[choices]);
    if(hasOwn(state.answers,String(pairIndex)) && state.answers[pairIndex]===null)
      card.append(node('p',{class:'dm-workspace__legacy'},['This earlier saved pair was undecided. Choose one option to continue; the old answer is kept until you choose.']));
    screen.append(card,actions([previous,next,button('Edit options',event=>editOptions(context,event))]));
  }
  function showReview(context) {
    const {screen,work,id,dom,ui}=context;
    const {node,button,heading,actions}=dom;
    const {fail}=ui;
    const transition=work.transition;
    const {decision:state,optionIndex}=work.read();
    const resultTable=rows=>dom.resultTable(rows,{hasComparison:state.pairs.length>0,optionCount:state.options.length});

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
        if (input.checked && work.read().decision.selected.length >= MAX_REVIEW_OPTIONS) {
          input.checked = false;
          fail("Choose at most three options.");
          return;
        }
        const decision=work.read().decision;
        const chosen=input.checked?[...decision.selected,option.id]:decision.selected.filter(x=>x!==option.id);
        work.edit(current=>{current.decision.selected=orderedResults(current.decision).map(o=>o.id).filter(id=>chosen.includes(id));});
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
            if (!work.read().decision.selected.length)
              return fail("Choose one to three options first.");
            work.position({optionIndex:0});
            transition("pros", true);
          },
          true,
        ),
        button("Keep comparison results", () => transition("results", true)),
        button("Review pairs", () => transition("compare")),
      ]),
    );
  }
  function showPros(context) {
    const {screen,work,id,disableWorkspace,dom,ui}=context;
    const {node,button,field,heading,actions,prioritySelect,aiNotice}=dom;
    const {show,announce,fail,clearError,validateVisibleFields}=ui;
    work.position({optionIndex:work.read().optionIndex});
    const transition=work.transition;
    const {decision:state,optionIndex}=work.read();

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
        work.position({optionIndex:i});
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
          if (!input.value.trim() || work.read().decision.opinions.some(n=>n.id!==note.id && n.optionId===option.id && n.text.trim().toLowerCase()===input.value.trim().toLowerCase())) {
            fail("Use a nonempty reason that is different from the other reasons for this option.", input);
          } else {
            clearError(input);
            work.edit(current=>{current.decision.opinions.find(n=>n.id===note.id).text=input.value.trim();});
          }
        });
        input.addEventListener('input', () => {
          const value=input.value.trim();
          if(value && !work.read().decision.opinions.some(n=>n.id!==note.id && n.optionId===option.id && n.text.trim().toLowerCase()===value.toLowerCase())){clearError(input);work.edit(current=>{current.decision.opinions.find(n=>n.id===note.id).text=value;},{defer:true});}
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
          work.edit(current=>{current.decision.opinions.find(n=>n.id===note.id).priority=Number(priority.value);});show(false);screen.querySelector('[data-dm-note-id="'+note.id+'"]')?.parentElement.querySelector("select")?.focus();
        });
        section.append(
          node("div", { class: "dm-workspace__note" }, [
            input,
            priority,
            button("Remove reason", () => {
              work.edit(current=>{current.decision.opinions=current.decision.opinions.filter(x=>x.id!==note.id);});
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
      input.addEventListener("input", () => {
        const value = input.value.trim();
        if (!value || !work.read().decision.opinions.some(n => n.optionId === option.id && n.text.trim().toLowerCase() === value.toLowerCase())) clearError(input);
      });
      input.addEventListener("invalid", () => fail("Enter a nonempty reason before adding it.", input));
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
        if (!value) return fail("Enter a nonempty reason before adding it.", input);
        if (work.read().decision.opinions.some(n=>n.optionId===option.id && n.text.trim().toLowerCase()===value.toLowerCase())) return fail("This reason already exists for this option. Add a different reason.", input);
        if (work.read().decision.opinions.length >= MAX_REASONS)
          return fail(
            "This decision already has 120 reasons. Remove a reason before adding another.", input,
          );
        const reasonId = id("r");
        if (reasonId === null) return disableWorkspace();
        work.edit(current=>current.decision.opinions.push({
          id: reasonId,
          optionId: option.id,
          type,
          text: value,
          priority: Number(priority.value),
        }));
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
            if (!validateVisibleFields()) return;
            work.nextOption();
          },
          true,
        ),
        button(
          state.pairs.length ? "Choose options to review" : "Edit options",
          state.pairs.length ? () => transition("review") : event=>editOptions(context,event),
        ),
      ]),
      aiNotice(),
    );
  }
  function showResults(context) {
    const {screen,work,download,exportName,dom,ui}=context;
    const {node,button,heading,actions,aiNotice}=dom;
    const {askDecision}=ui;
    const transition=work.transition;
    const {decision:state}=work.read();
    const resultTable=rows=>dom.resultTable(rows,{hasComparison:state.pairs.length>0,optionCount:state.options.length});

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
          const token = work.capture();
          if (
            await askDecision({
              title: "Start a new decision?",
              returnFocus: event?.currentTarget,
              description:
                "This replaces the current working decision. Your saved decisions and exported files will not be deleted.",
              accept: "Start new decision",
            })
          ) {
            work.reset(token);
          }
        }),
      ]),
      aiNotice(),
    );
  }
