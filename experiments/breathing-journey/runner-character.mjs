// New parkour silhouette, authored from an athletic profile rather than v1 art.
import {HIP_HEIGHT,legPose,armPose,runBob,runnerLean,RUNNER_LEAN} from './runner-pose.mjs?v=jacket4';
export const MODEL_ID='bret-runner-parkour-v4-jacket-sport';
export const MODEL_STYLES=Object.freeze(['sport','soft','silhouette']);
export const MODEL_NAMES=Object.freeze({sport:'Graphite',soft:'Ink',silhouette:'Contrast'});
export const HIP_X=160,GROUND_Y=558;
// The wardrobe separates shirt, trousers and shoes even in a small silhouette.
const armFabrics = {
 sport:{sleeveFront:'595967',cuff:'787985',glove:'383844',gloveBack:'45434E'},
 soft:{sleeveFront:'69576C',cuff:'887887',glove:'453544',gloveBack:'50414E'},
 silhouette:{sleeveFront:'484850',cuff:'62626C',glove:'292934',gloveBack:'34343F'}
};
const wardrobe = {
 sport: {body:'24242C',rear:'302E37',shirt:'4A4954',sleeveBack:'3D3B45',shirtFold:'64636D',pants:'292932',pantsBack:'393742',crease:'46444F',creaseBack:'494651',belt:'202029',shoe:'181820'},
 soft: {body:'322735',rear:'443548',shirt:'5B495E',sleeveBack:'4D3D52',shirtFold:'716075',pants:'382D3C',pantsBack:'47394B',crease:'56455B',creaseBack:'59485E',belt:'29212E',shoe:'27202B'},
 silhouette: {body:'15151B',rear:'23232A',shirt:'37373E',sleeveBack:'2C2C33',shirtFold:'4C4C53',pants:'202027',pantsBack:'2C2C33',crease:'383841',creaseBack:'41414A',belt:'121217',shoe:'101015'}
};
export const RUNNER_COLORS=Object.freeze(wardrobe.sport);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const unit=v=>{const length=Math.hypot(...v)||1;return v.map(n=>n/length);};
const body=(name,v,i,o)=>({name,v:v.map(([x,y])=>[HIP_X+x,GROUND_Y-HIP_HEIGHT+((name==='Trouser seat'||name==='Waistband')?y:y*1.085)]),
 i:i||v.map(()=>[0,0]),o:o||v.map(()=>[0,0])});
export const BODY_PARTS=[
 body('Trouser seat',[[-8,-5],[6,-5],[10,0],[8,7],[2,9],[-7,8],[-11,2]]),
 body('Waistband',[[-9,-4],[7,-4],[9,-.2],[-10,1.8]]),
 body('Jersey',[[-9,-34],[-3,-39],[5,-38],[12,-32],[11,-24],[9,-15],[9,-6],[10,-2],[1,-.5],[-12,1],[-10.8,-5],[-11,-13],[-13,-25]],
 [[-.6,1.4],[-3,.1],[-2,0],[-2,-2],[.2,-2],[.2,-2],[-.2,-1],[-.2,-1],[2,-.4],[2,.3],[-.3,1.2],[.4,2],[.3,2]],
 [[1,-2],[2,-.5],[2.5,.3],[1,2],[-.6,2],[-.5,2],[.2,1.6],[-1,.3],[-2.2,.4],[-.3,-1],[.2,-2],[-.2,-2.5],[-.6,-2.5]]),
 body('Jersey hem',[[-11,-2.2],[-4,-2],[8.8,-4.5],[9,-3.3],[-4,-.8],[-11.4,-.5]]),
 body('Collar',[[-5.5,-37.5],[-2,-39.3],[5,-38.6],[8,-36.8],[5,-36],[-1,-36.7]]),
 body('Shoulder seam',[[-9,-34],[-4,-36],[.5,-35.5],[-3,-34.8],[-8.8,-32.6]]),
 body('Neck',[[1,-43],[6,-43],[7,-35],[1,-34],[-1,-37]]),
 body('Head silhouette',[[-2,-49],[-1.2,-55.3],[4.6,-57.4],[12.2,-56.7],[11.6,-50],[13.1,-46.3],[11.8,-45.4],[11,-41],[4.5,-39.7],[-.4,-42.5]],
 [[0,1.5],[-.5,1.5],[-2,0],[-1,-1],[0,-1],[0,-.4],[.5,0],[0,-1],[1,0],[0,1]],
 [[0,-1.5],[1,-1],[2,0],[.5,1],[0,1],[0,.4],[-.5,1],[-1,.5],[-1,-.5],[-.5,-1]]),
];
export function characterStyle(key='sport'){
 const style=MODEL_STYLES.includes(key)?key:'sport';
 const colors={...wardrobe[style],...armFabrics[style]};
 const material={'Trouser seat':'pants','Waistband':'belt','Jersey':'shirt','Jersey hem':'shirtFold','Collar':'belt','Shoulder seam':'shirtFold'};
 return {key:style,id:`bret-runner-parkour-v4-jacket-${style}`,name:MODEL_NAMES[style],colors,
  parts:structuredClone(BODY_PARTS).map(p=>({...p,fill:colors[material[p.name]??'body']}))};
}
// Each bone has a convex tapered volume. Separate overlapping segments keep
// a folded knee/elbow human-shaped instead of filling a self-crossing ribbon.
function contour(v,tension=.16){
 const tangent=v.map((p,i)=>{const a=v[(i+v.length-1)%v.length],b=v[(i+1)%v.length];return [(b[0]-a[0])*tension,(b[1]-a[1])*tension];});
 return {v,i:tangent.map(p=>p.map(n=>-n)),o:tangent};
}
function segment(a,b,startRadius,bulge,endRadius){
 const direction=unit([b[0]-a[0],b[1]-a[1]]),normal=[-direction[1],direction[0]];
 const at=(t,r)=>{const c=mix(a,b,t);return c.map((x,i)=>x+normal[i]*r);};
 return contour([a.map((x,i)=>x-direction[i]*startRadius*.35),at(0,startRadius),at(.32,bulge),at(.76,endRadius*1.25),at(1,endRadius),b.map((x,i)=>x+direction[i]*endRadius*.4),at(1,-endRadius),at(.76,-endRadius*1.25),at(.32,-bulge),at(0,-startRadius)],.13);
}
// A slightly open gloved hand in profile. The thumb sits above the curled
// fingers and the palm narrows where it meets the ribbed cuff.
function runningGlove(wrist,direction){
 const normal=[-direction[1],direction[0]];
 const profile=[[-1.1,-1.9],[1.1,-2.1],[3.2,-3.5],[5.8,-3.65],
  [6.8,-3],[6.45,-2.2],[6.05,-1.85],[8.05,-1.55],[9.3,-.55],
  [9.05,.65],[7.75,1.65],[5.6,2.5],[3.65,2.6],[1.4,1.7],[-1.0,1.55]];
 return contour(profile.map(([along,across])=>wrist.map((v,i)=>v+along*direction[i]+across*normal[i])),.1);
}
function joint(center,r){
 const k=r*.55228475,v=[[r,0],[0,r],[-r,0],[0,-r]].map(p=>p.map((n,i)=>n+center[i]));
 const o=[[0,k],[-k,0],[0,-k],[k,0]];return {v,i:o.map(p=>p.map(n=>-n)),o};
}
function clothAxis(a,b){
 const d=unit([b[0]-a[0],b[1]-a[1]]),n=[-d[1],d[0]];
 return (t,width)=>mix(a,b,t).map((v,i)=>v+n[i]*width);
}
export function armOutlines(distance,side,hipX=HIP_X,groundY=GROUND_Y){
 const p=armPose(distance,side,hipX,groundY),direction=unit([p.wrist[0]-p.elbow[0],p.wrist[1]-p.elbow[1]]);
 const at=clothAxis(p.shoulder,p.elbow);
 const sleeve=contour([at(-.12,1),at(-.04,4.6),at(.36,5.9),at(.8,5.7),at(.75,-5.15),at(.32,-5.2),at(-.06,-3.7)],.09);
 const lower=clothAxis(p.elbow,p.wrist);
 const cuff=contour([lower(.74,3.65),lower(.91,3.25),lower(1.02,2.8),
  lower(1.02,-2.55),lower(.90,-2.9),lower(.74,-3.4)],.06);
 return {
  sleeve,upper:segment(p.shoulder,p.elbow,5.1,5.5,4.15),
  forearm:segment(p.elbow,p.wrist,4.15,4.75,2.65),
  elbow:joint(p.elbow,4.15),cuff,hand:runningGlove(p.wrist,direction)
 };
}
export function armPanels(side,colors){
 const cloth=side?colors.sleeveFront:colors.sleeveBack;
 // Painter's order, shared between the static poster and the Lottie model.
 return [
  ['Upper arm silhouette','upper',cloth],['Elbow joint','elbow',cloth],
  ['Shirt sleeve','sleeve',cloth],['Forearm silhouette','forearm',cloth],
  ['Running glove','hand',side?colors.glove:colors.gloveBack],
  ['Ribbed wrist cuff','cuff',side?colors.cuff:colors.shirtFold]
 ];
}
export function legOutlines(distance,side,hipX=HIP_X,groundY=GROUND_Y){
 const p=legPose(distance,side,hipX,groundY);
 const thigh=clothAxis(p.hip,p.knee),shin=clothAxis(p.knee,p.ankle);
 const a=unit([p.knee[0]-p.hip[0],p.knee[1]-p.hip[1]]);
 const b=unit([p.ankle[0]-p.knee[0],p.ankle[1]-p.knee[1]]);
 const bend=(1-a[0]*b[0]-a[1]*b[1])/2;
 // The outside seam runs down to the shoe. Compression at the inside knee
 // changes the length of a fabric fold without moving the anatomical joints.
 return {
  thigh:contour([thigh(-.12,0),thigh(0,7.6),thigh(.29,8.1),thigh(.76,6.3),thigh(1,5.4),thigh(1.085,.4),thigh(1,-5.4),thigh(.73,-6.8),thigh(.30,-7.6),thigh(0,-7.6)],.11),
  calf:contour([shin(-.08,0),shin(0,5.3),shin(.26,6.0+bend*.8),shin(.72,4.8),shin(.82,5.5),shin(.91,4.7),shin(1.015,5.25),shin(1.018,-4.65),shin(.93,-5.35),shin(.84,-4.6),shin(.76,-4.9),shin(.28,-5.4),shin(0,-5.3)],.085),
  knee:joint(p.knee,5.1),
  cuff:contour([shin(.82,5.2),shin(.88,4.68),shin(.97,-4.65),shin(.92,-4.7)],.045),
  pleat:contour([shin(.045,-4.65),shin(.22+bend*.19,1.2),shin(.105,-4.72)],0),
  pocket:contour([thigh(.06,-5.5),thigh(.19,-4.5),thigh(.35,-1.5),thigh(.46,1.9),thigh(.36,.7),thigh(.20,-2.9)],.06)
 };
}
export function shoeOutline(distance,side,hipX=HIP_X,groundY=GROUND_Y){
 const p=legPose(distance,side,hipX,groundY),r=p.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r),rotate=([x,y])=>[x*c-y*s,x*s+y*c];
 const incoming=[[-.2,.6],[-.7,.1],[-.8,-.2],[-.8,-.8],[-1,0],[-1,0],[-.4,-.4],[.1,-.6],[.5,-.1],[.8,0],[0,.6]];
 const outgoing=[[.2,-.8],[.7,-.2],[.8,.3],[.8,.6],[1,0],[1,.1],[.4,.4],[-.1,.6],[-1,0],[-.4,-.2],[0,-.6]];
 return {v:p.shoe,i:incoming.map(rotate),o:outgoing.map(rotate)};
}
export function pathData({v,i,o}){
 let d=`M${v[0][0]},${v[0][1]}`;
 for(let n=1;n<=v.length;n++){const a=n-1,b=n%v.length;d+=`C${v[a][0]+o[a][0]},${v[a][1]+o[a][1]} ${v[b][0]+i[b][0]},${v[b][1]+i[b][1]} ${v[b][0]},${v[b][1]}`;}
 return d+'Z';
}
export function partTransform(name,distance){
 const delta=runnerLean(distance)-RUNNER_LEAN;
 return name==='Head silhouette'?{angle:-.72*delta,pivot:[HIP_X+4,GROUND_Y-HIP_HEIGHT-44]}:(name==='Trouser seat'||name==='Waistband')?{angle:-.5*delta,pivot:[HIP_X,GROUND_Y-HIP_HEIGHT]}:{angle:0,pivot:[0,0]};
}
export function posterRunnerSVG(x,y,key='sport',distance=0){
 const style=characterStyle(key),c=style.colors,bob=runBob(distance),hipY=GROUND_Y-HIP_HEIGHT;
 const fill=(shape,color)=>`<path d="${pathData(shape)}" fill="#${color}"/>`;
 const arm=side=>{
  const shapes=armOutlines(distance,side);
  return armPanels(side,c).map(([,part,color])=>fill(shapes[part],color)).join('');
 };
 const leg=side=>{const p=legOutlines(distance,side),color=side?c.pants:c.pantsBack,stitch=side?c.crease:c.creaseBack;return fill(p.thigh,color)+fill(p.calf,color)+fill(p.knee,color)+fill(p.pocket,stitch)+fill(p.pleat,stitch)+fill(shoeOutline(distance,side),c.shoe)+fill(p.cuff,stitch);};
 const trunk=style.parts.map(p=>{const t=partTransform(p.name,distance);return `<g transform="rotate(${t.angle} ${t.pivot.join(' ')})">${fill(p,p.fill)}</g>`;}).join('');
 return `<g data-runner-model="${style.id}" transform="translate(${x-HIP_X} ${y-GROUND_Y+bob})"><g transform="rotate(${runnerLean(distance)} ${HIP_X} ${hipY})">${arm(0)}</g>${leg(0)}${leg(1)}<g transform="rotate(${runnerLean(distance)} ${HIP_X} ${hipY})">${trunk}${arm(1)}</g></g>`;
}
