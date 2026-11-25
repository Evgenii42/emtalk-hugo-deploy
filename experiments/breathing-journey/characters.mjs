import {MODEL_STYLES} from './runner-character.mjs?v=quiet5';
import {HIP_HEIGHT,runnerLean,runBob,RUNNER_SCALE,RUNNER_PERIOD} from './runner-pose.mjs?v=quiet5';
import {sanitize,PREVIEW_SPEED} from './model.mjs?v=quiet5';
import {loadRunner,createAnimation} from './load-local.mjs?v=quiet5';
const players=[],created=[],button=document.querySelector('[data-lab-toggle]');
let failed=false,handle=0;
function bootFailure(){
 failed=true;cancelAnimationFrame(handle);for(const p of created){try{p.destroy();}catch{}}players.length=0;created.length=0;
 document.querySelectorAll('[data-character-preview]').forEach(host=>{host.classList.remove('animated');host.querySelector('.preview-player')?.remove();});
 document.querySelectorAll('button').forEach(control=>control.disabled=true);
 document.querySelector('[data-lab-message]').textContent='The comparison did not start. Reload the page or return to the breathing journey.';
}
try{
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let savedStill=false;try{savedStill=sanitize(JSON.parse(localStorage.getItem('emtalk.bret.journey.preferences.v1')||'null')).still;}catch{}
const integrated=document.documentElement.hasAttribute('data-site-bridge');
const destination=new URL('./',location.href);destination.search=location.search;destination.hash='settings';
if(integrated)document.querySelector('.back-link').href=destination.href;
let playing=!integrated&&!motionPreference.matches&&!savedStill,elapsed=0,last=null;
function render(){
 const d=elapsed*PREVIEW_SPEED%RUNNER_PERIOD,hip=558-HIP_HEIGHT*RUNNER_SCALE+runBob(d/RUNNER_SCALE)*RUNNER_SCALE;
 for(const player of players){
  player.goToAndStop(d,true);
  const lean=runnerLean(d/RUNNER_SCALE);
  for(const group of player.posture)group.setAttribute('transform',`translate(160 ${hip}) rotate(${lean}) translate(-160 ${-hip})`);
 }
}
function tick(now){handle=0;if(failed||!playing)return;if(last!==null&&now-last>2000){pause();return;}if(last!==null)elapsed+=Math.max(0,now-last);last=now;try{render();handle=requestAnimationFrame(tick);}catch{showStaticFailure();}}
function pause(){playing=false;last=null;cancelAnimationFrame(handle);button.textContent=elapsed?'Continue':'Play';button.setAttribute('aria-label',elapsed?'Continue comparison':'Play comparison');}
function showStaticFailure(){pause();button.disabled=true;for(const player of created){try{player.destroy();}catch{}}players.length=0;created.length=0;for(const host of document.querySelectorAll('[data-character-preview]')){host.classList.remove('animated');host.querySelector('.preview-player')?.remove();}document.querySelector('[data-lab-message]').textContent='Animation is unavailable. You can still choose a character below.';}
button.addEventListener('click',()=>{if(failed)return;if(playing)pause();else{playing=true;last=null;button.textContent='Pause';button.setAttribute('aria-label','Pause comparison');handle=requestAnimationFrame(tick);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('pagehide',pause);
motionPreference.addEventListener('change',()=>{if(motionPreference.matches)pause();});
for(const key of MODEL_STYLES){
 const choose=document.querySelector(`[data-choose="${key}"]`);choose.disabled=false;choose.addEventListener('click',()=>{
  if(integrated){
   destination.searchParams.set('character',key);location.href=destination.href;return;
  }
  let value=sanitize();try{value=sanitize(JSON.parse(localStorage.getItem('emtalk.bret.journey.preferences.v1')||'null'));}catch{}
  if(failed)return;value.character=key;try{localStorage.setItem('emtalk.bret.journey.preferences.v1',JSON.stringify(value));}catch{}
  location.href=`./?character=${key}`;
 });
}
try{
 if(!globalThis.lottie)throw Error('Lottie unavailable');
 const loaded=await Promise.allSettled(MODEL_STYLES.map(async key=>{
  const model=await loadRunner(key);
  const host=document.querySelector(`[data-character-preview="${key}"]`),stage=document.createElement('div');stage.className='preview-player';stage.setAttribute('aria-hidden','true');host.append(stage);
  const player=createAnimation({container:stage,renderer:'svg',autoplay:false,loop:false,animationData:model,rendererSettings:{preserveAspectRatio:'xMidYMid meet'}});
  created.push(player);
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Model timeout')),8000);if(player.isLoaded){clearTimeout(timeout);resolve();return;}player.addEventListener('DOMLoaded',()=>{clearTimeout(timeout);resolve();});player.addEventListener('data_failed',()=>{clearTimeout(timeout);reject(Error('Model unavailable'));});});
  player.posture=[];const ns='http://www.w3.org/2000/svg';
  for(const node of stage.querySelectorAll('.runner-trunk')){const wrapper=document.createElementNS(ns,'g');node.parentNode.insertBefore(wrapper,node);wrapper.append(node);player.posture.push(wrapper);}
  stage.querySelector('svg').setAttribute('viewBox','105 435 110 145');
  const line=document.createElementNS(ns,'path');line.setAttribute('d','M105 558H215');line.setAttribute('stroke','#c9b7d7');line.setAttribute('stroke-width','.6');stage.querySelector('svg').prepend(line);
  host.classList.add('animated');players.push(player);
 }));
 if(loaded.some(result=>result.status==='rejected'))throw Error('Comparison incomplete');
 button.disabled=false;render();if(playing)handle=requestAnimationFrame(tick);else pause();
}catch{showStaticFailure();}

}catch{bootFailure();}
