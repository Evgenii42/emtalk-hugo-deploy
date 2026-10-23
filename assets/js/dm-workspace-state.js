import {
  createDecision,makePairs,validateDecision
} from "./dm-model.js";
export const MAX_REVIEW_OPTIONS=3;
const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const copy=value=>JSON.parse(JSON.stringify(value));
function freeze(value){
  for(const child of Object.values(value))if(child&&typeof child==="object")freeze(child);
  return Object.freeze(value);
}
// Sole owner of the working model, cursors and accepted-generation transitions.
// read() gives a cached immutable projection. Only synchronous edit() callbacks
// receive a private edit copy, committed only after synchronous completion.
// Retained callback references cannot mutate accepted state after commit.
// Persistence is an injected port, never owned here.
export function createWorkspaceState({
  trial,onChanged,flush,render,announce,fail,validateVisibleFields
}) {
  let current={
    decision:createDecision(),pairIndex:0,optionIndex:0,dirty:false,activeHistoryId:null
  };
  let projection=null;
  const read=()=>projection||(projection=freeze(copy(current)));
  const invalidate=()=>{
    projection=null;
  };
  const hasWork=()=>Boolean(current.decision.title.trim()||current.decision.options.length||current.decision.pairs.length||Object.keys(current.decision.answers).length||current.decision.selected.length||current.decision.opinions.length||current.decision.step!=="options");
  function changed(defer=false){
    current.dirty=true;
    invalidate();
    onChanged(defer);
  }
  function edit(action,{
    defer=false,replacement=false
  }={}){
    if(replacement)trial.replacement();
    const next=copy(current);
    const outcome=action(next);
    if(outcome&&typeof outcome.then==="function")throw new TypeError("Workspace edits must be synchronous.");
    current=copy(next);
    changed(defer);
  }
  function position(update={}){
    if(hasOwn(update,"pairIndex"))current.pairIndex=Math.max(0,Math.min(update.pairIndex,current.decision.pairs.length-1));
    if(hasOwn(update,"optionIndex"))current.optionIndex=Math.max(0,Math.min(update.optionIndex,current.decision.selected.length-1));
    invalidate();
  }
  function resumeComparison(){
    const decision=current.decision,missing=decision.step==="compare"?decision.pairs.findIndex((_,i)=>!hasOwn(decision.answers,String(i))):-1;
    current.pairIndex=missing<0?0:missing;
    invalidate();
  }
  function replace(decision,{
    savedId=null,dirty=true,pairIndex=0,optionIndex=0,resume=false,persist=false,completed=decision.step==="results"
  }={}){
    trial.replacement({
      unfinished:["compare","pros","review"].includes(decision.step),completed
    });
    current={
      decision:copy(decision),pairIndex,optionIndex,activeHistoryId:savedId,dirty
    };
    invalidate();
    if(resume)resumeComparison();
    if(persist)changed();
  }
  function restoreDraft(draft){
    replace(draft.decision,{
      savedId:draft.savedEntryId,pairIndex:draft.pairIndex,optionIndex:draft.optionIndex,dirty:false
    });
    current.dirty=hasWork();
    invalidate();
  }
  function transition(step,advance=false){
    if(advance&&!validateVisibleFields())return;
    flush();
    const token=trial.capture();
    let valid=false;
    if(advance){
      try{
        validateDecision({
          ...current.decision,step
        });
        valid=true;
      }catch{
        /* Product validation/recovery remains authoritative. */
      }
    }
    current.decision.step=step;
    if(step==="compare")resumeComparison();
    changed();
    announce("");
    try{
      render();
    }catch(error){
      trial.failed("runtime_failed",token);
      throw error;
    }
    if(valid){
      trial.advance(token);
      if(step==="results")trial.completed(token);
    }
  }
  function start(){
    flush();
    const token=trial.request(),decision=current.decision;
    if(decision.options.length>MAX_REVIEW_OPTIONS){
      decision.pairs=makePairs(decision.options);
      current.pairIndex=0;
      transition("compare");
    }
    else{
      decision.selected=decision.options.map(option=>option.id);
      current.optionIndex=0;
      transition("pros");
    }
    if(["compare","pros"].includes(current.decision.step)){
      try{
        validateDecision(current.decision);
        trial.started(token);
      }catch{
        trial.failed("runtime_failed",token);
      }
    }
  }
  function editOptions(){
    trial.replacement();
    current.decision.pairs=[];
    current.decision.answers={};
    current.decision.selected=[];
    current.decision.opinions=[];
    transition("options");
  }
  function previousPair(){
    if(current.pairIndex===0)return false;
    current.pairIndex--;
    invalidate();
    render(false);
    return true;
  }
  function nextPair(){
    const decision=current.decision,pair=decision.pairs[current.pairIndex];
    if(!pair.includes(decision.answers[current.pairIndex])){
      fail("Choose one of the two options to continue.");
      return false;
    }
    const token=trial.capture();
    if(current.pairIndex<decision.pairs.length-1){
      current.pairIndex++;
      invalidate();
      render(false);
      trial.advance(token);
      return true;
    }
    const missing=decision.pairs.findIndex((entry,i)=>!entry.includes(decision.answers[i]));
    if(missing>=0){
      current.pairIndex=missing;
      invalidate();
      render(false);
      fail("Choose an option for this remaining pair.");
      return true;
    }
    transition("review",true);
    return false;
  }
  function nextOption(){
    if(!validateVisibleFields())return;
    const token=trial.capture();
    if(current.optionIndex<current.decision.selected.length-1){
      current.optionIndex++;
      invalidate();
      render();
      try{
        validateDecision(current.decision);
        trial.advance(token);
      }catch{
        /* Keep local work usable. */
      }
    }else transition("results",true);
  }
  function reset(token){
    trial.stopped(token);
    replace(createDecision(),{
      persist:true
    });
    render();
  }
  function saved(decision,savedId){
    replace(decision,{
      savedId,dirty:false,pairIndex:current.pairIndex,optionIndex:current.optionIndex,completed:trial.wasCompleted()||decision.step==="results"
    });
  }
  function forgetSaved(savedId){
    if(savedId===undefined||current.activeHistoryId===savedId){
      current.activeHistoryId=null;
      invalidate();
      return true;
    }return false;
  }
  return Object.freeze({
    read,capture:()=>trial.capture(),hasWork,edit,position,replace,restoreDraft,transition,start,editOptions,previousPair,nextPair,nextOption,reset,saved,forgetSaved
  });
}
