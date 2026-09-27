// Red Horizon: The computer opponent: difficulty, production, attack waves, transports, navy, repairs.
import {canHurt} from './combat.js';
import {BUILD_DEFS, ENEMY, explored, FACTION, MH, MW, NEUTRAL, PLAYER, SIDE_NAME, T, tileOf, UNIT_DEFS, buildings, weaponOf, dist, idx, inMap, isInf, occ, onMap, ore, passable, setup, state, units} from './data.js';
import {findPath, freeTileNear, orderMove} from './pathfinding.js';
import {announce, showAdvisor} from './ui.js';
import {radarOn} from './render.js';
import {sfx} from './sound.js';
import {canBoard, canGarrison, canPatrol, canPlace, deliverUnit, engineerCan, fooledBy, hasBuilding, hiddenFrom, onFootprint, orderPatrol, patrolRoute, placeBuilding, powerOf, prereqOk, prodBonus, prodQ, spawnUnit, unloadTransport} from './units.js';
import {rand} from './rng.js';

// ---------- enemy AI ----------
// Difficulty scales the AI's economy (start credits, trickle income, ore payout) and aggression; the player's side is the same on every level.
export const DIFFICULTY = {
  // base building: build = construction speed, towers = defences it wants, expand = extra refineries,
  // navy = builds a dockyard, repairAt = repairs buildings below this share of hp (0: never),
  // patrol = how many home defenders walk round the base
  easy:   {name:'Easy',   credits: 4000,  income: 3.5, harvest: 0.6, firstWave: 180, waveGap: 1.5, waveStart: 2, waveGrow: 1, waveMax: 6,
           capMul: 0.5,  capMax: 10, tech: 1.6, build: 0.6, towers: 2, expand: 0, navy: false, repairAt: 0, patrol: 0,
           note:'The enemy is slow to build and attacks in small groups.'},
  normal: {name:'Normal', credits: 7000,  income: 6,   harvest: 0.8, firstWave: 120, waveGap: 1.2, waveStart: 3, waveGrow: 1, waveMax: 10,
           capMul: 0.75, capMax: 18, tech: 1.25, build: 0.9, towers: 3, expand: 1, navy: true, repairAt: 0.5, patrol: 2,
           note:'A steady opponent with growing attack waves.'},
  hard:   {name:'Hard',   credits: 12000, income: 9,   harvest: 1,   firstWave: 80,  waveGap: 1,   waveStart: 3, waveGrow: 2, waveMax: 14,
           capMul: 1,    capMax: 26, tech: 1, build: 1.25, towers: 5, expand: 2, navy: true, repairAt: 0.75, patrol: 3,
           note:'A rich enemy that builds fast and attacks early and often.'},
};
export let diff = DIFFICULTY.normal;
export function setDifficulty(key){
  diff = DIFFICULTY[key] || DIFFICULTY.normal;
  state.credits[ENEMY] = diff.credits;
  ai.waveTimer = diff.firstWave;
  ai.waveSize = diff.waveStart;
}

// what the AI builds, by the side it plays
export const AI_QUEUE = {
  soviet: ['rifle','arctrooper','ltank','rifle','halftrack','drone','sapper','rocket','ltank','arctrooper','isotope','launcher','rifle','drone'],
  allied: ['rifle','dog','ltank','rifle','ifv','rocket','sniper','ltank','beamtank','rifle','veiltank','rocket','blink','ltank'],
};
export const AI_SHIPS = {soviet: ['sub', 'flakboat'], allied: ['frigate', 'picket']};

export const ai = {
  waveTimer: 80,
  waveSize: 3,
  prodQ: null,   // AI_QUEUE of its side, set by newWorld()
  prodI: 0, prodProgress: 0, prodKey: null, airT: 0, navT: 0, navI: 0, engT: 0, reactT: 0,
  bKey: null, bProg: 0, bThink: 0, bSkip: {},   // base building: current structure, its progress, what can't be placed
  advAirT: 0, advHeavyT: 0, advWaveT: 0, advPowerT: 0, lowPowerT: 0, buildNagAt: 30, buildNagGap: 30, unitNagAt: 30, unitNagGap: 30,   // tactical advisor: cooldowns per kind of warning
  idleBuildT: 0, idleUnitT: 0,                  // how long the player's own build/train queues have sat empty
};

// ---------- AI base building ----------
const aiArmy = () => units.filter(u => u.team === ENEMY && !u.dead && !u.def.harvester).length;
const aiArmyCap = () => Math.min(diff.capMax, Math.round((5 + Math.floor(state.time / 30) * 2) * diff.capMul));
const aiCount = k => buildings.filter(b => !b.dead && b.team === ENEMY && b.def.key === k).length;
const aiTower = () => FACTION[ENEMY] === 'soviet' ? 'arctower' : 'beamtower';
const aiHQ = () => buildings.find(b => !b.dead && b.team === ENEMY && b.def.key === 'conyard');
// where the player lives: their construction hub, any building, or their start
function playerHome(){
  const b = buildings.find(b => !b.dead && b.team === PLAYER && b.def.key === 'conyard') ||
            buildings.find(b => !b.dead && b.team === PLAYER && !b.def.garrison);
  const s = TerrainGen.map.bases[0];
  return b ? {x: b.x, y: b.y} : {x: (s.x + 0.5) * T, y: (s.y + 0.5) * T};
}

// ---------- reacting to what the player builds ----------
// a rough read of the player's army, so production can lean towards whatever answers it
function playerProfile(){
  const u = units.filter(v => v.team === PLAYER && onMap(v));
  return {air: u.filter(v => v.def.armor === 'air').length, heavy: u.filter(v => v.def.armor === 'heavy').length,
          naval: u.filter(v => v.def.naval).length};
}
const ownCount = k => units.filter(u => u.team === ENEMY && !u.dead && u.def.key === k).length;
// how well a unit counters what the player is fielding right now; 0 or less means "don't bother"
function reactiveScore(def, profile){
  if(!def.weapon) return -1;
  let s = 0;
  if(profile.air > 2)   s += (def.weapon.vs.air || 0) * 2;
  if(profile.heavy > 3) s += (def.weapon.vs.heavy || 0) * 1.5;
  if(profile.naval > 1) s += (def.weapon.vs.sub || 0) * 1.5;
  return s - ownCount(def.key) * 0.3;   // don't overstack the counter-pick itself
}

// ---------- tactical advisor: warns about the enemy, and nudges an idle player ----------
// only what the player's own radar would actually show: an explored tile, and not hidden (stealth etc.)
function visibleEnemy(){
  if(!radarOn) return [];
  return units.filter(u => u.team === ENEMY && onMap(u) && !hiddenFrom(u, PLAYER) &&
                       inMap(tileOf(u).x, tileOf(u).y) && explored[idx(tileOf(u).x, tileOf(u).y)]);
}
const hasUnexplored = () => explored.some(e => !e);
const playerScouted = () => units.some(u => u.team === PLAYER && !u.dead && u.def.key === 'scout') ||
                            prodQ.infantry.some(s => s.key === 'scout');
// the next building most worth queuing, in the usual startup order
function suggestBuilding(){
  if(!hasBuilding(PLAYER, 'power')) return 'a Power Plant';
  if(!hasBuilding(PLAYER, 'refinery')) return 'an Ore Refinery';
  if(!hasBuilding(PLAYER, 'barracks')) return 'a Barracks';
  if(!hasBuilding(PLAYER, 'factory')) return 'a Vehicle Factory';
  if(!hasBuilding(PLAYER, 'radar')) return 'a Radar';
  if(!hasBuilding(PLAYER, 'lab')) return 'a Research Lab';
  if(!hasBuilding(PLAYER, 'depot')) return 'a Service Depot';
  return null;
}

function tickAdvisor(dt){
  const seen = visibleEnemy();
  const buildIdle = prodQ.structure.length === 0 && prodQ.defense.length === 0;
  const unitIdle = prodQ.infantry.length === 0 && prodQ.vehicle.length === 0;
  const pw = powerOf(PLAYER);
  // a real shortfall, not an infiltrator's blackout (that passes on its own)
  const lowPower = pw.used > pw.prod && !(state.blackout[PLAYER] > state.time);
  ai.lowPowerT = lowPower ? (ai.lowPowerT || 0) + dt : 0;
  ai.idleBuildT = buildIdle ? ai.idleBuildT + dt : 0;
  ai.idleUnitT = unitIdle ? ai.idleUnitT + dt : 0;
  // idle nags back off: the first after 30 s of idling, then 60 s later, then 90 s, ...; queuing anything resets it
  if(!buildIdle){ ai.buildNagAt = 30; ai.buildNagGap = 30; }
  if(!unitIdle){ ai.unitNagAt = 30; ai.unitNagGap = 30; }
  const nag = kind => {
    ai[kind + 'NagGap'] = (ai[kind + 'NagGap'] || 30) + 30;
    ai[kind + 'NagAt'] = (ai[kind + 'NagAt'] || 30) + ai[kind + 'NagGap'];   // from the last threshold, so it doesn't drift
  };

  if(state.time > ai.advAirT && seen.filter(u => u.def.armor === 'air').length > 2){
    ai.advAirT = state.time + 90;
    showAdvisor('They are massing aircraft. We should build some anti-air.');
  } else if(state.time > ai.advHeavyT && seen.filter(u => u.def.armor === 'heavy').length > 5){
    ai.advHeavyT = state.time + 90;
    showAdvisor('Heavy armor spotted in numbers. Get anti-tank units ready.');
  } else if(state.time > ai.advWaveT && ai.waveTimer < 8 && seen.length >= ai.waveSize){
    ai.advWaveT = state.time + 60;
    showAdvisor('Enemy forces are massing. An attack looks imminent.');
  } else if(ai.lowPowerT >= 5 && state.time > (ai.advPowerT || 0) &&
            !prodQ.structure.some(s => s.key === 'power')){   // already fixing it: say nothing
    ai.advPowerT = state.time + 60;
    showAdvisor('Power is low, build a Power Plant. Production is slowed and defenses are going offline.');
  } else if(ai.idleBuildT >= (ai.buildNagAt || 30) && suggestBuilding()){
    nag('build');
    showAdvisor('Nothing under construction. Consider ' + suggestBuilding() + '.');
  } else if(ai.idleUnitT >= (ai.unitNagAt || 30)){
    if(hasUnexplored() && !playerScouted() && hasBuilding(PLAYER, 'radar') && hasBuilding(PLAYER, 'barracks')){
      nag('unit');
      showAdvisor('Much of the map is still unexplored. Build a Scout, high priority.');
    } else if(hasBuilding(PLAYER, 'barracks') || hasBuilding(PLAYER, 'factory')){
      nag('unit');
      showAdvisor('No troops in training. Queue up some more units.');
    }
  }
}

// The structure the AI wants next: its plan in order, with power first whenever the
// next one would overdraw it. A lost building drops its count and gets rebuilt.
const CORE = 7;   // the first plan entries are the core base; the rest wait for spare money or a decent army
export function aiNextBuilding(){
  const p = powerOf(ENEMY), tower = aiTower();
  const reactAir = playerProfile().air > 2 ? Math.min(2, diff.towers) : 0;   // only bothers once it's seen real air activity
  const labEarly = diff.tech < 1.5;
  const plan = [['power', 1], ['refinery', 1], ['barracks', 1], ['factory', 1], ['power', 2], ['radar', 1],
                ['refinery', 1 + Math.min(1, diff.expand)],   // a second refinery is part of the core above Easy
                // the Research Lab unlocks its strongest units: first thing once the core economy is up,
                // except on Easy (slow tech), which can't afford it and its first towers together
                ...(labEarly ? [['lab', 1]] : []),
                [tower, Math.min(2, diff.towers)], ['flaktower', reactAir],   // AA comes right after its first tower, ahead of expansion, once it's reacting
                ...(labEarly ? [] : [['lab', 1]]),
                ['depot', 1], ['shipyard', diff.navy ? 1 : 0],
                ['refinery', 1 + diff.expand], [tower, diff.towers]];
  for(let i = 0; i < plan.length; i++){
    const [k, n] = plan[i];
    if(aiCount(k) >= n || ai.bSkip[k] > state.time) continue;
    if(i >= CORE && state.credits[ENEMY] < BUILD_DEFS[k].cost * 0.8 && aiArmy() < aiArmyCap() * 0.7) return null;
    if(k !== 'power' && p.prod - p.used + BUILD_DEFS[k].power < 0) return 'power';
    ai.bCore = i < CORE;
    return k;
  }
  return p.prod - p.used < 40 ? 'power' : null;
}

const ORE_REACH = 30;   // tiles from the hub the AI will expand to for ore (power plants creep out to it)
// ore fields the AI could harvest: the nearest ore tile of each clump, nearest to its base first
function aiOreTargets(hq){
  const seen = [], out = [];
  for(let y = 0; y < MH; y++) for(let x = 0; x < MW; x++){
    if(ore[idx(x, y)] <= 0 || seen.some(s => Math.hypot(s.x - x, s.y - y) < 8)) continue;
    seen.push({x, y});
  }
  const home = playerHome();
  for(const s of seen){
    const c = {x: (s.x + 0.5) * T, y: (s.y + 0.5) * T};
    if(dist(c, home) < dist(c, hq)) continue;                           // on the player's side: leave it
    if(buildings.some(b => !b.dead && b.team === ENEMY && b.def.key === 'refinery' && dist(b, c) < 8 * T)) continue;
    if(dist(c, hq) > ORE_REACH * T) continue;                          // too far to creep to
    out.push(c);
  }
  return out.sort((a, b) => dist(a, hq) - dist(b, hq));
}

// the doorway of a production building, where its units come out (null if it has none)
function exitTile(b){
  const k = b.def.key;
  if(k !== 'factory' && k !== 'barracks' && k !== 'refinery') return null;
  return {x: b.tx + Math.floor(b.w / 2), y: b.ty + b.h};
}
// rows in front of production buildings stay clear, so their doors never get walled in
function inYard(x, y){
  for(const b of buildings){
    if(b.dead || b.team !== ENEMY || !exitTile(b)) continue;
    if(x >= b.tx - 1 && x <= b.tx + b.w && y >= b.ty + b.h && y <= b.ty + b.h + 1) return true;
  }
  return false;
}
// with a building on (tx, ty), can every door still reach the middle of the map?
function doorsStayOpen(def, tx, ty){
  const cells = [];
  for(let y = ty; y < ty + def.h; y++) for(let x = tx; x < tx + def.w; x++){ cells.push([idx(x, y), occ[idx(x, y)]]); occ[idx(x, y)] = 32767; }
  const probe = {tx, ty, w: def.w, h: def.h, def, dead: false, team: ENEMY};
  let ok = true;
  for(const b of [...buildings, probe]){
    if(b.dead || b.team !== ENEMY) continue;
    const e = exitTile(b);
    if(!e) continue;
    if(!passable(e.x, e.y) || !findPath(e.x, e.y, 32, 32)){ ok = false; break; }
  }
  for(const [i, v] of cells) occ[i] = v;
  return ok;
}

const TOWER_R = 10;   // tiles from the hub a defence tower may stand
// Where to put a structure: compact round the hub, towers towards the player, refineries by
// their ore, the dockyard on the water. Every spot keeps a gap round other buildings and
// clear rows in front of doors, and is only taken if all doors can still get out.
export function aiSpot(key, toward){
  const hq = aiHQ();
  if(!hq) return null;
  const def = BUILD_DEFS[key], tower = !!def.weapon, home = playerHome();
  let oreAt = null;
  if(key === 'refinery'){ oreAt = aiOreTargets(hq)[0]; if(!oreAt) return null; }
  const mine = buildings.filter(b => !b.dead && b.team === ENEMY && !b.def.garrison);
  const x0 = Math.min(...mine.map(b => b.tx)) - 10, x1 = Math.max(...mine.map(b => b.tx + b.w)) + 10;
  const y0 = Math.min(...mine.map(b => b.ty)) - 10, y1 = Math.max(...mine.map(b => b.ty + b.h)) + 10;
  const cands = [];
  for(let ty = Math.max(0, y0); ty <= Math.min(MH - def.h, y1); ty++)
    for(let tx = Math.max(0, x0); tx <= Math.min(MW - def.w, x1); tx++){
      if(!canPlace(key, tx, ty, ENEMY)) continue;
      let clash = false;
      for(let y = ty - 1; y <= ty + def.h && !clash; y++)
        for(let x = tx - 1; x <= tx + def.w && !clash; x++){
          if(!inMap(x, y)) continue;
          const o = occ[idx(x, y)];
          if(o > 0 && !def.onWater) clash = true;                       // a one-tile gap round every building
          if(x >= tx && x < tx + def.w && y >= ty && y < ty + def.h && inYard(x, y)) clash = true;
        }
      if(clash) continue;
      const c = {x: (tx + def.w / 2) * T, y: (ty + def.h / 2) * T};
      if(tower && mine.some(b => b.def.weapon && dist(b, c) < 3 * T)) continue;   // spread the towers out
      if(tower && dist(c, hq) > TOWER_R * T) continue;                  // at home, not marching on the player
      let score = dist(c, hq);
      if(tower) score = dist(c, home) + dist(c, hq) * 0.3;               // the side facing the player
      if(oreAt) score = dist(c, oreAt);
      if(toward) score = dist(c, toward);
      cands.push({tx, ty, score});
    }
  cands.sort((a, b) => a.score - b.score);
  for(const c of cands.slice(0, 12)) if(doorsStayOpen(def, c.tx, c.ty)) return c;
  return null;
}

// Build the next structure: pay as it goes (faster on harder levels), then place it.
// A refinery too far from free ore becomes a power plant on the way there first.
function aiBase(dt){
  if(!aiHQ()) return;
  if(!ai.bKey){
    ai.bThink -= dt;
    if(ai.bThink > 0) return;
    ai.bThink = 1;
    ai.bKey = aiNextBuilding(); ai.bProg = 0;
    if(!ai.bKey) return;
  }
  const def = BUILD_DEFS[ai.bKey];
  const p = powerOf(ENEMY);
  const rate = dt / def.time * diff.build * (p.used > p.prod ? 0.5 : 1) * prodBonus(ENEMY, def);
  const cost = def.cost * rate;
  if(ai.bProg < 1){
    if(state.credits[ENEMY] < cost) return;
    state.credits[ENEMY] -= cost;
    ai.bProg += rate;
    if(ai.bProg < 1) return;
  }
  let key = ai.bKey, spot = aiSpot(key);
  if(key === 'refinery' && spot){
    const oreAt = aiOreTargets(aiHQ())[0];
    if(oreAt && dist({x: (spot.tx + 1.5) * T, y: (spot.ty + 1.5) * T}, oreAt) > 7 * T){
      // creep: a power plant as close to the ore as the base allows, if that really gains ground
      // (ore behind the plateau or water would otherwise draw a chain of plants that never arrives)
      const step = aiSpot('power', oreAt), hq = aiHQ();
      const at = s => ({x: (s.tx + 1) * T, y: (s.ty + 1) * T});
      const reach = Math.min(...buildings.filter(b => !b.dead && b.team === ENEMY && !b.def.garrison).map(b => dist(b, oreAt)));
      if(step && dist(at(step), oreAt) < reach - 2 * T && dist(at(step), hq) <= ORE_REACH * T){ key = 'power'; spot = step; }
    }
  }
  ai.bKey = null;
  if(!spot){ ai.bSkip[key] = state.time + 30; state.credits[ENEMY] += def.cost; return; }   // nowhere to put it: try later
  const b = placeBuilding(key, spot.tx, spot.ty, ENEMY, false);
  if(key === 'refinery'){
    const s = freeTileNear(spot.tx + 1, spot.ty + b.h, 4);
    if(s){ const h = spawnUnit('harv', s.x * T + T / 2, s.y * T + T / 2, ENEMY); h.hState = 'seek'; }
  }
}

// an airship every few minutes once the AI has the tech, a couple at a time at most
export function airshipDue(){
  if(FACTION[ENEMY] !== 'soviet' || diff === DIFFICULTY.easy) return false;   // the Allied AI and Easy keep out of the air
  const ships = units.filter(u => u.team === ENEMY && !u.dead && u.def.key === 'airship').length;
  return state.time > 240 * diff.tech && state.time > ai.airT && ships < (diff === DIFFICULTY.hard ? 3 : 2);
}

// a couple of ships once the AI has had time to build up, only while it has a dockyard
export function navyDue(){
  if(!buildings.some(b => !b.dead && b.team === ENEMY && b.def.key === 'shipyard')) return false;
  const ships = units.filter(u => u.team === ENEMY && !u.dead && u.def.naval).length;
  return state.time > 200 * diff.tech && state.time > ai.navT && ships < (diff === DIFFICULTY.hard ? 3 : diff === DIFFICULTY.easy ? 1 : 2);
}

// Ships can't join land waves: they go after the player's ships and dockyards when
// there are any they can reach, and otherwise guard the coast at home.
export function aiNavy(){
  for(const u of units){
    if(!onMap(u) || u.team !== ENEMY || !u.def.naval || u.order.type !== 'idle') continue;
    let best = null, bd = 60 * T;
    for(const t of [...units, ...buildings]){
      if(t.dead || t.team !== PLAYER || !(t.def.naval || t.def.onWater) || (t.kind === 'unit' && !onMap(t)) || !canHurt(u, t)) continue;
      const d = dist(u, t);
      if(d < bd){ bd = d; best = t; }
    }
    if(best) u.order = {type: 'attack', target: best};
  }
}

export function tickAI(dt){
  state.credits[ENEMY] += diff.income * dt;

  aiBase(dt);
  tickAdvisor(dt);
  const can = k => prereqOk(UNIT_DEFS[k], ENEMY);
  if(!ai.prodKey){
    // the next unit in the queue it has the buildings for; one it can't build yet waits at the front
    for(let i = 0; i < ai.prodQ.length; i++){
      const k = ai.prodQ[(ai.prodI + i) % ai.prodQ.length];
      if(!can(k)) continue;
      ai.prodKey = k;
      if(i === 0) ai.prodI++;
      break;
    }
  }
  if(ai.prodKey && ai.prodProgress === 0 && !ai.picked){
    ai.picked = true;
    const queued = ai.prodKey;
    if(state.time > 240 * diff.tech && rand() < 0.25 && can('htank')) ai.prodKey = 'htank';
    if(state.time > 150 * diff.tech && rand() < 0.3 && can('ltank')) ai.prodKey = 'ltank';
    if(FACTION[ENEMY] === 'soviet' && state.time > 200 * diff.tech && rand() < 0.12 && can('psion') &&
       units.filter(u => u.team === ENEMY && !u.dead && u.def.key === 'psion').length < 2) ai.prodKey = 'psion';
    // now and then an engineer to steal one of the player's buildings
    if(state.time > 180 * diff.tech && state.time > ai.engT && can('engineer') && !units.some(u => u.team === ENEMY && !u.dead && u.def.engineer)){
      ai.prodKey = 'engineer'; ai.engT = state.time + 120;
    }
    if(airshipDue() && can('airship')){ ai.prodKey = 'airship'; ai.airT = state.time + 150; }
    else if(navyDue()){ ai.prodKey = AI_SHIPS[FACTION[ENEMY]][ai.navI++ % 2]; ai.navT = state.time + 90; }
    // now and then, lean towards whatever answers the player's current army instead of the next unit in line
    if(state.time > ai.reactT){
      ai.reactT = state.time + 20;
      const profile = playerProfile();
      const best = ai.prodQ.map(k => ({k, s: reactiveScore(UNIT_DEFS[k], profile)})).sort((a, b) => b.s - a.s)[0];
      if(best && best.s > 0.5 && can(best.k) && rand() < 0.6) ai.prodKey = best.k;
    }
    // a harvester for every refinery comes before anything else
    const harvs = aiCount('refinery') + (aiCount('refinery') ? 1 : 0);   // one per refinery and a spare
    if(can('harv') && units.filter(u => u.team === ENEMY && !u.dead && u.def.harvester).length < harvs) ai.prodKey = 'harv';
    if(ai.prodKey !== queued && ai.prodQ[(ai.prodI - 1 + ai.prodQ.length) % ai.prodQ.length] === queued) ai.prodI--;   // it keeps its turn
  }
  if(ai.prodKey){
    const armyCount = aiArmy(), armyCap = aiArmyCap();
    // airships have their own limit, and one that's due jumps a unit waiting for room in the army
    if(armyCount >= armyCap && ai.prodProgress === 0 && !UNIT_DEFS[ai.prodKey].air && airshipDue() && can('airship')){ ai.prodKey = 'airship'; ai.airT = state.time + 150; }
    const def = UNIT_DEFS[ai.prodKey];
    const saving = ai.bKey && ai.bCore && state.credits[ENEMY] < BUILD_DEFS[ai.bKey].cost * 0.5 && !def.harvester;   // the core base comes first
    if((armyCount < armyCap || def.air || def.naval || def.harvester) && !saving){
      const rate = dt / def.time * prodBonus(ENEMY, def);
      const cost = def.cost * rate;
      if(state.credits[ENEMY] >= cost){
        state.credits[ENEMY] -= cost;
        ai.prodProgress += rate;
        if(ai.prodProgress >= 1){
          // no dockyard or no room at the door: drop a ship, retry anything else
          if(deliverUnit(ai.prodKey, ENEMY) || def.naval){ ai.prodKey = null; ai.prodProgress = 0; ai.picked = false; }
        }
      }
    }
  }

  // training mode: the enemy still builds, harvests and defends, but never sends an attack wave
  if(setup.training) ai.waveTimer = 1e9;
  ai.waveTimer -= dt;
  if(ai.waveTimer <= 0){
    // a halftrack sits out waves for a while so it can fill up first
    const filling = u => u.def.transport && u.cargo.length < u.def.transport && state.time - u.born < 40;
    const army = units.filter(u => u.team === ENEMY && onMap(u) && !u.def.harvester && !u.def.naval && u.role !== 'attacker' &&
                                   u.order.type !== 'board' && !filling(u));
    if(army.length >= Math.min(ai.waveSize, 4)){
      army.sort((a, b) => (b.def.air ? 1 : 0) - (a.def.air ? 1 : 0));   // airships lead (they are slow to arrive)
      const squad = army.slice(0, ai.waveSize + 2);
      const target = nearestPlayerTarget(squad[0]);
      if(target){
        for(const u of squad){
          u.role = 'attacker'; u.deployed = false;
          const t = canHurt(u, target) ? target : nearestPlayerTarget(u);
          if(t) u.order = {type:'attack', target: t};
          else { u.order = {type:'attackmove', x: target.x, y: target.y}; orderMove(u, target.x, target.y); }
        }
        // the squad's infantry ride in its halftracks; the halftrack waits for them to climb in
        for(const tr of squad.filter(u => u.def.transport)){
          const room = tr.def.transport - tr.cargo.length;
          const riders = squad.filter(u => u.order.type !== 'board' && canBoard(u, tr)).slice(0, room);
          if(!riders.length) continue;
          for(const u of riders){ u.order = {type:'board', target: tr}; u.repathT = 0; }
          tr.order = {type:'idle'}; tr.path = null;
          tr.holdT = state.time + 10; tr.goal = target;
        }
        announce(`Warning: ${SIDE_NAME[FACTION[ENEMY]]} forces inbound!`, true, 'Warning');
        sfx('alert');
      }
      ai.waveSize = Math.min(diff.waveMax, ai.waveSize + diff.waveGrow);
      ai.waveTimer = Math.max(45, 85 - state.time / 20) * diff.waveGap;
    } else {
      ai.waveTimer = 12;
    }
  }

  aiTransports();
  aiRepairs(dt);
  for(const u of units){
    if(!onMap(u) || u.team !== ENEMY || u.role !== 'attacker' || u.holdT) continue;
    if(u.order.type === 'idle'){
      const t = nearestPlayerTarget(u);
      if(t) u.order = {type:'attack', target: t};
      else u.role = 'defend';
    }
  }
}

// Halftracks at home fill up with idle infantry; on the attack they drop them off
// once they get close to their target.
export function aiTransports(){
  for(const t of units){
    if(!onMap(t) || t.team !== ENEMY || !t.def.transport) continue;
    if(t.role !== 'attacker'){
      let room = t.def.transport - t.cargo.length - units.filter(u => u.order.type === 'board' && u.order.target === t).length;
      for(const u of units){
        if(room <= 0) break;
        if(!onMap(u) || u.team !== ENEMY || u.role === 'attacker' || u.order.type !== 'idle' || !canBoard(u, t) || dist(u, t) > 14 * T) continue;
        u.order = {type:'board', target: t}; u.repathT = 0;
        room--;
      }
    } else if(t.holdT){
      const boarding = units.some(u => !u.dead && u.order.type === 'board' && u.order.target === t);
      if(!boarding || state.time > t.holdT || t.cargo.length >= t.def.transport){
        t.holdT = 0;
        const g = t.goal && !t.goal.dead ? t.goal : nearestPlayerTarget(t);
        if(g) t.order = {type:'attack', target: g};
      }
    } else if(t.cargo.length){
      const goal = t.order.target || nearestPlayerTarget(t);
      if(!goal || dist(t, goal) < 7 * T || t.hp < t.maxHp * 0.35){
        for(const u of unloadTransport(t)){
          u.role = 'attacker';
          const tg = nearestPlayerTarget(u);
          if(tg) u.order = {type:'attack', target: tg};
        }
        if(goal && canHurt(t, goal)) t.order = {type:'attack', target: goal};
      }
    }
  }
}

// Troopers at home dig in behind sandbags; attacking infantry near the fighting
// occupy empty town buildings on the way.
export function aiInfantry(){
  for(const u of units){
    if(!onMap(u) || u.team !== ENEMY || u.def.armor !== 'inf') continue;
    if(u.def.deployWeapon && u.role !== 'attacker' && u.order.type === 'idle') u.deployed = true;
    if(u.def.radiate){   // isotope troopers switch their field on when enemy infantry comes close
      const near = r => units.some(v => onMap(v) && v.team === PLAYER && isInf(v.def) && !v.def.air && dist(u, v) < r * T);
      if(!u.deployed && near(2.5)) u.deployed = true;
      else if(u.deployed && !near(4)) u.deployed = false;
    }
    if(u.role !== 'attacker' || !canGarrison(u.def) || (u.order.type !== 'attack' && u.order.type !== 'attackmove') || rand() > 0.3) continue;
    const b = buildings.find(b => !b.dead && b.def.garrison && (b.team === NEUTRAL || b.team === ENEMY) && b.cargo.length < 3 &&
                                  dist(u, b) < 5 * T && units.some(v => onMap(v) && v.team === PLAYER && dist(v, b) < 8 * T));
    if(b){ u.order = {type:'board', target: b}; u.repathT = 0; }
  }
}

// idle AI engineers go for the player's most valuable building within reach
export function aiEngineers(){
  for(const u of units){
    if(!onMap(u) || u.team !== ENEMY || !u.def.engineer || u.order.type !== 'idle') continue;
    let best = null, bv = -1e9;
    for(const b of buildings){
      if(!engineerCan(b, ENEMY) || b.team !== PLAYER) continue;
      const v = b.def.cost - dist(u, b) / T * 20 - (b.def.weapon ? 3000 : 0);   // rich and close, not a gun tower
      if(v > bv){ bv = v; best = b; }
    }
    if(best){ u.order = {type: 'capture', target: best}; u.path = null; u.repathT = 0; u.role = 'attacker'; }
  }
}

// A few home defenders walk round the base (diff.patrol, at most half of those at home);
// a damaged one stops so aiRepairs can send it to the depot. Waves still take patrollers along.
const patrolling = u => u.order.type === 'patrol' || (u.order.type === 'attack' && !!u.order.patrol);
export function aiPatrol(){
  const home = units.filter(u => onMap(u) && u.team === ENEMY && u.role !== 'attacker' && weaponOf(u) &&
                                  canPatrol(u) && !u.def.transport && !u.holdT);
  for(const u of home) if(u.order.type === 'patrol' && u.hp < u.maxHp * 0.6){ u.order = {type:'idle'}; u.path = null; }
  let need = Math.min(diff.patrol || 0, Math.floor(home.length / 2)) - home.filter(patrolling).length;
  if(need <= 0) return;
  for(const u of home){
    if(need <= 0) break;
    if(u.order.type !== 'idle' || u.hp < u.maxHp * 0.6) continue;
    if(orderPatrol(u, patrolRoute(ENEMY, u))) need--;
  }
}

// damaged vehicles at home drive onto the depot until they are fixed
export function aiRepairs(dt){
  ai.repT = (ai.repT || 0) - dt;
  if(ai.repT > 0) return;
  ai.repT = 2;
  aiInfantry();
  aiNavy();
  aiEngineers();
  aiPatrol();
  if(diff.repairAt) for(const b of buildings)   // fix damaged structures while money lasts
    if(!b.dead && b.team === ENEMY && !b.def.garrison && b.buildUp >= 1 && b.hp < b.maxHp * diff.repairAt && state.credits[ENEMY] > 300) b.repairing = true;
  const depot = buildings.find(b => !b.dead && b.team === ENEMY && b.def.flat);
  if(!depot) return;
  for(const u of units){
    if(!onMap(u) || u.team !== ENEMY || u.def.armor !== 'heavy' || u.def.air || u.def.naval || u.def.harvester || u.role === 'attacker') continue;
    if(u.order.type === 'idle' && u.hp < u.maxHp * 0.6 && !onFootprint(u, depot)){
      u.order = {type: 'move'};
      orderMove(u, depot.x + (rand() - 0.5) * T, depot.y + (rand() - 0.5) * T);
    }
  }
}

export function nearestPlayerTarget(from){
  let best = null, bd = 1e9;
  for(const b of buildings){
    if(b.dead || b.team !== PLAYER || !canHurt(from, b)) continue;
    const d = dist(from, b);
    if(d < bd){ bd = d; best = b; }
  }
  if(!best) for(const u of units){
    if(!onMap(u) || u.team !== PLAYER || !canHurt(from, u) || hiddenFrom(u, from.team) || fooledBy(from, u)) continue;
    const d = dist(from, u);
    if(d < bd){ bd = d; best = u; }
  }
  return best;
}
