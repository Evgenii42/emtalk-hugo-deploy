// Each namespace owns different settings. Check the last observed value before
// writing so a stale practice tab cannot overwrite a newer choice.
export const practiceKey='emtalk.bret.preferences.v1';
export const journeyKey='emtalk.bret.journey.preferences.v1';

function preferenceSlot(key,notify) {
  let observed, readable=false, value=null;
  try {
    observed=localStorage.getItem(key);
    readable=true;
    if(observed!==null) value=JSON.parse(observed);
  } catch {
    notify('Saved settings could not be read. You can still use the practice.');
  }
  function current(){
    try {
      if(readable && localStorage.getItem(key)===observed) return true;
    } catch {}
    notify('Settings could not be saved. Reload the page to use the latest saved settings.');
    return false;
  }
  function write(next){
    if(!current())return false;
    try {
      const raw=next===null?null:JSON.stringify(next);
      if(raw!==observed){
        if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);
      }
      observed=raw;value=next;
      return true;
    } catch {
      notify('These settings work here, but could not be saved in this browser.');
      return false;
    }
  }
  function restore(raw,previous){
    if(!current())return;
    try{if(raw!==null)localStorage.setItem(key,raw);observed=raw;value=previous;}
    catch{notify('Only part of the saved settings could be restored. Reload to see what is saved.');}
  }
  return {get value(){return value;},get raw(){return observed;},current,write,restore};
}

export function sitePreferences(normalize,sanitize,query,notify){
  const legacy=preferenceSlot(practiceKey,notify), visual=preferenceSlot(journeyKey,notify);
  let settings=normalize(legacy.value), appearance=sanitize(visual.value);
  // Migrate existing Journey-only rhythm choices when no classic practice is saved.
  if(legacy.value===null && visual.value && Object.hasOwn(visual.value,'preset')){
    const old=appearance;
    settings=normalize({...settings,mode:old.preset==='custom'?'custom':'breathing',
      preset:old.preset,custom:old.custom,cycles:old.cycles,music:old.sound});
  }
  if(settings.mode==='pmr')settings={...settings,mode:'breathing'};
  if(query.get('mode')==='breathing'){
    const cycles=Number(query.get('cycles'));
    settings={...settings,mode:'breathing',preset:'4444',
      ...(Number.isInteger(cycles)&&cycles>=1&&cycles<=99?{cycles}:{})};
  }
  function view(){
    return {...appearance,preset:settings.mode==='custom'?'custom':settings.preset,
      custom:[...settings.custom],cycles:settings.cycles,sound:settings.music&&!settings.mute};
  }
  function saveAppearance(choice){
    const nextVisual={scene:choice.scene,character:choice.character,still:choice.still};
    const changed=Object.entries(nextVisual).some(([k,v])=>v!==appearance[k]);
    appearance={...appearance,...nextVisual};
    if(changed)visual.write({...((visual.value && typeof visual.value==='object')?visual.value:{}),...nextVisual});
  }
  function save(choice,sound){
    const next=normalize({...settings,...sound,mode:choice.preset==='custom'?'custom':'breathing',
      preset:choice.preset==='custom'?settings.preset:choice.preset,custom:choice.custom,cycles:choice.cycles});
    const changedPractice=JSON.stringify(next)!==JSON.stringify(normalize(legacy.value));
    settings=next;
    if(changedPractice)legacy.write(next);
    saveAppearance(choice);
  }
  function reset(){
    if(!legacy.current()||!visual.current())return false;
    // Only reset this product's two preference slots, keeping other Bret data.
    const previousRaw=legacy.raw,previousValue=legacy.value;
    if(!legacy.write(null))return false;
    if(!visual.write(null)){legacy.restore(previousRaw,previousValue);return false;}
    settings=normalize();appearance=sanitize();return true;
  }
  return {get settings(){return settings;},view,save,saveAppearance,reset};
}
