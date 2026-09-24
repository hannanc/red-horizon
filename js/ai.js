// Red Horizon: The computer opponent: difficulty, production, attack waves, transports, navy, repairs.
import {canHurt} from './combat.js';
import {ENEMY, FACTION, NEUTRAL, PLAYER, SIDE_NAME, T, UNIT_DEFS, buildings, dist, isInf, onMap, state, units} from './data.js';
import {orderMove} from './pathfinding.js';
import {announce, sfx} from './ui.js';
import {canBoard, canGarrison, deliverUnit, engineerCan, fooledBy, hiddenFrom, onFootprint, prodQ, unloadTransport} from './units.js';

// ---------- enemy AI ----------
// Difficulty scales the AI's economy (start credits, trickle income, ore payout) and aggression; the player's side is the same on every level.
export const DIFFICULTY = {
  easy:   {name:'Easy',   credits: 4000,  income: 3.5, harvest: 0.6, firstWave: 180, waveGap: 1.5, waveStart: 2, waveGrow: 1, waveMax: 6,
           capMul: 0.5,  capMax: 10, tech: 1.6, note:'The Soviets are slow to arm and attack in small groups.'},
  normal: {name:'Normal', credits: 7000,  income: 6,   harvest: 0.8, firstWave: 120, waveGap: 1.2, waveStart: 3, waveGrow: 1, waveMax: 10,
           capMul: 0.75, capMax: 18, tech: 1.25, note:'A steady opponent with growing attack waves.'},
  hard:   {name:'Hard',   credits: 12000, income: 9,   harvest: 1,   firstWave: 80,  waveGap: 1,   waveStart: 3, waveGrow: 2, waveMax: 14,
           capMul: 1,    capMax: 26, tech: 1, note:'A rich enemy that attacks early and often.'},
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
  prodI: 0, prodProgress: 0, prodKey: null, airT: 0, navT: 0, navI: 0, engT: 0,
};

// an airship every few minutes once the AI has the tech, a couple at a time at most
export function airshipDue(){
  if(FACTION[ENEMY] !== 'soviet') return false;   // the Allied AI keeps out of the air
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

  if(!ai.prodKey){
    ai.prodKey = ai.prodQ[ai.prodI % ai.prodQ.length];
    if(state.time > 240 * diff.tech && Math.random() < 0.25) ai.prodKey = 'htank';
    if(state.time > 150 * diff.tech && Math.random() < 0.3) ai.prodKey = 'ltank';
    if(FACTION[ENEMY] === 'soviet' && state.time > 200 * diff.tech && Math.random() < 0.12 &&
       units.filter(u => u.team === ENEMY && !u.dead && u.def.key === 'psion').length < 2) ai.prodKey = 'psion';
    // now and then an engineer to steal one of the player's buildings
    if(state.time > 180 * diff.tech && state.time > ai.engT && !units.some(u => u.team === ENEMY && !u.dead && u.def.engineer)){
      ai.prodKey = 'engineer'; ai.engT = state.time + 120;
    }
    if(airshipDue()){ ai.prodKey = 'airship'; ai.airT = state.time + 150; }
    else if(navyDue()){ ai.prodKey = AI_SHIPS[FACTION[ENEMY]][ai.navI++ % 2]; ai.navT = state.time + 90; }
    ai.prodI++;
    ai.prodProgress = 0;
  } else {
    const armyCount = units.filter(u => u.team === ENEMY && !u.dead && !u.def.harvester).length;
    const armyCap = Math.min(diff.capMax, Math.round((5 + Math.floor(state.time / 30) * 2) * diff.capMul));
    // airships have their own limit, and one that's due jumps a unit waiting for room in the army
    if(armyCount >= armyCap && ai.prodProgress === 0 && !UNIT_DEFS[ai.prodKey].air && airshipDue()){ ai.prodKey = 'airship'; ai.airT = state.time + 150; }
    const def = UNIT_DEFS[ai.prodKey];
    if(armyCount < armyCap || def.air || def.naval){
      const rate = dt / def.time;
      const cost = def.cost * rate;
      if(state.credits[ENEMY] >= cost){
        state.credits[ENEMY] -= cost;
        ai.prodProgress += rate;
        if(ai.prodProgress >= 1){
          // no dockyard or no room at the door: drop a ship, retry anything else
          if(deliverUnit(ai.prodKey, ENEMY) || def.naval) ai.prodKey = null;
        }
      }
    }
  }

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
    if(u.role !== 'attacker' || !canGarrison(u.def) || (u.order.type !== 'attack' && u.order.type !== 'attackmove') || Math.random() > 0.3) continue;
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

// damaged vehicles at home drive onto the depot until they are fixed
export function aiRepairs(dt){
  ai.repT = (ai.repT || 0) - dt;
  if(ai.repT > 0) return;
  ai.repT = 2;
  aiInfantry();
  aiNavy();
  aiEngineers();
  const depot = buildings.find(b => !b.dead && b.team === ENEMY && b.def.flat);
  if(!depot) return;
  for(const u of units){
    if(!onMap(u) || u.team !== ENEMY || u.def.armor !== 'heavy' || u.def.air || u.def.naval || u.def.harvester || u.role === 'attacker') continue;
    if(u.order.type === 'idle' && u.hp < u.maxHp * 0.6 && !onFootprint(u, depot)){
      u.order = {type: 'move'};
      orderMove(u, depot.x + (Math.random() - 0.5) * T, depot.y + (Math.random() - 0.5) * T);
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
