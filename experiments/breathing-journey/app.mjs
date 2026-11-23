import {Journey,sanitize,landscapeForCycle} from './model.mjs?v=jacket4';
import {JourneyScene,createVisualPacer} from './scene.mjs?v=jacket4';
import {sitePreferences} from './site-preferences.mjs';
import {MODEL_STYLES} from './runner-character.mjs?v=jacket4';

let fatal=false,stopFailedMedia=null;
function updateText(node,value){const text=String(value);if(node.textContent!==text)node.textContent=text;}
function updateAttribute(node,name,value){const text=String(value);if(node.getAttribute(name)!==text)node.setAttribute(name,text);}
function offerReload(text='The practice did not start. Select Try again to reload it.'){
 fatal=true;
 try{stopFailedMedia?.();}catch{}
 for(const dialog of document.querySelectorAll('dialog[open]')){try{dialog.close();}catch{}}
 const root=document.querySelector('.scene');root?.classList.add('text-mode');root?.classList.remove('loading-art');if(root)root.dataset.state='failed';
 const original=document.querySelector('[data-main]');if(!original)return;const retry=original.cloneNode(false);
 retry.textContent='Try again';retry.disabled=false;retry.setAttribute('aria-label','Reload practice');retry.addEventListener('click',()=>location.reload());original.replaceWith(retry);
 for(const control of document.querySelectorAll('button:not([data-main]),input,select'))control.disabled=true;
 const message=document.querySelector('[data-feedback]');message.hidden=false;message.textContent=text;
 retry.focus();
}
try{
const $=selector=>document.querySelector(selector);
const sceneRoot=$('.scene'),form=$('#settings-form'),main=$('[data-main]');
const storageKey='emtalk.bret.journey.preferences.v1';
const landscapes=['Morning Hills','Alpine Air','Night Forest Trail','Lilac Valley','Above the Clouds'];
const shortLandscapes=['Hills','Mountains','Forest','Valley','Clouds'];
const phaseNames=['Inhale','Hold','Exhale','Hold'];
const instructions=['Breathe in gently','Stay in this moment','Breathe out calmly','Rest before your next breath'];
const animationUnavailable='Animation is unavailable. Follow the phase label and timer to continue.';
const hints=['Let a little space open up around you.','Follow your chosen rhythm and stay comfortable.','Let go of the rush. There is still a little way to go.','The next step will come in its own time.'];
const clock=ms=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
const plural=(n,forms)=>forms[n===1?0:1];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let preferences=sanitize(),journey,renderKey='',frameHandle=0,announcement='',soundToken=0;
let settingsOpener=null,feedbackTimer=0,mountToken=0,recovering=false;
const sceneAttempts=new Map();
const visualPacer=createVisualPacer();
function feedback(text,transient=false){
 if(fatal)return;
 clearTimeout(feedbackTimer);const el=$('[data-feedback]');el.replaceChildren(document.createTextNode(text));el.hidden=!text;
 if(!text)return;
 const close=document.createElement('button');close.type='button';close.className='feedback-close';close.textContent='×';close.setAttribute('aria-label','Dismiss message');close.addEventListener('click',()=>{feedback('');document.querySelector('[data-main]')?.focus();});el.append(close);
 if(transient)feedbackTimer=setTimeout(()=>{if(!el.contains(document.activeElement))feedback('');},5000);
}
const entryURL=new URL(location.href);
const siteModule=document.documentElement.dataset.siteBridge
  ? await import(document.documentElement.dataset.siteBridge) : null;
const site=siteModule?sitePreferences(siteModule.normalizeSiteSettings,sanitize,entryURL.searchParams,feedback):null;
if(site)preferences=site.view();
else try{
  const saved=localStorage.getItem(storageKey);
  if(saved){const parsed=JSON.parse(saved);preferences=sanitize(parsed);if(JSON.stringify(parsed)!==JSON.stringify(preferences))feedback('Saved settings recovered. Check your breathing rhythm.',true);}
}catch{feedback('Your saved settings could not be loaded. You can continue with the defaults.');}
const requestedCharacter=entryURL.searchParams.get('character');
if(MODEL_STYLES.includes(requestedCharacter)){
  preferences.character=requestedCharacter;
  if(site)site.saveAppearance(preferences);
  entryURL.searchParams.delete('character');
  try{history.replaceState(null,'',entryURL);}catch{}
}
const soundFlags=['music','voice','metronome','vibration','mute'];
function save(){
  if(fatal)return;
  if(site){
    const sound=Object.fromEntries(soundFlags.map(key=>[key,form.elements[key].checked]));
    site.save(preferences,{...sound,sound:form.elements.backgroundSound.value});
    preferences=site.view();
    return;
  }
  try{localStorage.setItem(storageKey,JSON.stringify(preferences));}catch{feedback('These settings are active, but could not be saved in this browser.');}
}

const scene=new JourneyScene(sceneRoot,()=>feedback(animationUnavailable));
const music=site?null:new Audio(new URL('../../static/bret/audio/sunrise.mp3',import.meta.url));
if(music){music.loop=true;music.volume=0.28;music.preload='none';}
let visibleMediaMessage=null;
function mediaFeedback(message){
  const banner=$('[data-feedback]');
  if(message){feedback(message);visibleMediaMessage=banner.firstChild;}
  else if(visibleMediaMessage===banner.firstChild){feedback('');visibleMediaMessage=null;}
}
const support=siteModule?.createJourneySupport({audioRoot:document.documentElement.dataset.audioRoot,
  feedback:mediaFeedback,readSession:()=>journey?.session,readSettings:()=>site.settings});
stopFailedMedia=()=>{support?.failed();support?.dispose();music?.pause();};
function announce(text){if(text!==announcement){announcement=text;$('[data-announcement]').textContent=text;}}
function pauseMusic(){if(support){support.pause();return;}soundToken++;music.pause();}
function playMusic(){
  if(fatal||support)return;
  if(!preferences.sound||journey.session.state!=='running'){pauseMusic();return;}
  const token=++soundToken;
  try{const playing=music.play();playing?.then(()=>{
    if(fatal||!preferences.sound||journey.session.state!=='running')music.pause();
  }).catch(()=>{if(!fatal&&token===soundToken&&preferences.sound&&journey.session.state==='running'){preferences.sound=false;save();feedback('The music did not start. You can continue without sound.');render();}});
  }catch{preferences.sound=false;pauseMusic();save();feedback('Music is unavailable. The timer is still running.');render();}
}
music?.addEventListener('error',()=>{
  if(fatal)return;
  if(preferences.sound&&journey?.session.state==='running'){preferences.sound=false;pauseMusic();save();feedback('Music is unavailable. You can follow the timer instead.');render();}
});

$('.landscape-options').innerHTML=landscapes.map((name,i)=>`<label class="landscape-option" title="${name}"><input type="radio" name="scene" value="${i}" aria-label="${name}"><img src="./art/poster-${i}.svg?v=jacket4" width="360" height="800" alt=""><span>${shortLandscapes[i]}</span></label>`).join('');
function writeForm(){
  form.elements.preset.value=preferences.preset;
  form.elements.cycles.value=preferences.cycles;
  ['inhale','holdIn','exhale','holdOut'].forEach((name,i)=>form.elements[name].value=preferences.custom[i]);
  form.elements.scene.value=String(preferences.scene);form.elements.still.checked=preferences.still;
  form.elements.character.value=preferences.character;
  if(site){
    $('[data-site-sound]').hidden=false;
    for(const key of soundFlags)form.elements[key].checked=site.settings[key];
    form.elements.backgroundSound.value=site.settings.sound;
    form.elements.vibration.disabled=typeof navigator.vibrate!=='function';
    for(const key of ['music','voice','metronome','backgroundSound'])form.elements[key].disabled=site.settings.mute;
  }
  updateCustom();
}
function updateCustom(){
  const custom=form.elements.preset.value==='custom';$('.custom-fields').hidden=!custom;
  ['inhale','holdIn','exhale','holdOut'].forEach(name=>form.elements[name].disabled=!custom);
}
function readForm(){
  return sanitize({...preferences,scene:Number(form.elements.scene.value),character:form.elements.character.value,preset:form.elements.preset.value,
    cycles:Number(form.elements.cycles.value),custom:['inhale','holdIn','exhale','holdOut'].map(n=>Number(form.elements[n].value)),still:form.elements.still.checked});
}
function isLive(){return ['running','paused'].includes(journey?.session.state);}
function phaseChips(){
  $('.phase-chips').innerHTML=journey.phases.map((n,i)=>n?`<span class="phase-chip" data-chip="${i}">${i===1||i===3?'Hold':phaseNames[i]} · ${n}</span>`:'').join('');
}
function updateScene(snapshot=journey.snapshot()){
  if(fatal)return;
  const still=reduced.matches||preferences.still;
  const target=landscapeForCycle(preferences.scene,snapshot.cycle,still);
  sceneRoot.classList.toggle('still',still);
  const key=`${target}:${preferences.character}`;
  if(key!==renderKey){
    renderKey=key;
    const token=++mountToken;
    $('.scene-caption').textContent=landscapes[target];
    sceneRoot.dataset.scene=target;sceneRoot.dataset.character=preferences.character;
    $('.scene-fallback').src=`./art/poster-${target}-${preferences.character}.svg?v=jacket4`;
    document.querySelectorAll('.landscape-option img').forEach((img,i)=>{img.src=`./art/poster-${i}-${preferences.character}.svg?v=jacket4`;});
    void scene.mount(target,preferences.character).then(ok=>{
      if(fatal||token!==mountToken)return;
      if(ok){sceneAttempts.delete(key);if(renderKey===key&&$('[data-feedback]').textContent.startsWith(animationUnavailable))feedback('');}
      else if(!scene.unavailable&&renderKey===key&&!sceneAttempts.has(key)){
        sceneAttempts.set(key,1);
        setTimeout(()=>{if(!fatal&&renderKey===key&&token===mountToken){renderKey='';render();}},1000);
      }
      render();
    });
  }
}
function refreshIdle(){if(fatal)return;sceneAttempts.clear();if(sceneRoot.classList.contains('text-mode')&&!scene.unavailable)renderKey='';journey=new Journey(preferences);phaseChips();render();}
function recoverRendering(){
 if(recovering)return;recovering=true;
 try{
  if(journey.session.state==='running'){journey.session.pause();journey.last=null;}
  cancelAnimationFrame(frameHandle);frameHandle=0;pauseMusic();scene.disable();
  try{paint();feedback(journey.session.state==='paused'?'Animation stopped. The journey is paused. Continue with the timer when ready.':'Animation stopped. The phase labels and timer are still available.');}catch{offerReload();}
 }catch{offerReload('The practice was interrupted. Select Try again to reload it.');}finally{recovering=false;}
}
function render(snapshot){if(fatal)return;try{paint(snapshot);}catch{recoverRendering();}}
function paint(s=journey.snapshot()){
  const paused=s.state==='paused',running=s.state==='running';
  const idle=s.state==='idle';
  updateScene(s);
  updateAttribute(sceneRoot,'data-state',s.state);updateAttribute(sceneRoot,'data-phase',s.phase);updateAttribute(sceneRoot,'data-elapsed',Math.round(s.elapsed));
  updateText($('[data-phase-name]'),paused?'Paused':phaseNames[s.phase]);
  updateText($('[data-countdown]'),Math.ceil(s.remaining/1000));
  updateText($('[data-state-label]'),paused?'JUST BREATHE COMFORTABLY':idle?'YOUR RHYTHM':'AT YOUR OWN PACE');
  updateText($('[data-instruction]'),paused?'Take a moment':instructions[s.phase]);
  updateText($('[data-hint]'),paused?'Breathe in a way that feels comfortable. Continue when you are ready.':hints[s.phase]);
  updateText($('[data-cycle]'),idle?`${s.cycles} ${plural(s.cycles,['cycle','cycles'])} at your own pace`:`Cycle ${s.cycle} of ${s.cycles}`);
  updateText($('[data-percent]'),`${Math.floor(s.progress*100)}%`);
  updateText($('[data-progress-label]'),paused?'The trail can wait':s.state==='completed'?'Journey complete':idle?'At the start':'Your journey');
  if($('progress').value!==s.progress)$('progress').value=s.progress;
  updateText($('[data-active-time]'),idle?'You can stop at any time':`${paused?'Paused · ':''}${clock(s.elapsed)} for you`);
  updateText($('[data-path-caption]'),paused?'There is no need to hurry here.':idle?'Inhale uphill. Exhale downhill.':s.phase===0?'Inhale: running uphill.':s.phase===2?'Exhale: a gentle descent.':'Hold: a level stretch.');
  if(main.dataset.state!==s.state){
    main.innerHTML=running?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6Zm8 0h4v14h-4Z"/></svg><span>Pause</span>':`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg><span>${paused?'Continue':'Start'}</span>`;
    main.dataset.state=s.state;
  }
  updateAttribute(main,'aria-label',running?'Pause journey':paused?'Continue journey':'Start journey');
  const live=isLive();
  if($('[data-stop]').hidden!==!live)$('[data-stop]').hidden=!live;
  if($('[data-compare]').hidden!==live)$('[data-compare]').hidden=live;
  if($('[data-home]').hidden!==live)$('[data-home]').hidden=live;
  if(site)updateText($('[data-reset]'),live?'End journey and reset saved settings':'Reset saved settings');
  if($('[data-rhythm-fields]').disabled!==live)$('[data-rhythm-fields]').disabled=live;
  updateText($('[data-estimate]'),clock(journey.total));
  updateText($('[data-settings-note]'),reduced.matches?'Reduced motion is enabled on this device. The landscape stays still.':preferences.still?'The landscape stays still. The phase labels and timer guide your practice.':live?'Your rhythm stays fixed for this session. A new landscape appears every two cycles.':'The running pace follows your chosen pattern. Landscapes change along the way.');
  const sound=$('[data-sound]'), enabled=site?!site.settings.mute:preferences.sound;
  const action=site?(enabled?'Mute sound':'Unmute sound'):(enabled?'Turn music off':'Turn music on');
  updateAttribute(sound,'aria-pressed',enabled);updateAttribute(sound,'aria-label',action);if(sound.title!==action)sound.title=action;
  if(sound.dataset.on!==String(enabled)){
    sound.innerHTML=enabled?'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>':'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4Zm5 4 5 6m0-6-5 6"/></svg>';
    sound.dataset.on=String(enabled);
  }
  document.querySelectorAll('[data-chip]').forEach(el=>{const active=Number(el.dataset.chip)===s.phase;if(el.classList.contains('active')!==active)el.classList.toggle('active',active);});
  // A failed optional SVG renderer must not pause or fail the breathing clock.
  try{scene.render(s,reduced.matches||preferences.still);}catch{scene.disable();feedback(animationUnavailable);}
  const seconds=s.phaseDuration/1000;
  announce(s.state==='completed'?'Journey complete. You reached the end of the trail.':s.state==='stopped'?'Journey ended. You made time for yourself.':paused?'The journey is paused. Breathe in a way that feels comfortable.':idle?'Choose a landscape and select Start.':`${phaseNames[s.phase]}, ${seconds} ${plural(seconds,['second','seconds'])}. Cycle ${s.cycle} of ${s.cycles}.`);
}
function animate(now){
  frameHandle=0;if(journey.session.state!=='running')return;
  try{
  // A screen lock can suspend frames without a visibility event. Preserve the
  // last observed active instant rather than counting the unobserved gap.
  if(now-journey.last>2000){journey.pause(journey.last);pauseMusic();render();announce('The animation was interrupted. Your journey is paused. Continue when you are ready.');return;}
  const snapshot=journey.update(now);support?.update();
  if(visualPacer.due(now,`${snapshot.state}:${snapshot.phase}:${snapshot.cycle}`))render(snapshot);
  if(journey.session.state==='completed'){finish();return;}
  if(journey.session.state==='running')frameHandle=requestAnimationFrame(animate);
  }catch{
    cancelAnimationFrame(frameHandle);frameHandle=0;
    try{journey.session.pause();journey.last=null;pauseMusic();scene.disable();}catch{}
    offerReload('The practice was interrupted. Select Try again to reload it.');
  }
}
function pause(reason=''){
  if(fatal)return;
  if(journey.session.state!=='running')return;
  const now=performance.now();journey.pause(now-journey.last>2000?journey.last:now);cancelAnimationFrame(frameHandle);frameHandle=0;pauseMusic();render();
  if(journey.session.state==='completed'){finish();return;}
  if(reason)announce(reason);
}
function observedNow(){const now=performance.now();return journey.session.state==='running'&&now-journey.last>2000?journey.last:now;}
function start(){
  if(fatal)return;
  if(document.hidden||$('.settings-dialog').open||$('.finish-dialog').open)return;
  if(journey.session.state==='running'){pause();return;}
  if(!isLive()){
    if(!form.checkValidity()){openSettings();form.reportValidity();return;}
    preferences=readForm();save();refreshIdle();
  }
  journey.start(performance.now());visualPacer.reset();support?.start();playMusic();render();if(fatal)return;cancelAnimationFrame(frameHandle);frameHandle=requestAnimationFrame(animate);
}
function finish(){
  if(fatal)return;
  support?.finish(journey.session.state==='stopped');
  cancelAnimationFrame(frameHandle);frameHandle=0;pauseMusic();render();
  if(fatal)return;
  const s=journey.snapshot();
  $('[data-finish-copy]').textContent=s.state==='completed'?'The journey is complete. Take a moment before you move on.':'It is fine to stop here. You made time for yourself.';
  $('[data-finish-time]').textContent=clock(s.elapsed);
  $('[data-finish-cycles]').textContent=s.completedCycles;
  if(!$('.finish-dialog').open){$('.finish-dialog').showModal();$('#finish-title').focus();}
}
const settingsScreen=$('.settings-dialog');
function openSettings(){
  if(fatal||settingsScreen.open)return;
  pause();if(fatal||$('.finish-dialog').open)return;
  settingsOpener=document.activeElement===document.body?$('[data-settings]'):document.activeElement;
  if(location.hash!=='#settings')history.pushState({...history.state,journeySettings:true},'', '#settings');
  settingsScreen.querySelector('.settings-content').append($('[data-feedback]'));
  settingsScreen.showModal();settingsScreen.scrollTop=0;$('[data-close-settings]').focus();
}
function closeSettings(){
  if(!settingsScreen.open)return;
  if(location.hash==='#settings'){
    if(history.state?.journeySettings){history.back();return;}
    const url=new URL(location.href);url.hash='';history.replaceState(history.state,'',url);
  }
  settingsScreen.close();
}
window.addEventListener('hashchange',()=>{
  if(location.hash==='#settings')openSettings();else if(settingsScreen.open)settingsScreen.close();
});
function returnFromFinish(){if(fatal)return;if($('.finish-dialog').open)$('.finish-dialog').close();refreshIdle();main.focus();}

main.addEventListener('click',start);
$('[data-stop]').addEventListener('click',()=>{if(fatal)return;journey.stop(observedNow());finish();});
$('[data-settings]').addEventListener('click',openSettings);
$('[data-close-settings]').addEventListener('click',closeSettings);
settingsScreen.addEventListener('cancel',event=>{event.preventDefault();closeSettings();});
settingsScreen.addEventListener('close',()=>{settingsScreen.before($('[data-feedback]'));render();if(settingsOpener?.isConnected)settingsOpener.focus();});
$('[data-again]').addEventListener('click',returnFromFinish);
$('.finish-dialog').addEventListener('cancel',event=>{event.preventDefault();returnFromFinish();});
$('[data-sound]').addEventListener('click',()=>{
  if(fatal)return;
  if(site){
    form.elements.mute.checked=!form.elements.mute.checked;
    save();writeForm();support.settingsChanged();
  }else{preferences.sound=!preferences.sound;save();preferences.sound?playMusic():pauseMusic();}
  render();
});
$('[data-reset]').addEventListener('click',()=>{
  if(!site||!site.reset())return;
  if(isLive()){journey.stop(observedNow());support.finish(true);cancelAnimationFrame(frameHandle);frameHandle=0;}
  support.reset();preferences=site.view();writeForm();refreshIdle();feedback('Saved settings reset.',true);
});
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('change',event=>{
  if(fatal)return;
  if(journey.session.state==='running')pause();
  if(fatal)return;
  updateCustom();if(!form.checkValidity()){feedback('Check the durations: inhale and exhale 1 to 10 seconds, holds 0 to 10 seconds, and cycles 1 to 99.');return;}
  feedback('');preferences=readForm();save();
  if(site){writeForm();support.settingsChanged();}
  if(!isLive())refreshIdle();else render();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('The tab is hidden. Your journey is paused. Continue when you are ready.');});
window.addEventListener('pagehide',event=>{pause();if(!event.persisted)support?.dispose();});
document.addEventListener('keydown',event=>{
  if(fatal)return;
  if(event.code==='Space'&&!event.repeat&&!$('.settings-dialog').open&&!$('.finish-dialog').open&&!["INPUT","SELECT","BUTTON","TEXTAREA","A","SUMMARY"].includes(event.target.tagName)){
    event.preventDefault();start();
  }
});
reduced.addEventListener('change',()=>render());
const compareLink=form.querySelector('[data-compare]');
if(compareLink && site)compareLink.search=entryURL.search;
writeForm();refreshIdle();if(main.isConnected){main.disabled=false;document.documentElement.classList.add('journey-ready');}
if(location.hash==='#settings')openSettings();
}catch{offerReload();}
