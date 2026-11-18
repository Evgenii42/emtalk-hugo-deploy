/* Shared session accounting. Call accrueTime only while foreground Playing. */
const XP_WINDOW_MS=15000;
const GAME_IDS=new Set(['moles','firefly','order','landscape']);
const nonnegative=n=>Number.isFinite(n)&&n>=0;
const count=n=>Number.isSafeInteger(n)&&n>=0;

export function accrueTime(db,run,dtSeconds){
 if(!db||!run||typeof db!=='object'||typeof run!=='object'||run.settled===true||!Number.isFinite(dtSeconds)||dtSeconds<0||dtSeconds>2)return false;
 if(!nonnegative(db.totalMs)||!nonnegative(run.activeMs))return false;
 const deltaMs=dtSeconds*1000,afterTotal=db.totalMs+deltaMs,afterActive=run.activeMs+deltaMs;
 if(!Number.isFinite(afterTotal)||!Number.isFinite(afterActive))return false;
 const earned=count(run.earnedXP)?run.earnedXP:0;
 const credit=Math.floor(afterTotal/XP_WINDOW_MS)-Math.floor(db.totalMs/XP_WINDOW_MS);
 if(!Number.isSafeInteger(credit)||!Number.isSafeInteger(earned+credit))return false;
 db.totalMs=afterTotal;run.activeMs=afterActive;run.earnedXP=earned+credit;
 return true;
}

export function settleGoal(db,run,result={},ended=false){
 const isEnded=ended===true,passed=isEnded&&result?.passed!==false;
 const earnedXP=count(run?.earnedXP)?run.earnedXP:0;
 let bonus=0;
 if(!db||!run||typeof db!=='object'||typeof run!=='object')return {passed:false,bonus,earnedXP,ended:isEnded};
 // Saving a partial scene does not settle it. Its existing earnedXP travels
 // with the checkpoint; global time accumulated by other runs is irrelevant.
 if(isEnded&&run.settled!==true){
  if(passed&&run.bonusAwarded!==true){bonus=Math.floor(earnedXP*.25);db.bonusXP=(count(db.bonusXP)?db.bonusXP:0)+bonus;run.bonusAwarded=true;}
  if(passed&&run.mode==='levels'&&GAME_IDS.has(run.id)){
   if(!db.levels||typeof db.levels!=='object')db.levels={};
   const current=count(db.levels[run.id])&&db.levels[run.id]>0?db.levels[run.id]:1;
   const played=count(run.level)&&run.level>0?run.level:current;
   db.levels[run.id]=Math.max(current,played+1);
  }
  db.completed=(count(db.completed)?db.completed:0)+1;
  run.settled=true;
 }
 return {passed,bonus,earnedXP,ended:isEnded};
}
