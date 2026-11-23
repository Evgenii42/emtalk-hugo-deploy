// Explicit, read-only snapshots of earlier workspace data. No automatic migration.
import {validateDecision, serializeDecision} from './dm-v2-model.js';

export const EARLIER_SLOTS = Object.freeze([
  Object.freeze({kind:'draft', key:'emtalk.dm.draft.v1', maxBytes:220000}),
  Object.freeze({kind:'history', key:'emtalk.dm.history.v1', maxBytes:2000000}),
  Object.freeze({kind:'single', key:'emtalk.dm.guest.v1', maxBytes:200000}),
]);
const IMPORT_BYTES = 200000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const shape = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => own(value,key));
const stamp = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const bytes = text => new TextEncoder().encode(text).length;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function preview(decision) {
  // Readable text only, not a second validator or a statement of legacy validity.
  // No user IDs become object keys, markup, route fragments or file names.
  if (!record(decision) || decision.schemaVersion !== 1 || typeof decision.title !== 'string' || decision.title.length > 160
    || !Array.isArray(decision.options) || decision.options.length > 8
    || !Array.isArray(decision.opinions) || decision.opinions.length > 120) return null;
  if (decision.options.some(option => !record(option) || typeof option.title !== 'string' || option.title.length > 100)
    || decision.opinions.some(reason => !record(reason) || typeof reason.text !== 'string' || reason.text.length > 400)) return null;
  return {title:decision.title, options:decision.options.map(option => ({title:option.title})), reasons:decision.opinions.map(reason => ({text:reason.text}))};
}
function inspectDecision(value, position, metadata = {}) {
  const result = {position, ...metadata, preview:preview(value), compatibility:'incompatible', portableJson:null, portableBytes:null};
  try {
    const decision = validateDecision(value);
    const json = serializeDecision(decision), size = bytes(json);
    result.portableBytes = size;
    if (size > IMPORT_BYTES) result.compatibility = 'too-large';
    else { result.compatibility = 'compatible'; result.portableJson = json; }
  } catch { /* A current incompatible copy remains an original, never repaired. */ }
  return result;
}
function draftEnvelope(value) {
  return shape(value,['schemaVersion','savedAt','decision','pairIndex','optionIndex','savedEntryId'])
    && value.schemaVersion === 1 && stamp(value.savedAt) && stamp(value.pairIndex) && stamp(value.optionIndex)
    && (value.savedEntryId === null || identifier(value.savedEntryId));
}

export function decodeEarlierWorkspaceText(kind, originalRaw) {
  const spec = EARLIER_SLOTS.find(slot => slot.kind === kind);
  if (!spec || typeof originalRaw !== 'string') throw new TypeError('Earlier data decoder arguments are invalid');
  const result = {kind:spec.kind,key:spec.key,readState:'present',originalRaw,originalUtf8Bytes:bytes(originalRaw),parseState:'malformed-json',entries:[],issues:[]};
  if (result.originalUtf8Bytes > spec.maxBytes) { result.parseState = 'too-large'; return freeze(result); }
  let value;
  try { value = JSON.parse(originalRaw); }
  catch { return freeze(result); }
  if (kind === 'single') {
    if (!record(value) || value.schemaVersion !== 1) result.parseState = 'unsupported-shape';
    else { result.parseState = 'decoded'; result.entries.push(inspectDecision(value,1)); }
  } else if (kind === 'draft') {
    if (!draftEnvelope(value)) result.parseState = 'unsupported-shape';
    else {
      result.parseState = 'decoded';
      // Cursors/lineage stay in the original. They are never applied to DOS.
      result.entries.push(inspectDecision(value.decision,1,{earlierSavedAt:value.savedAt}));
    }
  } else if (!shape(value,['schemaVersion','entries']) || value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > 20) {
    result.parseState = 'unsupported-shape';
  } else {
    result.parseState = 'decoded';
    const ids = new Set();
    value.entries.forEach((entry,index) => {
      const position = index + 1;
      if (!shape(entry,['id','savedAt','decision']) || !identifier(entry.id) || !stamp(entry.savedAt)) {
        result.issues.push({position,code:'entry-metadata'}); return;
      }
      if (ids.has(entry.id)) result.issues.push({position,code:'duplicate-entry-id'});
      ids.add(entry.id);
      // Display/export uses original positions, never id-based replacement.
      result.entries.push(inspectDecision(entry.decision,position,{earlierId:entry.id,earlierSavedAt:entry.savedAt}));
    });
    if (result.issues.length) result.parseState = 'decoded-with-issues';
  }
  return freeze(result);
}

function unavailable(spec) {
  return freeze({kind:spec.kind,key:spec.key,readState:'unavailable',originalRaw:null,originalUtf8Bytes:null,parseState:'not-read',entries:[],issues:[]});
}
export function createEarlierWorkspaceReader({getStorage = () => globalThis.localStorage} = {}) {
  if (typeof getStorage !== 'function') throw new TypeError('Earlier storage accessor is required');
  return Object.freeze({capture() {
    const slots = EARLIER_SLOTS.map(spec => {
      let raw;
      try { raw = getStorage().getItem(spec.key); }
      catch { return unavailable(spec); }
      if (raw === null) return freeze({kind:spec.kind,key:spec.key,readState:'absent',originalRaw:null,originalUtf8Bytes:null,parseState:'not-read',entries:[],issues:[]});
      if (typeof raw !== 'string') return unavailable(spec);
      try { return decodeEarlierWorkspaceText(spec.kind,raw); }
      catch {
        // A decoder capability failure must not suppress the other key reads or
        // release already captured original text. No raw exception is exposed.
        return freeze({kind:spec.kind,key:spec.key,readState:'present',originalRaw:raw,originalUtf8Bytes:null,parseState:'decoder-unavailable',entries:[],issues:[]});
      }
    });
    return freeze({slots,allAbsent:slots.every(slot => slot.readState === 'absent'),hasUnavailable:slots.some(slot => slot.readState === 'unavailable')});
  }});
}
