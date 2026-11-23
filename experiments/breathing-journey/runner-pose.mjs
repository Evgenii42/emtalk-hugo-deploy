// One stride is two successive footfalls. Keys are fractions of that stride.
export const STRIDE = 360;
export const STANCE_END = .20;
export const HIP_HEIGHT = 62;
export const LEG_UPPER = 36.5, LEG_LOWER = 31;
export const ARM_UPPER = 18, ARM_LOWER = 17;
export const RUNNER_LEAN = 25;
const rad = Math.PI / 180;
const mix = (a,b,t) => a+(b-a)*t;
const smooth = p => p*p*(3-2*p);
const mod = (v,n) => (v%n+n)%n;

// Shape-preserving cubic interpolation. A reversal (e.g. maximum knee lift)
// has zero tangent; neighboring monotone keys retain their through-velocity.
function sample(keys, phase, axis, endSlope = 0) {
  const slope = i => {
    if (i === 0 || i === keys.length-1) return endSlope;
    const a = keys[i-1], b = keys[i], c = keys[i+1];
    const left = (b[axis]-a[axis])/(b[0]-a[0]);
    const right = (c[axis]-b[axis])/(c[0]-b[0]);
    return left*right <= 0 ? 0 : 2*left*right/(left+right);
  };
  const i = keys.findIndex((key,n) => n+1 < keys.length && phase <= keys[n+1][0]);
  const a = keys[i], b = keys[i+1], dt = b[0]-a[0];
  const t = (phase-a[0])/dt, h = t*t*(3-2*t);
  return mix(a[axis],b[axis],h) + dt*t*(1-t)*((1-t)*slope(i)-t*slope(i+1));
}

// Vertical position belongs to the pelvis, so both hips share the loading dip.
const bodyKeys = [[0,0,26],[.10,2.5,24],[.20,4.2,22],[.30,2,23],[.4,.5,25],
  [.56,-2,28],[.72,-3.8,29],[.86,-3,28],[1,0,26]];
export function runBob(distance) {
  return sample(bodyKeys, mod(2*distance/STRIDE,1), 1);
}
export function runnerLean(distance, grade=0) {
  return sample(bodyKeys, mod(2*distance/STRIDE,1), 2) - .25*grade;
}

export function kneeBetween(hip, ankle, upper=LEG_UPPER, lower=LEG_LOWER) {
  const dx=ankle[0]-hip[0], dy=ankle[1]-hip[1], length=Math.hypot(dx,dy);
  const along=(upper*upper-lower*lower+length*length)/(2*length);
  const bend=Math.sqrt(Math.max(0,upper*upper-along*along));
  return [hip[0]+(dx*along+dy*bend)/length, hip[1]+(dy*along-dx*bend)/length];
}

// Rock the shoe from heel to forefoot. Both ends lie on the same sole at neutral.
const shoe = [[-4.6,.6],[-2.7,-3.2],[.6,-3.5],[3.4,.2],[7,1.9],
  [11.8,1.3],[14,2],[14.2,3.7],[13.5,5.8],[-4.5,5.8],[-4.9,3.1]];
const heel = shoe[9], toe = shoe[8];
const heelStrikeX = 16;
const roll = [[0,-13],[.05,0],[.10,8],[.15,35],[STANCE_END,60]];
function rotate([x,y], deg) {
  const c=Math.cos(deg*rad), s=Math.sin(deg*rad);
  return [x*c-y*s,x*s+y*c];
}
function support(u) {
  const angle=sample(roll,u,1);
  const pivot=angle < 0 ? heel : toe;
  const anchor=heelStrikeX+(pivot[0]-heel[0])-u*STRIDE;
  const [x,y]=rotate(pivot,angle);
  return {x:anchor-x, y:-y, angle, anchor};
}

const lift=support(STANCE_END), strike=support(0);
// Free ankle keys: x from hip, y from ground (negative is up), shoe pitch.
// First extend behind the pelvis, then fold the shin as the knee passes.
// Peak front reach precedes heel strike, so the foot is already sweeping back.
const swing = [[STANCE_END,lift.x,lift.y,lift.angle],
  [.25,-51,-20,72],[.30,-54,-29,88],[.36,-54,-37,94],
  [.44,-49,-40,105],[.50,-44,-43,109],[.56,-35,-43,120],
  [.62,-24,-37,131],[.68,-13,-33,112],[.74,0,-34,83],
  [.80,15,-24,45],[.85,21,-20,17],[.90,27,-15,5],
  [.95,28,-9,-15],[1,strike.x,strike.y,strike.angle]];
// Side-view thigh inclination (from downward vertical) and projected length.
// The camera sees a shorter thigh when the hips turn past the supporting leg.
const thighKeys = [[0,36,33],[.05,18,33],[.10,5,34],[.15,-21,35.5],
  [.20,-35,36.5],[.25,-40,36.5],[.30,-44,36],[.35,-46,35],[.40,-42,34],
  [.45,-37,32],[.50,-31,32],[.55,-21,31],[.60,-4,31],[.65,15,31.5],
  [.70,37,32.5],[.75,56,33.5],[.80,63,35],[.85,61,35.5],
  [.90,55,35],[.95,46,34],[1,36,33]];
export function legPose(distance,side,hipX,groundY) {
  const phase=mod(distance/STRIDE+side*.5,1), bob=runBob(distance);
  const hip=[hipX+(side?1:-1),groundY-HIP_HEIGHT];
  const stance=phase<=STANCE_END;
  const pose=stance?support(phase):{
    x:sample(swing,phase,1,-STRIDE), y:sample(swing,phase,2), angle:sample(swing,phase,3)
  };
  const ankle=[hip[0]+pose.x,groundY+pose.y-bob];
  const thighAngle=sample(thighKeys,phase,1)*rad, thighLength=sample(thighKeys,phase,2);
  const target=[hip[0]+thighLength*Math.sin(thighAngle),hip[1]+thighLength*Math.cos(thighAngle)];
  const shinLength=Math.max(26.5,Math.min(32.5,Math.hypot(target[0]-ankle[0],target[1]-ankle[1])));
  const knee=kneeBetween(hip,ankle,thighLength,shinLength);
  const outline=shoe.map(p=>rotate(p,pose.angle).map((v,i)=>v+ankle[i]));
  return {hip,knee,ankle,shoe:outline,rotation:pose.angle,stance,phase,bob,
    contact:stance?[hip[0]+pose.anchor,groundY]:null};
}

// Absolute upper-arm and forearm inclinations in screen space, observed from
// the side. The visible rear elbow opens as the opposite leg reaches forward.
const armKeys = [[0,-93,-19],[.05,-56,8],[.10,-20,46],[.15,6,100],
  [.22,24,113],[.30,44,123],[.40,62,148],[.45,56,145],[.50,42,116],
  [.55,13,58],[.60,-58,12],[.65,-82,-2],[.75,-96,-20],[.85,-101,-29],
  [.90,-102,-40],[.95,-99,-34],[1,-93,-19]];
export function armPose(distance,side,hipX,groundY) {
  const phase=mod(distance/STRIDE+side*.5,1);
  const lean=runnerLean(distance), upper=(sample(armKeys,phase,1)+lean)*rad;
  const lower=(sample(armKeys,phase,2)+lean)*rad;
  const shoulder=[hipX+(side?1.4:-1.4),groundY-HIP_HEIGHT-38];
  const elbow=[shoulder[0]+ARM_UPPER*Math.sin(upper),shoulder[1]+ARM_UPPER*Math.cos(upper)];
  const wrist=[elbow[0]+ARM_LOWER*Math.sin(lower),elbow[1]+ARM_LOWER*Math.cos(lower)];
  return {shoulder,elbow,wrist,sleeve:shoulder.map((v,i)=>mix(v,elbow[i],.5))};
}

export function terrainPose(snapshot,still=false){
  if(still)return {angle:0,elevation:0,bodyLean:runnerLean(0),bob:0,hipY:558-HIP_HEIGHT};
  const p=Math.max(0,Math.min(1,snapshot.offset/snapshot.phaseDuration));
  const direction=snapshot.phase===0?-1:snapshot.phase===2?1:0;
  const angle=direction*18*Math.sin(Math.PI*p);
  const elevation=snapshot.phase===0?-68*smooth(p):snapshot.phase===1?-68:snapshot.phase===2?-68*(1-smooth(p)):0;
  const bob=runBob(snapshot.distance);
  return {angle,elevation,bodyLean:runnerLean(snapshot.distance,angle),bob,hipY:558-HIP_HEIGHT};
}
