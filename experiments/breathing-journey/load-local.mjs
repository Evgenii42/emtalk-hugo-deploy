import {characterStyle} from './runner-character.mjs?v=quiet5';

// Bound response and body parsing together; a stalled local request degrades.
export async function loadJSON(url,timeoutMs=8000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const response=await fetch(url,{signal:controller.signal,cache:'no-cache'});if(!response.ok)throw Error('Local animation unavailable');return await response.json();}
 finally{clearTimeout(timer);}
}
// Lottie may register an item before setParams throws, without returning it.
// Recover only the item owned by this exact container, never sibling players.
export function createAnimation(options){
 try{return globalThis.lottie.loadAnimation(options);}
 catch(error){
  try{for(const player of globalThis.lottie.getRegisteredAnimations())if(player.wrapper===options.container){try{player.destroy();}catch{}}}catch{}
  options.container?.remove();throw error;
 }
}
// Lottie expands paths and annotates its input. Only give a player its own copy.
// Keep the parsed templates for this page. A failed request remains retryable.
const runnerTemplates=new Map();
// These templates come from JSON, without cycles or host objects. Copy their
// independent mutable arrays in small tasks instead of one multi-MB main-thread
// structuredClone. An obsolete scene abandons its partial copy after a yield.
export async function cloneRunnerData(value,{isCurrent=()=>true,now=()=>performance.now(),yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 const current=()=>{if(!isCurrent())throw Error('Obsolete runner copy');};
 current();
 const container=input=>Array.isArray(input)?[]:{};
 const result=container(value),stack=[{input:value,output:result,keys:Object.keys(value),index:0}];
 let started=now(),work=0;
 while(stack.length){
  const job=stack[stack.length-1];
  if(job.index===job.keys.length){stack.pop();continue;}
  const key=job.keys[job.index++],input=job.input[key],nested=input!==null&&typeof input==='object',output=nested?container(input):input;
  // JSON may legally contain __proto__; retain an own data property.
  if(key==='__proto__')Object.defineProperty(job.output,key,{value:output,writable:true,enumerable:true,configurable:true});
  else job.output[key]=output;
  if(nested)stack.push({input,output,keys:Object.keys(input),index:0});
  if(++work%128===0&&now()-started>=4){await yieldTask();current();started=now();}
 }
 current();return result;
}
export async function loadRunner(key,options){
 let template=runnerTemplates.get(key);
 if(!template){
  template=loadJSON(`./animations/runner-model-${key}.json?rig=quiet5`).then(model=>{
   if(model.modelId!==characterStyle(key).id||!Array.isArray(model.layers))throw Error('Incompatible runner asset');
   return model;
  }).catch(error=>{runnerTemplates.delete(key);throw error;});
  runnerTemplates.set(key,template);
 }
 return cloneRunnerData(await template,options);
}
