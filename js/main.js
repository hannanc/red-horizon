// Red Horizon: Map setup, the main loop, world (re)building, the start screen and the window.__RH test handle.
import {AI_QUEUE, DIFFICULTY, ai, diff, setDifficulty, tickAI} from './ai.js';
import {applyDamage, boom, canHurt, scorch, updateProjectiles} from './combat.js';
import {resetIds, BLOCKED, ENEMY, FACTION, IH, IW, MH, MW, NEUTRAL, PLAYER, ROADS, SIDE_NAME, T, TEAM_COLOR, TOPBAR_H, TOWN, UNIT_DEFS, buildings, clamp, doodads, effects, explored, flags, groundZ, idx, inMap, lakeVal, occ, onRoad, ore, passable, projectiles, sailable, selection, setSelection, setup, state, toIso, units, walk, water, weaponOf} from './data.js';
import {orderMove, findPath} from './pathfinding.js';
import {VH, VW, ZOOM, cx, draw, drawMinimap, paintLow, radarOn, radarT, scorches, startTerrainWorkers, setZoom} from './render.js';
import {initUI, announce, audio, buildSidebar, clockEl, drawHUD, groups, sfx, speak, tickCamera} from './ui.js';
import {canBoard, canPlace, deliverUnit, placeBuilding, powerOf, prodQ, radPuddles, radSources, revealAround, spawnUnit, tickProduction, tickRadiation, treeDisguised, unloadTransport, updateBuilding, updateUnit} from './units.js';
import {rand, seedRandom} from './rng.js';

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
  // tree clumps and rocks, kept clear of bases, ore fields, the plateau and the map edge
  const keepClear = [[9, 51, 11], [53, 9, 11], [14, 47, 6], [49, 16, 6], [32, 32, 7], [50, 50, 5], [13, 13, 5],
                     [TOWN.x, TOWN.y, 8], [P.x, P.y, P.r + 3]];
  const clear = (x, y) => x > 1 && y > 1 && x < MW - 2 && y < MH - 2 && occ[idx(x, y)] === 0 && !onRoad(x, y) &&
    keepClear.every(([cx, cy, r]) => Math.hypot(x - cx, y - cy) > r);
  let s = 777 + (setup.seed - 1) * 7919;   // the map seed moves the trees and rocks too
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
  const lots = [[19, 36], [16, 36], [25, 36], [28, 36], [19, 42], [16, 42], [25, 42], [28, 42], [19, 45], [25, 33]];
  lots.forEach(([x, y], i) => {
    for(let yy = y; yy < y + 2; yy++) for(let xx = x; xx < x + 2; xx++) if(occ[idx(xx, yy)] !== 0) return;
    const b = placeBuilding('civ', x, y, NEUTRAL, true);
    b.variant = (i * 5 + 1) % 6;
  });
  if(!Sprites.get('lamp')) return;
  for(const R of ROADS)
    for(let a = R.from + 2; a < R.to - 1; a += 4){
      const x = R.axis === 'x' ? a : R.c + 1.3, y = R.axis === 'x' ? R.c + 1.3 : a;
      doodads.push({kind: 'doodad', name: 'lamp', frame: 0, tx: Math.floor(x), ty: Math.floor(y), x: x * T, y: y * T});
    }
}

export function setupMap(){
  setupScenery();
  setupTown();
  seedOre(14, 47, 4, 500);
  seedOre(49, 16, 4, 500);
  seedOre(32, 32, 5, 650);
  seedOre(50, 50, 3, 450);
  seedOre(13, 13, 3, 450);

  const mcv = spawnUnit('mcv', 9.5 * T, 51.5 * T, PLAYER);
  mcv.face = -Math.PI / 4;
  setSelection([mcv]);
  for(const [x, y] of [[11.5, 48.5], [12.2, 49.2], [12.9, 49.9]]) spawnUnit('rifle', x * T, y * T, PLAYER);
  spawnUnit('ltank', 13 * T, 52 * T, PLAYER);
  revealAround(9.5 * T, 51.5 * T, 11);

  // the AI starts like the player, from a construction hub and a few units, and builds its own base (aiBase)
  placeBuilding('conyard', 52, 8, ENEMY, true);
  spawnUnit('rifle', 51 * T, 15 * T, ENEMY);
  spawnUnit('rifle', 52 * T, 16 * T, ENEMY);
  spawnUnit('ltank', 55 * T, 16.5 * T, ENEMY);

  const home = toIso(9.5 * T, 51.5 * T);
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
// skirmish setup: side, starting credits and map seed, remembered like the difficulty
export function saveSetup(){ try { localStorage.setItem('rh-setup', JSON.stringify(setup)); } catch(e){} showSetup(); }
export function showSetup(){
  document.querySelectorAll('[data-side]').forEach(b => b.classList.toggle('on', b.dataset.side === setup.side));
  document.querySelectorAll('[data-credits]').forEach(b => b.classList.toggle('on', +b.dataset.credits === setup.credits));
  document.getElementById('seedIn').value = setup.seed;
  document.getElementById('sideMe').textContent = SIDE_NAME[setup.side];
  document.getElementById('sideThem').textContent = SIDE_NAME[setup.side === 'allied' ? 'soviet' : 'allied'];
}
document.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => { setup.side = b.dataset.side; saveSetup(); }));
document.querySelectorAll('[data-credits]').forEach(b => b.addEventListener('click', () => { setup.credits = +b.dataset.credits; saveSetup(); }));
document.getElementById('seedIn').addEventListener('change', e => { setup.seed = clamp(Math.floor(+e.target.value) || 1, 1, 99999); saveSetup(); });
document.getElementById('seedRnd').addEventListener('click', () => { setup.seed = 2 + Math.floor(Math.random() * 99990); saveSetup(); });
document.getElementById('seedClassic').addEventListener('click', () => { setup.seed = 1; saveSetup(); });

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('help').style.display = 'none';
  if(!state.started){
    if(JSON.stringify(setup) !== worldSetup) newWorld();   // the settings changed since the preview map was built
    state.started = true;
    setDifficulty(diffKey);
    state.credits[PLAYER] = setup.credits;
    state.credits[ENEMY] = Math.round(diff.credits * setup.credits / 8000);
    document.getElementById('setupBox').style.display = 'none';
    document.getElementById('startBtn').textContent = 'RESUME';
    audio();
    announce('Command link established', false, 'Command link established');
  }
});
document.getElementById('helpBtn').addEventListener('click', () => {
  document.getElementById('help').style.display = 'flex';
});
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
  Object.assign(ai, {prodQ: AI_QUEUE[FACTION[ENEMY]], prodI: 0, prodProgress: 0, prodKey: null, picked: false, bKey: null, bProg: 0, bThink: 0, bSkip: {}});
  TerrainGen.setSeed(setup.seed);
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
  canPlace, canBoard, applyDamage, powerOf, get prodQ(){ return prodQ; }, radiation: () => radSources(), treeDisguised, sailable, passable, unload: t => unloadTransport(t), reveal: (tx, ty, r) => revealAround(tx * T, ty * T, r), faction: FACTION, plateau: TerrainGen.PLATEAU, onRamp: TerrainGen.onRamp, groundZ,
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
