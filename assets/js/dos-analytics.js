import {createTrialAnalytics} from './trial-analytics.js';

// Only semantic lifecycle commands cross this port. The private owner reference
// guards replacement; it and its decision contents never enter event payloads.
export function createDosAnalytics(host=globalThis){
  const trial=createTrialAnalytics('dm',host);
  let owner=null;
  const live=ticket=>ticket&&ticket.owner===owner;
  return Object.freeze({
    replace(next,{unfinished=false,completed=false}={}){
      owner=next;trial.replacement({unfinished,completed});
    },
    request(next){owner=next;return Object.freeze({owner:next,token:trial.request()});},
    capture(next){return next===owner?Object.freeze({owner:next,token:trial.capture()}):null;},
    started(ticket){if(live(ticket))trial.started(ticket.token);},
    advance(ticket){if(live(ticket))trial.advance(ticket.token);},
    completed(ticket){if(live(ticket)){trial.advance(ticket.token);trial.completed(ticket.token);}},
    failed(ticket){if(live(ticket))trial.failed('runtime_failed',ticket.token);},
  });
}
