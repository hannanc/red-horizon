// Red Horizon: Map setup, the main loop, world (re)building, the start screen and the window.__RH test handle.
import {AI_QUEUE, DIFFICULTY, ai, diff, setDifficulty, tickAI} from './ai.js';
import {applyDamage, boom, canHurt, scorch, updateProjectiles} from './combat.js';
import {resetIds, BLOCKED, ENEMY, FACTION, IH, IW, MH, MW, NEUTRAL, PLAYER, SIDE_NAME, T, TEAM_COLOR, TOPBAR_H, UNIT_DEFS, buildings, clamp, doodads, effects, explored, flags, groundZ, idx, inMap, lakeVal, occ, onRoad, ore, passable, projectiles, sailable, selection, setSelection, setup, state, toIso, units, walk, water, weaponOf, settings, saveSettings} from './data.js';
import {orderMove, findPath} from './pathfinding.js';
import {VH, VW, ZOOM, cx, draw, drawMinimap, paintLow, radarOn, radarT, scorches, startTerrainWorkers, setZoom} from './render.js';
import {initUI, announce, audio, buildSidebar, clockEl, drawHUD, groups, sfx, speak, tickCamera} from './ui.js';
import {canBoard, canPlace, deliverUnit, placeBuilding, powerOf, prodQ, radPuddles, radSources, revealAround, spawnUnit, tickProduction, tickRadiation, treeDisguised, unloadTransport, updateBuilding, updateUnit} from './units.js';
import {rand, seedRandom} from './rng.js';
import {SLOTS, readSlot, restore, slotInfo, snapshot, writeSlot} from './save.js';

initUI();

/* =========================================================
   RED HORIZON — a classic 2.5D real-time strategy game
   Units and buildings are pre-rendered 3D sprites (see
   tools/sprites); the procedural drawing below is only a
   fallback for when the sprite sheets are unavailable.
   ========================================================= */


export function seedOre(cxT, cyT, radius, amount){
  for(let y = cyT - radius; y <= cyT + radius; y++)
    for(let x = cxT - radius; x <= cxT + radius; x++){
      if(!inMap(x, y) || occ[idx(x, y)] !== 0) continue;
      const d = Math.hypot(x - cxT, y - cyT);
      if(d <= radius && rand() > d / radius * 0.55)
        ore[idx(x, y)] = amount * (0.6 + rand() * 0.8);
    }
}


// ---------- win / lose ----------
export let lowPowerWarned = false;
export function checkEnd(){
  if(state.over) return;
  const pB = buildings.some(b => !b.dead && b.team === PLAYER && !b.def.garrison) || units.some(u => !u.dead && u.team === PLAYER && u.def.mcv);
  const eB = buildings.some(b => !b.dead && b.team === ENEMY && !b.def.garrison);
  if(!eB || !pB){
    state.over = true;
    const win = !eB;
    document.getElementById('endTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
    document.getElementById('endTitle').style.color = win ? '#39d353' : '#e04040';
    document.getElementById('endText').textContent = win
      ? `The ${SIDE_NAME[FACTION[ENEMY]]} base has been reduced to rubble in ${clockEl.textContent} on ${diff.name}. Outstanding, Commander!`
      : `Your base has fallen on ${diff.name}. The red banner flies over the ruins.`;
    document.getElementById('endScreen').style.display = 'flex';
    speak(win ? 'Mission accomplished' : 'Command link lost');
    sfx(win ? 'ready' : 'alert');
  }
}

// ---------- map setup ----------
export function setupScenery(){
  // lakes are impassable
  for(let y = 0; y < MH; y++)
    for(let x = 0; x < MW; x++)
      if(lakeVal(x + 0.5, y + 0.5) > -0.04){ occ[idx(x, y)] = BLOCKED; water[idx(x, y)] = 1; }
  // plateau: its cliff tiles are impassable; the top and the ramps are open ground
  const E = new Float32Array(MW * MH), P = TerrainGen.PLATEAU;
  for(let y = 0; y < MH; y++) for(let x = 0; x < MW; x++) E[idx(x, y)] = groundZ((x + 0.5) * T, (y + 0.5) * T) / TerrainGen.CLIFF_H;
  for(let y = 1; y < MH - 1; y++)
    for(let x = 1; x < MW - 1; x++){
      const i = idx(x, y), ramp = TerrainGen.onRamp(x + 0.5, y + 0.5);
      if(ramp || occ[i]) continue;
      const nb = [E[idx(x + 1, y)], E[idx(x - 1, y)], E[idx(x, y + 1)], E[idx(x, y - 1)]];
      if((E[i] > 0 && E[i] < 0.999) || (E[i] >= 0.999 && nb.some(e => e < 0.999))) occ[i] = BLOCKED;
    }
  // tree clumps and rocks, kept clear of bases, ore fields, the town, the plateau and the map edge
  const map = TerrainGen.map, [home, hub] = map.bases;
  const keepClear = [[home.x, home.y, 11], [hub.x + 1, hub.y + 1, 11], ...map.ore.map(([x, y, r]) => [x, y, r + 2])];
  if(map.town) keepClear.push([map.town.x, map.town.y, 8]);
  if(P) keepClear.push([P.x, P.y, P.r + 3]);
  const clear = (x, y) => x > 1 && y > 1 && x < MW - 2 && y < MH - 2 && occ[idx(x, y)] === 0 && !onRoad(x, y) &&
    keepClear.every(([cx, cy, r]) => Math.hypot(x - cx, y - cy) > r);
  let s = map.trees;                       // each map has its own woods
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const trees = Sprites.get('tree'), rocks = Sprites.get('rock');
  if(!trees) return;
  for(let c = 0; c < 26; c++){
    const cx0 = 2 + rnd() * (MW - 4), cy0 = 2 + rnd() * (MH - 4);
    const n = 3 + Math.floor(rnd() * 7);
    for(let i = 0; i < n; i++){
      const x = Math.floor(cx0 + (rnd() - 0.5) * 5), y = Math.floor(cy0 + (rnd() - 0.5) * 5);
      if(!clear(x, y)) continue;
      occ[idx(x, y)] = BLOCKED;
      doodads.push({kind: 'doodad', name: 'tree', frame: Math.floor(rnd() * trees.frames),
                    tx: x, ty: y, x: (x + 0.3 + rnd() * 0.4) * T, y: (y + 0.3 + rnd() * 0.4) * T});
    }
  }
  for(let i = 0; rocks && i < 14; i++){
    const x = Math.floor(2 + rnd() * (MW - 4)), y = Math.floor(2 + rnd() * (MH - 4));
    if(!clear(x, y)) continue;
    occ[idx(x, y)] = BLOCKED;
    doodads.push({kind: 'doodad', name: 'rock', frame: Math.floor(rnd() * rocks.frames),
                  tx: x, ty: y, x: (x + 0.5) * T, y: (y + 0.5) * T});
  }
}

// a small neutral town around the crossroads
export function setupTown(){
  const map = TerrainGen.map;
  (map.town ? map.town.lots : []).forEach(([x, y], i) => {
    if(!inMap(x, y) || !inMap(x + 1, y + 1)) return;
    for(let yy = y; yy < y + 2; yy++) for(let xx = x; xx < x + 2; xx++) if(occ[idx(xx, yy)] !== 0) return;
    const b = placeBuilding('civ', x, y, NEUTRAL, true);
    b.variant = (i * 5 + 1) % 6;
  });
  if(!Sprites.get('lamp')) return;
  for(const R of map.roads)
    for(let a = R.from + 2; a < R.to - 1; a += 4){
      const x = R.axis === 'x' ? a : R.c + 1.3, y = R.axis === 'x' ? R.c + 1.3 : a;
      doodads.push({kind: 'doodad', name: 'lamp', frame: 0, tx: Math.floor(x), ty: Math.floor(y), x: x * T, y: y * T});
    }
}

// Trees must never wall one base off from the other: if no path joins them, clear the woods along
// the straight line between them (lakes and cliffs are laid out by the map with room to spare).
function openWay(a, b){
  if(findPath(a.x, a.y, b.x, b.y)) return;
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
  for(let i = 0; i <= n; i++){
    const x = Math.round(a.x + (b.x - a.x) * i / n), y = Math.round(a.y + (b.y - a.y) * i / n);
    for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){
      const tx = x + dx, ty = y + dy;
      if(!inMap(tx, ty) || occ[idx(tx, ty)] !== BLOCKED || water[idx(tx, ty)] || groundZ((tx + 0.5) * T, (ty + 0.5) * T) > 0) continue;
      occ[idx(tx, ty)] = 0;
      for(let k = doodads.length - 1; k >= 0; k--) if(doodads[k].tx === tx && doodads[k].ty === ty) doodads.splice(k, 1);
    }
  }
}

export function setupMap(){
  const map = TerrainGen.map;
  setupScenery();
  openWay({x: map.bases[0].x, y: map.bases[0].y}, {x: map.bases[1].x + 1, y: map.bases[1].y + 3});
  setupTown();
  for(const [x, y, r, amount] of map.ore) seedOre(x, y, r, amount);

  // the player: a construction vehicle and a few units at the first base, facing the middle of the map
  const b0 = map.bases[0], sx = Math.sign(32 - b0.x), sy = Math.sign(32 - b0.y);
  const mcv = spawnUnit('mcv', (b0.x + 0.5) * T, (b0.y + 0.5) * T, PLAYER);
  mcv.face = Math.atan2(sy, sx);
  setSelection([mcv]);
  for(const [ox, oy] of [[2.5, 2.5], [3.2, 1.8], [3.9, 1.1]]) spawnUnit('rifle', (b0.x + ox * sx) * T, (b0.y + oy * sy) * T, PLAYER);
  spawnUnit('ltank', (b0.x + 4 * sx) * T, (b0.y - sy) * T, PLAYER);
  revealAround((b0.x + 0.5) * T, (b0.y + 0.5) * T, 11);

  // the AI starts like the player, from a construction hub and a few units, and builds its own base (aiBase)
  const b1 = map.bases[1], ex = Math.sign(32 - b1.x), ey = Math.sign(32 - b1.y);
  placeBuilding('conyard', b1.x, b1.y, ENEMY, true);
  spawnUnit('rifle', (b1.x + ex) * T, (b1.y + 7 * ey) * T, ENEMY);
  spawnUnit('rifle', b1.x * T, (b1.y + 8 * ey) * T, ENEMY);
  spawnUnit('ltank', (b1.x - 3 * ex) * T, (b1.y + 8.5 * ey) * T, ENEMY);

  const home = toIso((b0.x + 0.5) * T, (b0.y + 0.5) * T);
  state.camX = clamp(home.x - VW / 2, 0, Math.max(0, IW - VW));
  state.camY = clamp(home.y - VH / 2, 0, Math.max(0, IH - VH));
}

// ---------- main loop ----------
export let lastFrame = performance.now();
export let fogT = 0, endT = 0, mmT = 0;
// The simulation advances in fixed steps of STEP seconds, however fast frames come;
// the screen is redrawn every frame.
export const STEP = 1 / 30;
let simAcc = 0;
export function loop(now){
  const dt = Math.min(0.25, (now - lastFrame) / 1000);   // real time since the last frame (capped after a stall)
  lastFrame = now;

  if(state.started && !state.over && !state.paused){
    tickCamera(dt);
    simAcc += dt;
    while(simAcc >= STEP && !state.over){ tick(STEP); simAcc -= STEP; }
  } else {
    if(state.started) tickCamera(dt);
    simAcc = 0;
  }

  draw();
  drawHUD(dt);
  mmT -= dt;
  if(mmT <= 0){ mmT = radarT < 1 && radarOn ? 0.04 : 0.2; drawMinimap(); }

  requestAnimationFrame(loop);
}

export function tick(dt){
    state.time += dt;
    tickProduction(dt);
    tickAI(dt);
    for(const u of units) if(!u.dead) updateUnit(u, dt);
    for(const b of buildings) if(!b.dead) updateBuilding(b, dt);
    updateProjectiles(dt);
    tickRadiation(dt);

    const spawned = [];
    for(const e of effects){
      e.t += dt;
      if(e.type === 'spark'){ e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 300 * dt; }
      else if(e.type === 'puff'){ e.z += dt * 14; }
      else if(e.type === 'delay' && e.t >= e.dur){ spawned.push(e.then); }
      else if(e.type === 'charge'){
        if(e.target.dead) e.t = e.dur;
        else { e.x = e.target.x; e.y = e.target.y; if(e.t >= e.dur) spawned.push({charge: e}); }
      }
      else if(e.type === 'smokecol'){
        e.acc += dt;
        while(e.acc > 0.14){
          e.acc -= 0.14;
          spawned.push({puff: true, x: e.x + (rand() - .5) * 10, y: e.y + (rand() - .5) * 10,
                        z: 6, r: 7 + rand() * 5, dur: 1.6 + rand() * 0.8, dark: true});
        }
      }
    }
    for(const s of spawned){
      if(s.charge){
        const c = s.charge;
        applyDamage(c.target, c.dmg, c.vs, c.src.dead ? null : c.src);
        boom(c.x, c.y, 34); scorch(c.x, c.y, 26); sfx('explosion');
        continue;
      }
      if(s.puff) effects.push({type:'puff', x: s.x, y: s.y, z: s.z, r: s.r, t: 0, dur: s.dur, dark: s.dark});
      else { boom(s.x, s.y, s.size); sfx('explosion'); }
    }
    for(let i = effects.length - 1; i >= 0; i--) if(effects[i].t >= effects[i].dur) effects.splice(i, 1);
    for(let i = projectiles.length - 1; i >= 0; i--) if(projectiles[i].dead) projectiles.splice(i, 1);
    for(let i = units.length - 1; i >= 0; i--) if(units[i].dead) units.splice(i, 1);
    for(let i = buildings.length - 1; i >= 0; i--) if(buildings[i].dead) buildings.splice(i, 1);
    setSelection(selection.filter(s => !s.dead && !s.latched && !s.inside));

    fogT -= dt;
    if(fogT <= 0){
      fogT = 0.4;
      for(const u of units) if(!u.dead && u.team === PLAYER) revealAround(u.x, u.y, 6);
      for(const b of buildings) if(!b.dead && b.team === PLAYER) revealAround(b.x, b.y, 7);
    }
    if(state.lowPower && !lowPowerWarned){ lowPowerWarned = true; announce('Low power', true, 'Low power'); }
    if(!state.lowPower) lowPowerWarned = false;

    endT -= dt;
    if(endT <= 0){ endT = 1; checkEnd(); }
}

// ---------- boot ----------
// difficulty is picked on the start screen and locked once the game begins
export let diffKey = 'normal';
try { diffKey = localStorage.getItem('rh-difficulty') || diffKey; } catch(e){}
if(!DIFFICULTY[diffKey]) diffKey = 'normal';
export function showDifficulty(){
  document.querySelectorAll('#diffRow button').forEach(b => b.classList.toggle('on', b.dataset.diff === diffKey));
  document.getElementById('diffNote').textContent = DIFFICULTY[diffKey].note;
}
document.querySelectorAll('#diffRow button').forEach(b => b.addEventListener('click', () => {
  diffKey = b.dataset.diff;
  try { localStorage.setItem('rh-difficulty', diffKey); } catch(e){}
  showDifficulty();
}));
showDifficulty();
// skirmish setup: side, starting credits, map and seed, remembered like the difficulty
export function saveSetup(){ try { localStorage.setItem('rh-setup', JSON.stringify(setup)); } catch(e){} showSetup(); }
export function showSetup(){
  document.querySelectorAll('[data-side]').forEach(b => b.classList.toggle('on', b.dataset.side === setup.side));
  document.querySelectorAll('[data-credits]').forEach(b => b.classList.toggle('on', +b.dataset.credits === setup.credits));
  document.querySelectorAll('[data-map]').forEach(b => b.classList.toggle('on', b.dataset.map === setup.map));
  document.getElementById('seedIn').value = setup.seed;
  document.getElementById('seedNote').textContent = setup.map === 'random' ? 'picks the random map and the game\'s luck' : 'the game\'s luck';
  document.getElementById('sideMe').textContent = SIDE_NAME[setup.side];
  document.getElementById('sideThem').textContent = SIDE_NAME[setup.side === 'allied' ? 'soviet' : 'allied'];
}
document.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => { setup.side = b.dataset.side; saveSetup(); }));
document.querySelectorAll('[data-credits]').forEach(b => b.addEventListener('click', () => { setup.credits = +b.dataset.credits; saveSetup(); }));
document.getElementById('seedIn').addEventListener('change', e => { setup.seed = clamp(Math.floor(+e.target.value) || 1, 1, 99999); saveSetup(); });
document.getElementById('seedRnd').addEventListener('click', () => { setup.seed = 2 + Math.floor(Math.random() * 99990); saveSetup(); });
document.querySelectorAll('[data-map]').forEach(b => b.addEventListener('click', () => { setup.map = b.dataset.map; saveSetup(); }));

// money and AI timers for a new game on the chosen difficulty
function beginGame(){
  setDifficulty(diffKey);
  state.credits[PLAYER] = setup.credits;
  state.credits[ENEMY] = Math.round(diff.credits * setup.credits / 8000);
}

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('help').style.display = 'none';
  if(state.started){ closeMenu(); return; }   // it reads RESUME once the game is on
  if(!state.started){
    if(JSON.stringify(setup) !== worldSetup) newWorld();   // the settings changed since the preview map was built
    state.started = true;
    beginGame();
    document.getElementById('setupBox').style.display = 'none';
    document.getElementById('startBtn').textContent = 'RESUME';
    audio();
    announce('Command link established', false, 'Command link established');
  }
});
document.getElementById('helpBtn').addEventListener('click', () => {
  if(state.started) toggleMenu();
  else document.getElementById('help').style.display = 'flex';
});

// ---------- pause menu ----------
const menuEl = document.getElementById('menu');
const SLIDERS = [['volSfx', 'sfx', 100, v => v + '%'], ['volVoice', 'voice', 100, v => v + '%'], ['scrollSpd', 'scroll', 100, v => (v / 100).toFixed(2) + 'x']];
function showSettings(){
  for(const [id, key, k, fmt] of SLIDERS){
    const el = document.getElementById(id), v = Math.round(settings[key] * k);
    el.value = v; el.nextElementSibling.textContent = fmt(v);
  }
}
for(const [id, key, k] of SLIDERS)
  document.getElementById(id).addEventListener('input', e => { settings[key] = +e.target.value / k; saveSettings(); showSettings(); });
export function openMenu(){
  if(!state.started || state.over || state.menu) return;
  state.menu = true; state.paused = true;
  showSettings(); showSaves(false);
  menuEl.style.display = 'flex';
  sfx('click');
}
export function closeMenu(){
  if(menuEl.classList.contains('title')){ menuEl.classList.remove('title'); menuEl.style.display = 'none'; return; }
  if(!state.menu) return;
  state.menu = false; state.paused = false;
  menuEl.style.display = 'none';
}
export function toggleMenu(){ if(state.menu) closeMenu(); else openMenu(); }
// the same skirmish again from the start: same side, map, credits and difficulty
export function restartGame(){
  closeMenu();
  document.getElementById('endScreen').style.display = 'none';
  Object.assign(state, {time: 0, over: false, paused: false, lowPower: false, attackAlertT: -99, chargeMsgT: -99});
  newWorld();
  beginGame();
  announce('Command link established', false, 'Command link established');
}
document.getElementById('mResume').addEventListener('click', closeMenu);

// ---------- save / load ----------
const slotsEl = document.getElementById('slots');
const clockText = t => { t = Math.floor(t + 1e-3); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function showSaves(on){
  menuEl.classList.toggle('saves', on);
  document.getElementById('mSaves').textContent = on ? 'BACK' : 'SAVE / LOAD';
  document.getElementById('mResume').textContent = menuEl.classList.contains('title') ? 'BACK' : 'RESUME';
  menuEl.querySelector('h1').textContent = menuEl.classList.contains('title') ? 'LOAD GAME' : on ? 'SAVE / LOAD' : 'PAUSED';
  if(!on) return;
  slotsEl.innerHTML = '';
  for(let n = 1; n <= SLOTS; n++){
    const m = slotInfo(n), row = document.createElement('div');
    row.className = 'slotRow';
    row.innerHTML = `<div class="info"><b>${n}.</b> ${m ? `${SIDE_NAME[m.side]} · ${m.map} · ${DIFFICULTY[m.diff].name} · ${clockText(m.time)}
      <small>saved ${new Date(m.date).toLocaleString()}</small>` : '<i>empty</i>'}</div>
      <button class="save" data-slot="${n}">SAVE</button><button class="load" data-slot="${n}"${m ? '' : ' disabled'}>LOAD</button>`;
    slotsEl.appendChild(row);
  }
}
slotsEl.addEventListener('click', e => {
  const n = +e.target.dataset.slot;
  if(!n) return;
  if(e.target.classList.contains('save')){ saveGame(n); showSaves(true); }
  else if(e.target.classList.contains('load')) loadGame(n);
});
document.getElementById('mSaves').addEventListener('click', () => showSaves(!menuEl.classList.contains('saves')));
document.getElementById('loadBtn').addEventListener('click', () => {
  menuEl.classList.add('title');
  menuEl.style.display = 'flex';
  showSaves(true);
});
// the map is rebuilt from its seed, then everything that moved since is put back on top
export function saveGame(n){
  const ok = writeSlot(n, {meta: {side: setup.side, map: TerrainGen.map.name, diff: diffKey, time: state.time, date: Date.now()},
                           setup: {...setup}, diff: diffKey, data: snapshot({fogT, endT, lowPowerWarned})});
  announce(ok ? 'Game saved' : 'Save failed: browser storage is full', !ok, ok ? 'Game saved' : null);
  return ok;
}
export function loadGame(n){
  const s = readSlot(n);
  if(!s) return false;
  closeMenu();
  for(const id of ['help', 'endScreen']) document.getElementById(id).style.display = 'none';
  Object.assign(setup, s.setup);
  diffKey = s.diff; showDifficulty();
  state.over = false;
  newWorld();
  setDifficulty(diffKey);
  const x = restore(s.data);
  fogT = x.fogT; endT = x.endT; lowPowerWarned = x.lowPowerWarned; simAcc = 0;
  if(!state.started){
    state.started = true;
    document.getElementById('setupBox').style.display = 'none';
    document.getElementById('startBtn').textContent = 'RESUME';
    audio();
  }
  buildSidebar();
  announce('Game loaded', false, 'Game loaded');
  return true;
}
document.getElementById('mRestart').addEventListener('click', restartGame);
document.getElementById('mQuit').addEventListener('click', () => location.reload());   // back to the start screen
document.getElementById('mHelp').addEventListener('click', () => {
  menuEl.style.display = 'none';
  document.getElementById('help').style.display = 'flex';
});
document.getElementById('endAgain').addEventListener('click', restartGame);
document.getElementById('sndBtn').addEventListener('click', function(){
  state.sndOn = !state.sndOn;
  this.textContent = (state.sndOn ? '🔊' : '🔇') + ' SFX';
});
document.getElementById('voiceBtn').addEventListener('click', function(){
  state.voiceOn = !state.voiceOn;
  this.textContent = (state.voiceOn ? '🗣' : '🤐') + ' Voice';
  if(!state.voiceOn && window.speechSynthesis) speechSynthesis.cancel();
});

// Build (or rebuild) the whole world from the skirmish setup: sides, terrain seed, map.
export let worldSetup = '';
export function newWorld(){
  seedRandom(setup.seed * 2654435761);   // the same map seed replays the same game
  resetIds();
  units.length = buildings.length = projectiles.length = effects.length = 0;
  radPuddles.length = doodads.length = scorches.length = 0;
  occ.fill(0); walk.fill(0); water.fill(0); ore.fill(0); explored.fill(0);
  setSelection([]); for(const k in groups) delete groups[k];
  for(const k in prodQ) prodQ[k].length = 0;
  state.placing = null; state.mode = null; state.blackout.fill(0);
  flags.shroudDirty = true; flags.mmBaseDirty = true;
  FACTION[PLAYER] = setup.side; FACTION[ENEMY] = setup.side === 'allied' ? 'soviet' : 'allied';
  document.body.classList.toggle('soviet', setup.side === 'soviet');   // the sidebar takes the side's colours
  Object.assign(ai, {prodQ: AI_QUEUE[FACTION[ENEMY]], prodI: 0, prodProgress: 0, prodKey: null, picked: false, bKey: null, bProg: 0, bThink: 0, bSkip: {},
                     airT: 0, navT: 0, navI: 0, engT: 0, repT: 0});
  TerrainGen.setMap(TerrainGen.makeMap(setup.map, setup.seed));
  paintLow();
  setupMap();
  startTerrainWorkers(state.camX + VW / 2, state.camY + VH / 2);
  buildSidebar();
  showSetup();
  worldSetup = JSON.stringify(setup);
}

// sprites first (the map scatters trees from the sheet), then the world
Sprites.load(TEAM_COLOR)
  .catch(err => console.warn('Sprite sheets unavailable, using fallback drawing:', err))
  .finally(() => {
    newWorld();
    requestAnimationFrame(loop);
    window.__RH.ready = true;
  });

// debug/testing handle
// Tests (tests/*.spec.js) wait for `ready`, call start(), pause(true) to stop the
// real-time clock, then advance the game deterministically with step().
window.__RH = {
  ready: false,
  start(){ document.getElementById('startBtn').click(); },
  pause(on = true){ state.paused = on; },
  weaponOf, canHurt, get UNIT_DEFS(){ return UNIT_DEFS; }, get effects(){ return effects; },
  get units(){ return units; }, get buildings(){ return buildings; },
  get selection(){ return selection; }, get state(){ return state; },
  spawn(key, tx, ty, team = PLAYER){ return spawnUnit(key, tx * T + T / 2, ty * T + T / 2, team); },
  deliver(key, team = PLAYER){ return deliverUnit(key, team); },   // as if its factory had just finished it
  canPlace, canBoard, applyDamage, powerOf, get prodQ(){ return prodQ; }, radiation: () => radSources(), treeDisguised, sailable, passable, unload: t => unloadTransport(t), reveal: (tx, ty, r) => revealAround(tx * T, ty * T, r), faction: FACTION, get plateau(){ return TerrainGen.PLATEAU; }, get map(){ return TerrainGen.map; }, onRamp: TerrainGen.onRamp, groundZ,
  world: () => ({water: Array.from(water).join(''), trees: doodads.filter(d => d.name !== 'lamp').map(d => d.tx + ',' + d.ty).join(';')}),
  orderMove,
  block(tx, ty){ occ[idx(tx, ty)] = BLOCKED; },
  place(key, tx, ty, team = PLAYER){ return placeBuilding(key, tx, ty, team, true); },
  select(list){ setSelection(list); },
  // make a patch of ground open (no trees, rocks or water) so a test arena is predictable
  clear(tx, ty, w, h, keepWater){
    for(let y = ty; y < ty + h; y++) for(let x = tx; x < tx + w; x++)
      if(inMap(x, y) && occ[idx(x, y)] === BLOCKED && !(keepWater && water[idx(x, y)])){ occ[idx(x, y)] = 0; water[idx(x, y)] = 0; }
    for(let i = doodads.length - 1; i >= 0; i--){ const d = doodads[i]; if(d.tx >= tx && d.tx < tx + w && d.ty >= ty && d.ty < ty + h) doodads.splice(i, 1); }
  },
  get ai(){ return ai; },
  zoom: z => setZoom(z),
  // rebuild the world from other setup choices (before the game starts), e.g. rebuild({map: 'random', seed: 5})
  rebuild(opts){ Object.assign(setup, opts); newWorld(); },
  settings, restart: () => restartGame(), save: n => saveGame(n), load: n => loadGame(n),
  pathOK: (sx, sy, tx, ty) => !!findPath(sx, sy, tx, ty),
  look(tx, ty){ const p = toIso(tx * T, ty * T); state.camX = clamp(p.x - VW / 2, 0, IW - VW); state.camY = clamp(p.y - VH / 2, 0, IH - VH); },
  toScreen(e){ const p = toIso(e.x, e.y); return {x: (p.x - state.camX) * ZOOM, y: (p.y - state.camY) * ZOOM + TOPBAR_H}; },
  step(seconds){ // advance the simulation manually (testing / hidden-tab)
    if(!state.started || state.over) return;
    const n = Math.max(1, Math.round(seconds / STEP));
    for(let i = 0; i < n && !state.over; i++) tick(STEP);
    draw(); drawMinimap(); drawHUD(STEP);
  },
};
