// Red Horizon: Sound, announcer, sidebar, mouse and keyboard input, orders, zoom and scrolling, the HUD.
import {canHurt} from './combat.js';
import {BUILD_DEFS, ENEMY, FACTION, HPX, IH, IW, PLAYER, T, UNIT_DEFS, WPX, available, bareOcc, buildings, clamp, dispName, effects, explored, idx, inMap, isoAt, occ, onMap, ore, passable, pickWorld, sailable, selection, setSelection, state, tileOf, toIso, units, walk, weaponOf, settings} from './data.js';
import {freeTileNear, orderMove} from './pathfinding.js';
import {CH, CW, VH, VW, ZOOM, cv, makeCameoIcon, mmC, radarOn, stepZoom} from './render.js';
import {MAX_QUEUE, canBoard, canPlace, capacity, engineerCan, hiddenFrom, padCount, padTaken, placeBuilding, powerOf, prereqOk, prereqs, prodQ, spawnUnit, spyCan, unloadTransport} from './units.js';
import {toggleMenu} from './main.js';
import {sfx} from './sound.js';

// ---------- voices: one line at a time ----------
// Browser speech would cut a line off (cancel) or pile lines up. Instead every line goes through one
// channel: nothing is interrupted, waiting lines are said by priority and go stale after a few seconds.
// Priority: 3 critical (attack alerts, game over), 2 advisor, 1 announcer, 0 unit replies (only if free).
export const VOICE = {PRI_CRIT: 3, PRI_ADVISOR: 2, PRI_ANNOUNCE: 1, PRI_UNIT: 0};
export const voice = {cur: null, queue: [], fallback: null, log: []};   // log: what was said, for the tests
const VOICE_TTL = [0, 4000, 6000, 8000];     // ms a line may wait, by priority
const VOICE_MAX_WAITING = 3;
function sayNow(line){
  const u = new SpeechSynthesisUtterance(line.text);
  const {voice: who, ...rest} = line.opts;
  Object.assign(u, rest);
  try{ if(who) u.voice = who; }catch(e){}
  voice.cur = u;
  voice.log.push({text: line.text, pri: line.pri, t: performance.now(), voice: who ? who.name : null, pitch: u.pitch});
  if(voice.log.length > 50) voice.log.shift();
  const done = () => {
    if(voice.cur !== u) return;
    voice.cur = null;
    clearTimeout(voice.fallback);
    setTimeout(nextLine, 200);           // a short breath between lines
  };
  u.onend = u.onerror = done;
  voice.fallback = setTimeout(done, 1500 + line.text.length * 90 / (line.opts.rate || 1));   // some browsers never fire onend
  try{ speechSynthesis.speak(u); }catch(e){ done(); }
}
function nextLine(){
  const now = performance.now();
  voice.queue = voice.queue.filter(l => now - l.at < VOICE_TTL[l.pri]);
  if(voice.cur || !voice.queue.length || !state.voiceOn) return;
  voice.queue.sort((a, b) => b.pri - a.pri || a.at - b.at);
  sayNow(voice.queue.shift());
}
// say a line now, or queue it behind the current one; returns false when it was dropped
export function voiceLine(text, pri, opts){
  if(!state.voiceOn || !window.speechSynthesis || !text) return false;
  const line = {text, pri, at: performance.now(),
                opts: Object.assign({rate: 1.0, pitch: 0.7, volume: 0.9 * settings.voice}, opts)};
  if(!voice.cur && !voice.queue.length){ sayNow(line); return true; }
  if(pri === VOICE.PRI_UNIT) return false;                         // a reply is only worth saying right away
  if(voice.queue.some(l => l.text === text) || (voice.cur && voice.cur.text === text)) return false;
  voice.queue.push(line);
  voice.queue.sort((a, b) => b.pri - a.pri || a.at - b.at);
  voice.queue.length = Math.min(voice.queue.length, VOICE_MAX_WAITING);
  if(!voice.cur) nextLine();
  return voice.queue.includes(line) || voice.cur?.text === text;
}
export function stopVoices(){
  voice.queue.length = 0;
  voice.cur = null;
  clearTimeout(voice.fallback);
  try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){}
}
export function speak(text, pri = VOICE.PRI_ANNOUNCE){ return voiceLine(text, pri); }

// The advisor sounds like a different person from the announcer: another installed English voice
// (preferring these), and a brighter pitch either way, so it still differs when only one voice exists.
const ADVISOR_VOICES = ['Samantha', 'Karen', 'Moira', 'Tessa', 'Serena', 'Google UK English Female',
                        'Microsoft Zira', 'Microsoft Hazel', 'Microsoft Sonia'];
function advisorVoice(){
  let vs = [];
  try{ vs = speechSynthesis.getVoices() || []; }catch(e){}
  const en = vs.filter(v => /^en/i.test(v.lang));
  const announcer = en.find(v => v.default) || en[0];
  for(const n of ADVISOR_VOICES){
    const v = en.find(v => v !== announcer && v.name.includes(n));
    if(v) return v;
  }
  return en.find(v => v !== announcer) || null;
}
function sayAdvisor(text){ return voiceLine(text, VOICE.PRI_ADVISOR, {voice: advisorVoice(), pitch: 1.15, rate: 1.05}); }

// ---------- announcer messages ----------
export const announceEl = document.getElementById('announcer');
export function announce(text, important, sayText){
  const d = document.createElement('div');
  d.className = 'announceMsg';
  if(important) d.style.borderLeftColor = '#ff5b5b', d.style.color = '#ffb3b3';
  d.textContent = text;
  announceEl.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .6s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 650); }, 4200);
  if(sayText) speak(sayText, important ? VOICE.PRI_CRIT : VOICE.PRI_ANNOUNCE);
}
// ---------- tactical advisor: a talking-head panel that takes over the radar window briefly ----------
const advisorEl = document.getElementById('advisor');
const advisorTextEl = document.getElementById('advisorText');
const advisorFaceCx = document.getElementById('advisorFace').getContext('2d');
let advisorHideT = null;
function drawAdvisorFace(){
  const c = advisorFaceCx, w = c.canvas.width, h = c.canvas.height;
  const col = FACTION[ENEMY] === 'soviet' ? '#c0453f' : '#3b7dff';
  c.fillStyle = '#0d1219'; c.fillRect(0, 0, w, h);
  c.fillStyle = col;
  c.beginPath(); c.arc(w / 2, h * 0.38, h * 0.24, 0, 7); c.fill();                              // head
  c.beginPath(); c.moveTo(w * 0.16, h); c.quadraticCurveTo(w * 0.5, h * 0.52, w * 0.84, h); c.fill();   // shoulders
  c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(0, h * 0.72, w, 2);                         // visor line
}
export function showAdvisor(text){
  advisorTextEl.textContent = text;
  drawAdvisorFace();
  advisorEl.hidden = false;
  advisorEl.classList.add('show');
  sayAdvisor(text);
  clearTimeout(advisorHideT);
  advisorHideT = setTimeout(() => {
    advisorEl.classList.remove('show');
    setTimeout(() => { advisorEl.hidden = true; }, 300);
  }, 6000);
}
export function underAttackAlert(e){
  if(state.time - state.attackAlertT < 14) return;
  state.attackAlertT = state.time;
  if(e.kind === 'building') announce('Our base is under attack!', true, 'Our base is under attack');
  else announce('Our forces are under attack', true);
  sfx('alert');
}

// ---------- sidebar UI ----------
export const tabsEl = document.querySelectorAll('#tabs .tab');
export const gridEl = document.getElementById('buildGrid');
export let activeTab = 'structure';
export const cameoEls = {};

export const TAB_ITEMS = {
  structure: ['power','refinery','barracks','factory','radar','lab','depot','airfield','shipyard'],
  defense:   ['pillbox','flaktower','beamtower','arctower'],
  infantry:  ['rifle','rocket','engineer','scout','dog','sniper','arctrooper','sapper','isotope','psion','jetpack','blink','infiltrator','striker'],
  vehicle:   ['ltank','ifv','halftrack','beamtank','veiltank','launcher','drone','htank','jet','heli','airship',
              'lander','frigate','picket','sub','flakboat','harv','mcv'],
};


export function buildSidebar(){
  gridEl.innerHTML = '';
  for(const key of TAB_ITEMS[activeTab]){
    const isUnit = !!UNIT_DEFS[key];
    const def = isUnit ? UNIT_DEFS[key] : BUILD_DEFS[key];
    if(!available(def, PLAYER)) continue;
    const el = document.createElement('div');
    el.className = 'cameo';
    el.title = `${dispName(def, PLAYER)} — $${def.cost}`;
    el.appendChild(makeCameoIcon(key, isUnit));
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = dispName(def, PLAYER);
    const prog = document.createElement('div'); prog.className = 'prog';
    const ready = document.createElement('div'); ready.className = 'ready';
    const cnt = document.createElement('div'); cnt.className = 'cnt';
    el.append(nm, prog, ready, cnt);
    el.addEventListener('click', () => onCameoClick(key, isUnit));
    el.addEventListener('contextmenu', ev => { ev.preventDefault(); cancelProduction(key, isUnit); });
    gridEl.appendChild(el);
    cameoEls[key] = el;
  }
  refreshSidebar();
}

export function onCameoClick(key, isUnit){
  if(state.over) return;
  const def = isUnit ? UNIT_DEFS[key] : BUILD_DEFS[key];
  if(!available(def, PLAYER)) return;
  const q = prodQ[def.tab];
  const head = q[0];
  sfx('click');
  if(head && head.key === key && head.hold){ head.hold = false; announce(isUnit ? 'Training' : 'Building', false, isUnit ? 'Training' : 'Building'); return; }
  if(!isUnit){
    if(head && head.key === key && head.ready){ state.placing = key; setMode(null); return; }
    if(head){ announce('Construction already in progress', false, 'Construction in progress'); return; }
  } else if(q.length >= MAX_QUEUE){ announce('Queue full'); return; }
  if(def.unique && (units.some(u => !u.dead && u.team === PLAYER && u.def === def) || q.some(s => s.key === key))){
    announce('Only one ' + def.name + ' at a time'); return;
  }
  if(def.jet && units.filter(u => !u.dead && u.team === PLAYER && u.def.jet).length + q.filter(s => s.key === key).length >= padCount(PLAYER)){
    announce(padCount(PLAYER) ? 'All landing pads are in use' : 'Requires: Airfield'); return;
  }
  if(!prereqOk(def)){ announce('Requires: ' + prereqLabel(def)); return; }
  if(state.credits[PLAYER] < 20){ announce('Insufficient funds', false, 'Insufficient funds'); sfx('deny'); return; }
  q.push({key, isUnit, progress: 0, spent: 0, ready: false, hold: false});
  if(q.length === 1) announce(isUnit ? 'Training' : 'Building', false, isUnit ? 'Training' : 'Building');
  refreshSidebar();
}

export function prereqLabel(def){
  return prereqs(def).filter(k => k !== 'conyard' || def.tab === 'structure' || def.tab === 'defense')
    .map(k => BUILD_DEFS[k].name).join(', ');
}

// Right-click: drop a queued copy; on the active item, first hold, then cancel (refund).
export function cancelProduction(key, isUnit){
  const def = isUnit ? UNIT_DEFS[key] : BUILD_DEFS[key];
  const q = prodQ[def.tab];
  let i = -1;
  for(let k = q.length - 1; k >= 0; k--) if(q[k].key === key){ i = k; break; }
  if(i < 0) return;
  const s = q[i];
  sfx('click');
  if(i > 0){ q.splice(i, 1); }
  else if(!s.hold && !s.ready && s.progress > 0){ s.hold = true; announce('On hold', false, 'On hold'); }
  else {
    state.credits[PLAYER] += s.spent;
    q.shift();
    if(state.placing === key) state.placing = null;
    announce('Canceled', false, 'Canceled');
  }
  refreshSidebar();
}

export function refreshSidebar(){
  for(const key of TAB_ITEMS[activeTab]){
    const el = cameoEls[key];
    if(!el || !el.isConnected) continue;
    const isUnit = !!UNIT_DEFS[key];
    const def = isUnit ? UNIT_DEFS[key] : BUILD_DEFS[key];
    const q = prodQ[def.tab];
    const head = q[0];
    const mine = head && head.key === key;
    const n = q.filter(s => s.key === key).length;
    el.classList.toggle('disabled', !prereqOk(def) && !n);
    el.classList.toggle('building', !!mine && !head.ready);
    el.classList.toggle('isReady', !!mine && (head.ready || head.hold));
    el.querySelector('.ready').textContent = mine && head.hold ? 'ON HOLD' : 'READY';
    el.querySelector('.cnt').textContent = isUnit && n > 1 ? n : '';
    el.querySelector('.prog').style.setProperty('--p', mine ? (head.progress * 100) + '%' : '0%');
  }
}


// ---------- input ----------
export const mouse = {x: 0, y: 0, wx: 0, wy: 0, down: false, dragX: 0, dragY: 0, dragging: false, inCanvas: false};
export const keys = {};
export const groups = {};

export function updateMouseWorld(e){
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  const w = pickWorld(mouse.x / ZOOM + state.camX, mouse.y / ZOOM + state.camY);
  mouse.wx = w.x; mouse.wy = w.y;
}


export function pickEntity(wx, wy){
  const c = isoAt(wx, wy);
  // aircraft first: they are drawn on top
  const cand = units.filter(u => onMap(u) && !hiddenFrom(u, PLAYER)).sort((a, b) => (b.z || 0) - (a.z || 0));
  for(const u of cand){
    const p = isoAt(u.x, u.y, u.z || 0);
    const r = u.def.r + 9;
    if(Math.abs(p.x - c.x) < r && Math.abs(p.y - c.y + 6) < r * 0.85) return u;
  }
  for(const b of buildings){
    if(b.dead) continue;
    if(wx >= b.tx * T && wx < (b.tx + b.w) * T && wy >= b.ty * T && wy < (b.ty + b.h) * T) return b;
  }
  return null;
}

export const PRODUCERS = new Set(['barracks', 'factory', 'airfield', 'shipyard']);

// Right-click orders. Ctrl forces fire on anything / attack-moves on ground.
export function issueCommand(ev){
  const force = ev && (ev.ctrlKey || ev.metaKey);
  const sel = selection.filter(s => !s.dead && s.team === PLAYER);
  let selUnits = sel.filter(s => s.kind === 'unit');
  if(!selUnits.length){
    // a selected garrison: right-click it again to empty it
    const g = sel.find(s => s.kind === 'building' && s.cargo && s.cargo.length);
    if(g && pickEntity(mouse.wx, mouse.wy) === g){ unloadTransport(g); return; }
    // rally point for selected production buildings
    const fac = sel.filter(s => s.kind === 'building' && PRODUCERS.has(s.def.key));
    if(fac.length){
      for(const b of fac) b.rally = {x: mouse.wx, y: mouse.wy};
      effects.push({type:'cmd', x: mouse.wx, y: mouse.wy, t: 0, dur: 0.4});
      sfx('click');
    }
    return;
  }
  const target = pickEntity(mouse.wx, mouse.wy);
  if(target && target.def.mcv && selUnits.length === 1 && selUnits[0] === target){ deployMcv(target); return; }
  // infantry climb into a friendly transport
  if(target && target.cargo && !selUnits.includes(target)){
    const riders = selUnits.filter(u => canBoard(u, target)).slice(0, capacity(target) - target.cargo.length);
    if(riders.length){
      for(const u of riders){ u.order = {type:'board', target}; u.path = null; u.repathT = 0; }
      effects.push({type:'cmd', x: mouse.wx, y: mouse.wy, t: 0, dur: 0.4});
      sfx('click');
      ack('move', riders[0]);
      selUnits = selUnits.filter(u => !riders.includes(u));
      if(!selUnits.length) return;
    }
  }
  if(target && target.cargo && selUnits.length === 1 && selUnits[0] === target && target.cargo.length){ unloadTransport(target); return; }
  // vehicles drive onto a friendly depot, spread over its tiles, centre first
  if(target && target.kind === 'building' && target.def.flat && target.team === PLAYER){
    const veh = selUnits.filter(u => u.def.armor === 'heavy' && !u.def.air);
    if(veh.length){
      veh.forEach((u, i) => {
        const k = [4, 1, 3, 5, 7, 0, 2, 6, 8][i % 9];
        u.order = {type: 'move'};
        orderMove(u, (target.tx + k % 3 + 0.5) * T, (target.ty + Math.floor(k / 3) + 0.5) * T);
      });
      effects.push({type:'cmd', x: mouse.wx, y: mouse.wy, t: 0, dur: 0.4});
      sfx('click'); ack('move', veh[0]);
      selUnits = selUnits.filter(u => !veh.includes(u));
      if(!selUnits.length) return;
    }
  }
  // jets sent back to base by right-clicking an airfield
  const jets = selUnits.filter(u => u.def.jet);
  if(jets.length && target && target.kind === 'building' && target.def.pads && target.team === PLAYER){
    for(const u of jets){
      u.order = {type:'idle'}; u.path = null;
      if(!u.pad || u.pad.b !== target){
        const i = target.def.pads.findIndex((_, k) => !padTaken(target, k));
        if(i >= 0) u.pad = {b: target, i};
      }
    }
    sfx('click'); ack('move', jets[0]);
    selUnits = selUnits.filter(u => !u.def.jet);
    if(!selUnits.length) return;
  }
  // infiltrators walk into enemy buildings
  const spies = selUnits.filter(u => u.def.spy);
  if(spies.length && spyCan(target, PLAYER)){
    for(const u of spies){ u.order = {type:'capture', target}; u.path = null; u.repathT = 0; }
    effects.push({type:'cmd', x: mouse.wx, y: mouse.wy, t: 0, dur: 0.4, red: true});
    sfx('click'); ack('attack', spies[0]);
    selUnits = selUnits.filter(u => !u.def.spy);
    if(!selUnits.length) return;
  }
  // engineers walk into a building: capture it if it's the enemy's, fix it if it's ours
  const eng = selUnits.filter(u => u.def.engineer);
  if(eng.length && engineerCan(target, PLAYER) && !force){
    for(const u of eng){ u.order = {type:'capture', target}; u.path = null; u.repathT = 0; }
    effects.push({type:'cmd', x: mouse.wx, y: mouse.wy, t: 0, dur: 0.4, red: target.team !== PLAYER});
    sfx('click');
    ack(target.team === PLAYER ? 'move' : 'attack', eng[0]);
    selUnits = selUnits.filter(u => !u.def.engineer);
    if(!selUnits.length) return;
  }
  if(target && target !== selUnits[0] && (target.team === ENEMY || (force && target.team !== PLAYER))){
    let any = false;
    for(const u of selUnits){
      if(!canHurt(u, target)) continue;
      u.order = {type:'attack', target};
      any = true;
    }
    if(any){
      effects.push({type:'cmd', x: mouse.wx, y: mouse.wy, t: 0, dur: 0.4, red: true});
      sfx('click');
      ack('attack', selUnits[0]);
      return;
    }
  }
  const n = selUnits.length;
  const cols = Math.ceil(Math.sqrt(n));
  selUnits.forEach((u, i) => {
    const ox = (i % cols - (cols - 1) / 2) * 30;
    const oy = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * 30;
    const wx = clamp(mouse.wx + ox, T, WPX - T), wy = clamp(mouse.wy + oy, T, HPX - T);
    if(u.def.harvester){
      const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
      if(inMap(tx, ty) && ore[idx(tx, ty)] > 0){ u.hState = 'seek'; u.oreTile = {x: tx, y: ty}; u.order = {type:'idle'}; orderMove(u, tx*T+T/2, ty*T+T/2); }
      else { u.order = {type:'move'}; orderMove(u, wx, wy); }
    } else {
      u.order = force && weaponOf(u) ? {type:'attackmove', x: wx, y: wy} : {type:'move'};
      orderMove(u, wx, wy);
    }
  });
  effects.push({type:'cmd', x: mouse.wx, y: mouse.wy, t: 0, dur: 0.4});
  sfx('click');
  ack('move', selUnits[0]);
}

// ---------- construction vehicle deployment ----------
export function mcvFootprint(u){ return {tx: Math.floor(u.x / T) - 1, ty: Math.floor(u.y / T) - 1}; }
export function canDeploy(u){
  const {tx, ty} = mcvFootprint(u);
  for(let y = ty; y < ty + 3; y++)
    for(let x = tx; x < tx + 3; x++)
      if(!inMap(x, y) || occ[idx(x, y)] !== 0 || ore[idx(x, y)] > 0) return false;
  return true;
}
export function deployMcv(u){
  if(!canDeploy(u)){ if(u.team === PLAYER){ announce('Cannot deploy here', false, 'Cannot deploy here'); sfx('deny'); } return false; }
  const {tx, ty} = mcvFootprint(u);
  u.dead = true;
  const b = placeBuilding('conyard', tx, ty, u.team, false);
  // nudge anyone standing in the footprint out of the way
  for(const v of units){
    if(v.dead || v === u) continue;
    const t = tileOf(v);
    if(t.x >= tx && t.x < tx + 3 && t.y >= ty && t.y < ty + 3){
      const f = freeTileNear(tx + 1, ty + 3, 4);
      if(f){ v.order = {type:'move'}; orderMove(v, f.x * T + T / 2, f.y * T + T / 2); }
    }
  }
  if(u.team === PLAYER){ setSelection([b]); sfx('deploy'); }
  return true;
}

// ---------- unit voices (browser speech, pitched per side) ----------
export const ACK = {
  select: ['Reporting', 'Yes sir', 'Standing by', 'Awaiting orders', 'Ready'],
  move:   ['Moving out', 'Affirmative', 'On my way', 'Acknowledged', 'Double time'],
  attack: ['Attacking', 'Engaging', 'Target acquired', 'Open fire', 'Taking it down'],
};
export let lastAck = 0;
export function ack(kind, u){
  if(!state.voiceOn || !window.speechSynthesis || !u || u.kind !== 'unit') return;
  const now = performance.now();
  if(now - lastAck < 1400 || voice.cur || voice.queue.length) return;   // replies never wait or talk over anyone
  lastAck = now;
  let lines = ACK[kind];
  if(u.def.harvester) lines = kind === 'select' ? ['Miner ready', 'Ore miner'] : ['Heading out', 'Acknowledged'];
  if(u.def.mcv) lines = kind === 'select' ? ['Construction vehicle ready', 'Builder standing by'] : ['Rolling out', 'Moving'];
  if(u.def.voice) lines = u.def.voice[kind] || lines;
  if(u.def.voice === null){ sfx(u.def.key === 'dog' ? 'bark' : 'chirp'); return; }
  voiceLine(lines[Math.floor(Math.random() * lines.length)], VOICE.PRI_UNIT,
            {rate: 1.15, pitch: u.def.armor === 'inf' ? 1.05 : 0.8, volume: 0.8 * settings.voice});
}

// ---------- sell / repair modes ----------
export const repairBtn = document.getElementById('repairBtn');
export const sellBtn = document.getElementById('sellBtn');
export function setMode(m){
  state.mode = m;
  if(m) state.placing = null;
  repairBtn.classList.toggle('on', m === 'repair');
  sellBtn.classList.toggle('on', m === 'sell');
}

export function modeTarget(){
  const b = pickEntity(mouse.wx, mouse.wy);
  return b && b.kind === 'building' && b.team === PLAYER && b.buildUp >= 1 && !b.def.garrison ? b : null;
}

export function applyMode(){
  const b = modeTarget();
  if(!b){ sfx('click'); return; }
  if(state.mode === 'sell') sellBuilding(b);
  else { b.repairing = !b.repairing && b.hp < b.maxHp; sfx('click'); }
}

// sale: half the value back (scaled by damage) and a few survivors walk out
export function sellBuilding(b){
  b.dead = true;
  for(let y = b.ty; y < b.ty + b.h; y++)
    for(let x = b.tx; x < b.tx + b.w; x++)
      if(occ[idx(x, y)] === b.id){ occ[idx(x, y)] = bareOcc(idx(x, y)); walk[idx(x, y)] = 0; }
  state.credits[b.team] += Math.floor(b.def.cost * 0.5 * b.hp / b.maxHp);
  const n = b.w * b.h >= 9 ? 3 : b.w * b.h >= 4 ? 2 : 1;
  for(let i = 0; i < n; i++){
    const spot = freeTileNear(b.tx + (i % b.w), b.ty + b.h - 1, 4);
    if(spot) spawnUnit('rifle', spot.x * T + T / 2, spot.y * T + T / 2, b.team);
  }
  announce('Structure sold', false, 'Structure sold');
  sfx('cash');
}

export function tryPlace(){
  const key = state.placing;
  const def = BUILD_DEFS[key];
  const tx = Math.floor(mouse.wx / T - def.w / 2 + 0.5);
  const ty = Math.floor(mouse.wy / T - def.h / 2 + 0.5);
  if(canPlace(key, tx, ty, PLAYER)){
    placeBuilding(key, tx, ty, PLAYER, false);
    prodQ[def.tab].shift();
    state.placing = null;
    sfx('place');
    if(key === 'refinery'){
      const spot = freeTileNear(tx + 1, ty + def.h, 4);
      if(spot) spawnUnit('harv', spot.x * T + T/2, spot.y * T + T/2, PLAYER);
    }
    refreshSidebar();
  } else {
    announce('Cannot deploy here'); sfx('deny');
  }
}



// ---------- zoom (mouse wheel, +/-) ----------
export let wheelAcc = 0;



export let mmDown = false;
export function mmJump(e){
  if(!radarOn) return;
  const r = mmC.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  state.camX = clamp(fx * IW - VW / 2, 0, Math.max(0, IW - VW));
  state.camY = clamp(fy * IH - VH / 2, 0, Math.max(0, IH - VH));
}

// ---------- camera scroll ----------
export function tickCamera(dt){
  const sp = 680 * dt / Math.sqrt(ZOOM) * settings.scroll;
  if(keys['arrowleft']) state.camX -= sp;
  if(keys['arrowright']) state.camX += sp;
  if(keys['arrowup']) state.camY -= sp;
  if(keys['arrowdown']) state.camY += sp;
  const EDGE = 24;
  if(mouse.inCanvas && !mouse.down){
    if(mouse.x < EDGE) state.camX -= sp;
    if(mouse.x > CW - EDGE) state.camX += sp;
    if(mouse.y < EDGE) state.camY -= sp;
    if(mouse.y > CH - EDGE) state.camY += sp;
  }
  state.camX = clamp(state.camX, 0, Math.max(0, IW - VW));
  state.camY = clamp(state.camY, 0, Math.max(0, IH - VH));
}


// ---------- mouse cursor (context sensitive) ----------
export function cursorType(){
  if(state.mode) return state.mode;
  if(state.placing || mouse.dragging || !state.started) return 'arrow';
  const sel = selection.filter(s => !s.dead && s.team === PLAYER);
  const su = sel.filter(s => s.kind === 'unit');
  const t = pickEntity(mouse.wx, mouse.wy);
  if(su.length){
    if(t && t.def.mcv && su.length === 1 && su[0] === t) return canDeploy(t) ? 'deploy' : 'nodeploy';
    if(t && t.def.transport && su.length === 1 && su[0] === t) return t.cargo.length ? 'deploy' : 'select';
    if(t && t.cargo && su.some(u => canBoard(u, t))) return 'enter';
    if(t && t.kind === 'building' && t.def.flat && t.team === PLAYER && su.some(u => u.def.armor === 'heavy' && !u.def.air)) return 'enter';
    if(su.some(u => u.def.spy) && spyCan(t, PLAYER)) return 'capture';
    if(su.some(u => u.def.engineer) && engineerCan(t, PLAYER) && !keys['control'] && !keys['meta'])
      return t.team === PLAYER ? 'fix' : 'capture';
    if(t && t.team === ENEMY && su.some(u => canHurt(u, t))) return 'attack';
    if(t && t.team === PLAYER && !t.def.noSelect) return 'select';
    const tx = Math.floor(mouse.wx / T), ty = Math.floor(mouse.wy / T);
    if(!inMap(tx, ty)) return 'nomove';
    if(su.every(u => u.def.naval)){ if(!sailable(tx, ty) && explored[idx(tx, ty)]) return 'nomove'; }
    else if(!passable(tx, ty) && explored[idx(tx, ty)] && !su.every(u => u.def.air)) return 'nomove';
    return 'move';
  }
  if(t && t.cargo && t.cargo.length && t.team === PLAYER && sel.includes(t)) return 'deploy';
  if(t && t.team === PLAYER && !t.def.noSelect) return 'select';
  if(sel.some(b => b.kind === 'building' && PRODUCERS.has(b.def.key))) return 'rally';
  return 'arrow';
}


// ---------- HUD ----------
export const creditsEl = document.getElementById('credits');
export const powerLbl = document.getElementById('powerlbl');
export const powerBar = document.getElementById('powerBar');
export const powerDrain = document.getElementById('powerDrain');
export const clockEl = document.getElementById('clock');
export let shownCredits = 0;
export function drawHUD(dt){
  const target = Math.floor(state.credits[PLAYER]);
  if(shownCredits !== target){
    const delta = target - shownCredits;
    shownCredits += Math.sign(delta) * Math.max(1, Math.min(Math.abs(delta), Math.ceil(Math.abs(delta) * dt * 6)));
  }
  creditsEl.textContent = shownCredits.toLocaleString();
  const p = powerOf(PLAYER);
  state.lowPower = p.used > p.prod;
  powerLbl.textContent = `⚡ ${p.used}/${p.prod}`;
  powerLbl.classList.toggle('low', state.lowPower);
  const pScale = Math.max(p.prod, p.used, 100) * 1.15;
  powerBar.style.height = (p.prod / pScale * 100) + '%';
  powerDrain.style.bottom = (p.used / pScale * 100) + '%';
  // flash a tab whose production is ready while another tab is open
  tabsEl.forEach(t => {
    const s = prodQ[t.dataset.tab][0];
    t.classList.toggle('alert', !!s && s.ready && t.dataset.tab !== activeTab);
  });
  powerBar.classList.toggle('low', state.lowPower);
  const secs = Math.floor(state.time + 1e-3), m = Math.floor(secs / 60), sec = secs % 60;   // the epsilon hides fixed-step rounding (29.9999)
  clockEl.textContent = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

// Mouse, keyboard and sidebar listeners. main.js calls this once every module has loaded
// (the canvas lives in render.js, which imports this module too).
export function initUI(){
  tabsEl.forEach(t => t.addEventListener('click', () => {
    tabsEl.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    activeTab = t.dataset.tab;
    buildSidebar();
    sfx('click');
  }));
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('mousemove', e => {
    updateMouseWorld(e);
    mouse.inCanvas = true;
    if(mouse.down && Math.hypot(mouse.x - mouse.dragX, mouse.y - mouse.dragY) > 5) mouse.dragging = true;
  });
  cv.addEventListener('mouseleave', () => { mouse.inCanvas = false; });
  cv.addEventListener('mousedown', e => {
    if(!state.started || state.over) return;
    updateMouseWorld(e);
    if(e.button === 0){
      if(state.mode){ applyMode(); return; }
      if(state.placing){ tryPlace(); return; }
      mouse.down = true; mouse.dragging = false;
      mouse.dragX = mouse.x; mouse.dragY = mouse.y;
    } else if(e.button === 2){
      if(state.mode){ setMode(null); return; }
      if(state.placing){ state.placing = null; return; }
      issueCommand(e);
    }
  });
  window.addEventListener('mouseup', e => {
    if(e.button !== 0 || !mouse.down) return;
    mouse.down = false;
    if(!state.started || state.over) return;
    if(mouse.dragging){
      // selection box in iso screen space
      const x1 = Math.min(mouse.dragX, mouse.x) / ZOOM + state.camX, x2 = Math.max(mouse.dragX, mouse.x) / ZOOM + state.camX;
      const y1 = Math.min(mouse.dragY, mouse.y) / ZOOM + state.camY, y2 = Math.max(mouse.dragY, mouse.y) / ZOOM + state.camY;
      const picked = units.filter(u => {
        if(!onMap(u) || u.team !== PLAYER || u.def.noSelect) return false;
        const p = isoAt(u.x, u.y, u.z || 0);
        return p.x >= x1 && p.x <= x2 && p.y >= y1 - 10 && p.y <= y2 + 6;
      });
      if(picked.length){ setSelection(picked); sfx('click'); ack('select', picked[0]); }
      else if(!e.shiftKey) setSelection([]);
    } else {
      const e2 = pickEntity(mouse.wx, mouse.wy);
      if(e2 && e2.def.mcv && e2.team === PLAYER && selection.length === 1 && selection[0] === e2){
        deployMcv(e2);
      } else if(e2 && e2.cargo && e2.team === PLAYER && selection.length === 1 && selection[0] === e2 && e2.cargo.length){
        unloadTransport(e2);
      } else if(e2 && e2.team === PLAYER && !e2.def.noSelect){
        if(!selection.includes(e2)) ack('select', e2);
        if(e.shiftKey){ if(!selection.includes(e2)) selection.push(e2); }
        else setSelection([e2]);
        sfx('click');
      } else if(!e.shiftKey) setSelection([]);
    }
    mouse.dragging = false;
  });
  repairBtn.addEventListener('click', () => { sfx('click'); setMode(state.mode === 'repair' ? null : 'repair'); });
  sellBtn.addEventListener('click', () => { sfx('click'); setMode(state.mode === 'sell' ? null : 'sell'); });
  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if(!state.started) return;
    // Esc drops a placement or sell/repair mode first; otherwise it opens or closes the pause menu
    if(e.key === 'Escape'){
      if(state.placing || state.mode){ state.placing = null; setMode(null); }
      else toggleMenu();
      return;
    }
    if(state.menu) return;
    if(e.key.toLowerCase() === 'k') setMode(state.mode === 'repair' ? null : 'repair');
    if(e.key.toLowerCase() === 'l') setMode(state.mode === 'sell' ? null : 'sell');
    if(e.key.toLowerCase() === 'h'){
      const cy = buildings.find(b => !b.dead && b.team === PLAYER && b.def.key === 'conyard') ||
                 buildings.find(b => !b.dead && b.team === PLAYER);
      if(cy){ const p = toIso(cy.x, cy.y); state.camX = clamp(p.x - VW / 2, 0, IW - VW); state.camY = clamp(p.y - VH / 2, 0, IH - VH); }
    }
    if(e.key.toLowerCase() === 'd'){
      const m = selection.find(u => !u.dead && u.kind === 'unit' && u.def.mcv);
      if(m) deployMcv(m);
      for(const t of selection) if(!t.dead && t.cargo && t.team === PLAYER) unloadTransport(t);
      // riflemen dig in behind sandbags, or climb out again
      const diggers = selection.filter(u => !u.dead && u.kind === 'unit' && u.def.deploy);
      const on = diggers.some(u => !u.deployed);
      for(const u of diggers){ u.deployed = on; u.order = {type:'idle'}; u.path = null; }
      if(diggers.length) sfx('click');
    }
    if(e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey){
      for(const u of selection) if(u.kind === 'unit'){ u.order = {type:'idle'}; u.path = null; }
    }
    const d = parseInt(e.key);
    if(d >= 1 && d <= 9){
      if(e.ctrlKey || e.metaKey){ groups[d] = selection.slice(); e.preventDefault(); }
      else if(groups[d]){ setSelection(groups[d].filter(u => !u.dead && !u.inside && !u.latched)); }
    }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);   // Firefox counts a mouse notch in lines
    if(Math.abs(wheelAcc) < 40) return;            // trackpads send many tiny deltas
    updateMouseWorld(e);
    stepZoom(wheelAcc < 0 ? 1 : -1, mouse.x, mouse.y);
    wheelAcc = 0;
  }, {passive: false});
  window.addEventListener('keydown', e => {
    if(e.key === '+' || e.key === '=') stepZoom(1);
    if(e.key === '-' || e.key === '_') stepZoom(-1);
  });
  mmC.addEventListener('mousedown', e => { mmDown = true; mmJump(e); });
  window.addEventListener('mousemove', e => { if(mmDown) mmJump(e); });
  window.addEventListener('mouseup', () => { mmDown = false; });
}
