// Red Horizon: save and load. The whole simulation is written as one object graph: every object gets a row in a
// table so shared references (a unit's target, a transport's cargo) and cycles survive; unit and building
// definitions and other constant tables are stored by name, so `u.def === UNIT_DEFS.rifle` still holds after a load.
import {AI_QUEUE, AI_SHIPS, DIFFICULTY, ai} from './ai.js';
import {BUILD_DEFS, IFV_WEAPONS, SOV_NAME, TRUCK_GUN, UNIT_DEFS, buildings, doodads, effects, explored, flags, nextId, occ, ore, projectiles, setNextId, setSelection, state, units, walk, water} from './data.js';
import {scorches} from './render.js';
import {groups} from './ui.js';
import {RAD_VS, prodQ, radPuddles} from './units.js';
import {randState, setRandState} from './rng.js';

export const SLOTS = 5;
const VERSION = 1;

// constant tables, found by path ('UNIT_DEFS/rifle/weapon')
let statics = null;
function staticTables(){
  if(statics) return statics;
  const byObj = new Map(), byPath = new Map();
  const walk = (o, path) => {
    if(!o || typeof o !== 'object' || byObj.has(o)) return;
    byObj.set(o, path); byPath.set(path, o);
    for(const k in o) walk(o[k], path + '/' + k);
  };
  const roots = {UNIT_DEFS, BUILD_DEFS, IFV_WEAPONS, TRUCK_GUN, RAD_VS, SOV_NAME, AI_QUEUE, AI_SHIPS, DIFFICULTY};
  for(const k in roots) walk(roots[k], k);
  return statics = {byObj, byPath};
}

const TYPED = {Float32Array, Int16Array, Uint8Array, Int32Array, Uint16Array, Float64Array};
function b64(a){
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s, a){
  const bin = atob(s), u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return a;
}

// object graph -> JSON-safe {root, table}
export function pack(root){
  const {byObj} = staticTables(), seen = new Map(), table = [];
  const enc = v => {
    if(v === undefined) return {$u: 1};
    if(typeof v === 'number') return isFinite(v) && !Object.is(v, -0) ? v : {$n: Object.is(v, -0) ? '-0' : String(v)};
    if(v === null || typeof v !== 'object') return v;
    const s = byObj.get(v);
    if(s) return {$s: s};
    if(seen.has(v)) return {$r: seen.get(v)};
    const i = table.length;
    seen.set(v, i); table.push(null);
    if(ArrayBuffer.isView(v)) table[i] = {$t: v.constructor.name, n: v.length, d: b64(v)};
    else if(Array.isArray(v)) table[i] = v.map(enc);
    else if(v instanceof Set) table[i] = {$set: [...v].map(enc)};
    else { const o = {}; for(const k in v) o[k] = enc(v[k]); table[i] = o; }
    return {$r: i};
  };
  return {root: enc(root), table};
}

// {root, table} -> object graph (shells first, so references can point forwards)
export function unpack({root, table}){
  const {byPath} = staticTables();
  const objs = table.map(t => Array.isArray(t) ? [] : t.$t ? unb64(t.d, new TYPED[t.$t](t.n)) : t.$set ? new Set() : {});
  const dec = v => {
    if(v === null || typeof v !== 'object') return v;
    if('$r' in v) return objs[v.$r];
    if('$s' in v) return byPath.get(v.$s);
    if('$n' in v) return Number(v.$n);
    return undefined;   // $u
  };
  table.forEach((t, i) => {
    if(Array.isArray(t)) t.forEach((x, j) => { objs[i][j] = dec(x); });
    else if(t.$set) for(const x of t.$set) objs[i].add(dec(x));
    else if(!t.$t) for(const k in t) objs[i][k] = dec(t[k]);
  });
  return dec(root);
}

// the simulation right now; `extra` carries the main loop's own timers
export function snapshot(extra){
  return pack({units, buildings, projectiles, effects, radPuddles, doodads, scorches, prodQ, groups, state, ai,
               occ, ore, walk, water, explored, rng: randState(), nextId, extra});
}

// put a snapshot back into the live world (the map itself is rebuilt from its seed first); returns `extra`
export function restore(data){
  const w = unpack(data);
  const fill = (arr, from) => { arr.length = 0; for(const x of from) arr.push(x); };
  fill(units, w.units); fill(buildings, w.buildings); fill(projectiles, w.projectiles); fill(effects, w.effects);
  fill(radPuddles, w.radPuddles); fill(doodads, w.doodads); fill(scorches, w.scorches);
  for(const k in prodQ) fill(prodQ[k], w.prodQ[k] || []);
  for(const k in groups) delete groups[k];
  Object.assign(groups, w.groups);
  occ.set(w.occ); ore.set(w.ore); walk.set(w.walk); water.set(w.water); explored.set(w.explored);
  // how the game is being shown right now stays as it is
  const {menu, paused, started, sndOn, voiceOn, placing, mode, ...rest} = w.state;
  Object.assign(state, rest);
  Object.assign(ai, w.ai);
  setRandState(w.rng); setNextId(w.nextId);
  setSelection([]);
  flags.shroudDirty = true; flags.mmBaseDirty = true;
  return w.extra;
}

// ---------- slots in localStorage ----------
const slotKey = n => 'rh-save-' + n;
export function readSlot(n){
  try { const s = JSON.parse(localStorage.getItem(slotKey(n)) || 'null'); return s && s.v === VERSION ? s : null; }
  catch(e){ return null; }
}
export function writeSlot(n, save){
  try { localStorage.setItem(slotKey(n), JSON.stringify({v: VERSION, ...save})); return true; }
  catch(e){ return false; }   // storage full or blocked
}
export function slotInfo(n){
  const s = readSlot(n);
  return s ? s.meta : null;
}
