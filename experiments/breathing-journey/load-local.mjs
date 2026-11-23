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
export async function loadRunner(key){
 let template=runnerTemplates.get(key);
 if(!template){
  template=loadJSON(`./animations/runner-model-${key}.json?rig=jacket4`).then(model=>{
   if(model.modelId!==`bret-runner-parkour-v4-jacket-${key}`||!Array.isArray(model.layers))throw Error('Incompatible runner asset');
   return model;
  }).catch(error=>{runnerTemplates.delete(key);throw error;});
  runnerTemplates.set(key,template);
 }
 return structuredClone(await template);
}
