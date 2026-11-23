import {lungFrame} from './model.mjs?v=jacket4';
import {terrainPose} from './runner-pose.mjs?v=jacket4';
import {loadJSON,loadRunner,createAnimation} from './load-local.mjs?v=jacket4';
function discard(player){try{player.destroy();}catch{}player.journeyContainer?.remove();}
function transform(node,value){if(node.getAttribute('transform')!==value)node.setAttribute('transform',value);}
// Session and cues still observe every RAF. Expensive SVG/DOM paints have a
// finite cadence, with immediate phase/state changes and no catch-up burst.
export function createVisualPacer(){
  let last=null,phaseKey=null;
  return {reset(){last=null;phaseKey=null;},due(now,key){
    if(last!==null&&key===phaseKey&&now-last<1000/30-.01)return false;
    last=now;phaseKey=key;return true;
  }};
}
export function sceneFrames(snapshot,still=false,periods=[7200,720]){return still?[0,0,0]:[snapshot.distance%periods[0],snapshot.distance%periods[1],lungFrame(snapshot.phase,snapshot.offset/snapshot.phaseDuration)];}
export class JourneyScene {
  constructor(root,onError){
    this.root=root;this.onError=onError;this.version=0;this.players=[];this.pending=[];this.last=null;this.playerFrames=new WeakMap();
    this.stage=root.querySelector('.scenery');
    if(typeof ResizeObserver==='function'){
      this.observer=new ResizeObserver(()=>this.frameLandscape());this.observer.observe(this.stage);
    }else window.addEventListener('resize',()=>this.frameLandscape());
  }
  frameLandscape(){
    if(!this.camera||!this.stage.clientWidth||!this.stage.clientHeight)return;
    const wide=matchMedia('(min-width: 761px)').matches;
    const ratio=this.stage.clientWidth/Math.max(1,this.stage.clientHeight);
    this.wide=wide;
    if(wide)this.camera.world[0].svg.parentElement.style.transform='';
    const w=wide?Math.min(900,ratio*465):360,h=wide?w/ratio:800;
    const x=wide?160-w*.56:0,y=wide?558-h*.7:0;
    for(const {svg,clip} of this.camera.world){
      svg.setAttribute('viewBox',[x,y,w,h].join(' '));
      if(clip)for(const [key,n] of Object.entries({x,y,width:w,height:h}))clip.setAttribute(key,n);
    }
    this.camera.sky?.setAttribute('transform',wide?`translate(${x-2} 0) scale(${(w+4)/360} 1)`:'');
    if(this.camera.sun){const {wrapper,cx,cy}=this.camera.sun;
      wrapper.setAttribute('transform',wide?`translate(${x+w*.78-cx} ${y+h*.19-cy})`:'');
    }
  }
  async mount(scene,character='sport'){
    if(this.unavailable)return false;
    const version=++this.version;
    this.pending.forEach(discard);this.pending=[];
    this.root.classList.add('loading-art');
    if(!this.players.length)this.root.classList.add('text-mode');
    let staged=[],containers=[];
    try{
      const [background,road,lung,model]=await Promise.all([loadJSON(`./animations/scene-${scene}-background.json`),loadJSON(`./animations/scene-${scene}-road.json`),loadJSON('./animations/lungs.json'),loadRunner(character,{isCurrent:()=>version===this.version&&!this.unavailable})]);
      if(version!==this.version)return false;
      if(!globalThis.lottie)throw Error('Lottie unavailable');
      const periods=[background,road].map(data=>{const p=data.runner?.period;if(!Number.isFinite(p)||p<=0||p!==data.op-1)throw Error('Invalid animation period');return p;});
      const oldId=road.runner.modelId;
      const shared=road.assets.find(a=>a.id===oldId);shared.id=model.modelId;shared.layers=model.layers;
      road.layers.find(l=>l.refId===oldId).refId=model.modelId;road.runner.modelId=model.modelId;
      const data=[background,road,lung];
      const slots=['background','road','lungs'];
      this.pending=staged;
      for(let i=0;i<data.length;i++){
        const div=document.createElement('div');div.className='lottie-frame incoming';containers.push(div);this.root.querySelector(`[data-animation="${slots[i]}"]`).append(div);
        const player=createAnimation({container:div,renderer:'svg',loop:false,autoplay:false,animationData:data[i],assetsPath:new URL('./art/',import.meta.url).href,rendererSettings:{preserveAspectRatio:'xMidYMid meet',progressiveLoad:false}});
        player.journeyContainer=div;staged.push(player);
      }
      await Promise.all(staged.map(p=>new Promise((resolve,reject)=>{
        if(p.isLoaded){resolve();return;}
        const timer=setTimeout(()=>reject(Error('Animation timeout')),8000);
        const finish=fn=>()=>{clearTimeout(timer);fn();};
        p.addEventListener('DOMLoaded',finish(resolve));p.addEventListener('data_failed',finish(()=>reject(Error('Animation failed'))));
        p.addEventListener('error',finish(()=>reject(Error('Animation render failed'))));
      })));
      if(version!==this.version){staged.forEach(discard);return false;}
      const svgNS='http://www.w3.org/2000/svg';
      staged[1].slopeBindings=[];
      // These classes are emitted by build_bret_runner.mjs. The person is not
      // crossfaded twice; terrain/props fade independently from its visibility.
      for(const node of staged[1].journeyContainer.querySelectorAll('.terrain-tile,.terrain-prop,.runner-body-part,.runner-limb')){
        const outer=document.createElementNS(svgNS,'g');outer.classList.add('phase-grade');
        node.parentNode.insertBefore(outer,node);outer.append(node);
        let counter=null;
        if(node.classList.contains('runner-trunk')){
          counter=document.createElementNS(svgNS,'g');counter.classList.add('runner-posture');
          outer.insertBefore(counter,node);counter.append(node);
        }
        staged[1].slopeBindings.push({outer,counter});
      }
      // Only widen the world camera. The runner, foothold and lung artwork keep their native proportions.
      const world=staged.slice(0,2).map(player=>{
        const svg=player.journeyContainer.querySelector('svg');
        return {svg,clip:svg.querySelector(':scope > defs > clipPath:first-child > rect')};
      });
      const wrap=node=>{if(!node)return null;const group=document.createElementNS(svgNS,'g');node.before(group);group.append(node);return group;};
      const celestial=background.layers.find(l=>l.cl==='celestial-layer');
      const asset=celestial&&background.assets.find(a=>a.id===celestial.refId);
      this.camera={world,sky:wrap(world[0].svg.querySelector('.sky-layer')),sun:asset?{
        wrapper:wrap(world[0].svg.querySelector('.celestial-layer')),
        cx:celestial.ks.p.k[0]+asset.w/2,cy:celestial.ks.p.k[1]+asset.h/2}:null};
      this.frameLandscape();
      const retired=this.players;
      // Retirement must survive a synchronous fault while committing/rendering
      // the incoming scene, including fallback that disables current players.
      setTimeout(()=>retired.forEach(discard),280);
      retired.forEach(p=>p.journeyContainer.classList.add('retired'));
      this.players=staged;this.periods=periods;this.pending=[];this.root.dataset.scene=scene;this.root.dataset.character=character;this.root.classList.remove('text-mode');
      if(this.last)this.render(...this.last);
      // Establish initial opacity before removing incoming, even when the
      // renderer commits within one paint. Terrain keeps its own crossfade.
      for(const node of this.root.querySelectorAll('.incoming :is(.terrain-tile,.terrain-prop)'))void getComputedStyle(node).opacity;
      staged.forEach(p=>p.journeyContainer.classList.remove('incoming'));
      return true;
    }catch(error){
      staged.forEach(discard);
      containers.forEach(container=>container.remove());
      if(version===this.version){this.pending=[];this.root.classList.add('text-mode');this.onError();}
      return false;
    }finally{if(version===this.version)this.root.classList.remove('loading-art');}
  }
  disable(){this.unavailable=true;this.version++;[...this.players,...this.pending].forEach(discard);this.players=[];this.pending=[];this.root.querySelectorAll('.lottie-frame').forEach(n=>n.remove());this.root.classList.add('text-mode');this.root.classList.remove('loading-art');}
  render(snapshot,still){
    this.last=[snapshot,still];if(this.players.length!==3)return;
    const frames=sceneFrames(snapshot,still,this.periods);
    this.players.forEach((player,i)=>{
      // Holds and still mode have an unchanged lung/world frame. Lottie would
      // otherwise walk and redraw their SVG graph again on every paint.
      if(this.playerFrames.get(player)===frames[i])return;
      player.goToAndStop(frames[i],true);this.playerFrames.set(player,frames[i]);
      player.journeyContainer.dataset.frame=player.currentFrame.toFixed(3);
    });
    const pose=terrainPose(snapshot,still);
    for(const {outer,counter} of this.players[1].slopeBindings){
      transform(outer,`translate(0 ${pose.elevation}) rotate(${pose.angle} 160 558)`);
      if(counter){
        const hipY=pose.hipY+pose.bob;
        transform(counter,`translate(160 ${hipY}) rotate(${-pose.angle+pose.bodyLean}) translate(-160 ${-hipY})`);
      }
    }
    const skyTransform=this.wide?'':`translateY(${pose.elevation*.2}px)`;
    if(this.players[0].journeyContainer.style.transform!==skyTransform)this.players[0].journeyContainer.style.transform=skyTransform;
    const metadata={worldDistance:still?'0':snapshot.distance.toFixed(3),grade:pose.angle.toFixed(3),elevation:pose.elevation.toFixed(3)};
    for(const [key,value] of Object.entries(metadata))if(this.root.dataset[key]!==value)this.root.dataset[key]=value;
  }
}
