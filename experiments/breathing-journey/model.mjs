import {PRESETS, Session, breathingPlan} from '../../assets/js/bret-engine.js';
import {MODEL_STYLES} from './runner-character.mjs?v=quiet5';

export {PRESETS};
export const BREATH_TRAVEL=1440;
export const PREVIEW_SPEED=BREATH_TRAVEL/4000;
export const defaults = Object.freeze({scene:0, character:'sport',preset:'4444', custom:[4,2,4,2], cycles:10, sound:false, still:false});
export function sanitize(value) {
  const v=value && typeof value==='object' ? value : {};
  return {
    scene:Number.isInteger(v.scene)&&v.scene>=0&&v.scene<5?v.scene:0,
    character:MODEL_STYLES.includes(v.character)?v.character:'sport',
    preset:v.preset==='custom'||Object.hasOwn(PRESETS,v.preset)?v.preset:'4444',
    custom:Array.isArray(v.custom)&&v.custom.length===4&&v.custom.every((n,i)=>Number.isInteger(n)&&n>=(i%2?0:1)&&n<=10)?[...v.custom]:[4,2,4,2],
    cycles:Number.isInteger(v.cycles)&&v.cycles>=1&&v.cycles<=99?v.cycles:10,
    sound:typeof v.sound==='boolean'?v.sound:false,
    still:typeof v.still==='boolean'?v.still:false,
  };
}
export function phasesFor(settings) {return [...(settings.preset==='custom'?settings.custom:PRESETS[settings.preset])];}
export class Journey {
  constructor(settings) {
    this.settings=sanitize(settings);
    this.phases=phasesFor(this.settings);
    this.plan=breathingPlan(this.phases,this.settings.cycles);
    this.total=this.plan.reduce((n,p)=>n+p.duration,0);
    this.session=new Session(this.plan);
    this.motion=motionTimeline(this.plan);
    this.last=null;
  }
  start(now) {if(['idle','paused'].includes(this.session.state)){this.session.start();this.last=now;}return this.snapshot();}
  update(now) {if(this.session.state==='running'){this.session.tick(Math.max(0,now-this.last));this.last=now;}return this.snapshot();}
  pause(now) {this.update(now);this.session.pause();this.last=null;return this.snapshot();}
  stop(now) {this.update(now);this.session.stop();this.last=null;return this.snapshot();}
  snapshot() {
    const s=this.session;
    const current=s.current || this.plan.at(-1);
    return {state:s.state,phase:current.phase,phaseDuration:current.duration,offset:s.state==='completed'?current.duration:s.offset,
      remaining:s.remaining,elapsed:s.elapsed,total:this.total,progress:Math.min(1,s.elapsed/this.total),
      distance:s.state==='completed'?this.motion.total:this.motion.offsets[s.index]+s.offset*this.motion.speeds[s.index],
      cycle:s.state==='completed'?this.settings.cycles:current.cycle,cycles:this.settings.cycles,completedCycles:s.completedCycles};
  }
}
export function lungFrame(phase, progress) {
  const p=Math.max(0,Math.min(1,progress));
  return phase===0?p*120:phase===1?120:phase===2?120+p*120:0;
}
export function motionTimeline(plan) {
  const weights=[1,.65,1.1,.55],offsets=[],speeds=[];
  let total=0,previousBreath=null;
  for(const step of plan){
    offsets.push(total);
    // 360 world pixels/sec for a four-second inhale. Stretch the same
    // breath distance to its duration. A short custom hold must never outrun
    // the preceding breath; cap visual speed without changing hold timing.
    let speed=BREATH_TRAVEL*weights[step.phase]/step.duration;
    if(step.phase%2)speed=Math.min(speed,previousBreath.distance*weights[step.phase]/previousBreath.duration);
    else previousBreath={distance:BREATH_TRAVEL*weights[step.phase],duration:step.duration};
    speeds.push(speed);total+=speed*step.duration;
  }
  return {offsets,speeds,total};
}
export function landscapeForCycle(base,cycle,still=false){return still?base:(base+Math.floor(Math.max(0,cycle-1)/2))%5;}
