// Red Horizon: Buildings, units, production, harvesting, movement and every unit behaviour.
import {diff} from './ai.js';
import {applyDamage, combatStep, findEnemyInRange, fireWeapon, kill} from './combat.js';
import {BLOCKED, BUILD_DEFS, ENEMY, FACTION, HPX, MH, MW, NEUTRAL, PLAYER, T, UNIT_DEFS, WPX, angDiff, buildings, canMove, clamp, dispName, dist, effects, explored, flags, groundZ, hasTurret, idx, inMap, isInf, newId, occ, onMap, ore, passable, sailable, selection, setSelection, state, tileOf, turnToward, units, walk, weaponOf} from './data.js';
import {freeTileNear, orderMove} from './pathfinding.js';
import {ack, announce, groups, refreshSidebar} from './ui.js';
import {sfx} from './sound.js';
import {rand} from './rng.js';

// ---------- building ----------
export function placeBuilding(key, tx, ty, team, instant){
  const def = BUILD_DEFS[key];
  const b = {
    id: newId(), kind:'building', def, team,
    tx, ty, w: def.w, h: def.h,
    x: (tx + def.w / 2) * T, y: (ty + def.h / 2) * T,
    hp: def.hp, maxHp: def.hp,
    cool: 0, scanT: rand() * 0.4, target: null,
    buildUp: instant ? 1 : 0, dead: false, flash: 0, fac: FACTION[team],
    cargo: def.garrison ? [] : null, variant: 0,
  };
  buildings.push(b);
  for(let y = ty; y < ty + def.h; y++)
    for(let x = tx; x < tx + def.w; x++){ occ[idx(x, y)] = b.id; if(def.flat) walk[idx(x, y)] = 1; }
  if(team === PLAYER) revealAround(b.x, b.y, 7);
  return b;
}

export function canPlace(key, tx, ty, team){
  const def = BUILD_DEFS[key];
  for(let y = ty; y < ty + def.h; y++)
    for(let x = tx; x < tx + def.w; x++){
      if(!inMap(x, y) || ore[idx(x, y)] > 0) return false;
      if(def.onWater ? !sailable(x, y) : occ[idx(x, y)] !== 0) return false;   // a dockyard needs open water
      if(groundZ((x + 0.5) * T, (y + 0.5) * T) > 0) return false;             // nothing is built up on the plateau
      if(team === PLAYER && !explored[idx(x, y)]) return false;
    }
  for(const u of units){
    if(!onMap(u) || u.def.air) continue;
    const t = tileOf(u);
    if(t.x >= tx && t.x < tx + def.w && t.y >= ty && t.y < ty + def.h) return false;
  }
  const cxp = (tx + def.w / 2) * T, cyp = (ty + def.h / 2) * T;
  for(const b of buildings)
    if(!b.dead && b.team === team && !b.def.garrison && Math.hypot(b.x - cxp, b.y - cyp) < 9 * T) return true;
  return false;
}

// ---------- units ----------
export function spawnUnit(key, px, py, team){
  const def = UNIT_DEFS[key];
  const u = {
    id: newId(), kind:'unit', def, team,
    x: px, y: py, hp: def.hp, maxHp: def.hp,
    face: team === PLAYER ? -Math.PI / 4 : Math.PI * 0.75,
    tface: team === PLAYER ? -Math.PI / 4 : Math.PI * 0.75,   // turret facing
    moving: false, walkPhase: 0, fireT: 9,
    cool: 0, scanT: rand() * 0.4,
    order: {type:'idle'}, path: null, pathI: 0, repathT: 0,
    dead: false, flash: 0, role: 'defend', fac: def.side || FACTION[team],
    carry: 0, hState: 'seek', hTimer: 0, oreTile: null,
    cargo: def.transport ? [] : null, born: state.time,
    z: def.air && !def.jet && !def.lands ? def.alt : 0,   // altitude in px; jets start on a pad, helicopters on the ground
    ammo: def.ammo || 0,
  };
  units.push(u);
  if(team === PLAYER) revealAround(px, py, 6);
  return u;
}


// ---------- fog ----------
export function revealAround(px, py, rTiles){
  const tx = Math.floor(px / T), ty = Math.floor(py / T);
  for(let y = ty - rTiles; y <= ty + rTiles; y++)
    for(let x = tx - rTiles; x <= tx + rTiles; x++)
      if(inMap(x, y) && !explored[idx(x, y)] && Math.hypot(x - tx, y - ty) <= rTiles){
        explored[idx(x, y)] = 1;
        flags.shroudDirty = true;
      }
}


export function powerOf(team){
  let prod = 0, used = 0;
  for(const b of buildings){
    if(b.dead || b.team !== team) continue;
    if(b.def.power > 0) prod += b.def.power; else used -= b.def.power;
  }
  if(state.blackout[team] > state.time) prod = 0;   // sabotaged by an infiltrator
  return {prod, used};
}

// Production queues, one per sidebar tab; the head item is the one being built.
// Structures build one at a time, units can be queued.
export const prodQ = {structure: [], defense: [], infantry: [], vehicle: []};
export const MAX_QUEUE = 9;

export function hasBuilding(team, key){
  return buildings.some(b => !b.dead && b.team === team && b.def.key === key && b.buildUp >= 1);
}
export function prereqs(def){
  const isUnit = def.tab === 'infantry' || def.tab === 'vehicle';
  return isUnit ? [def.from, ...(def.prereq || [])] : ['conyard', ...(def.prereq || [])];
}
export function prereqOk(def, team = PLAYER){ return prereqs(def).every(k => hasBuilding(team, k)); }

export function tickProduction(dt){
  const lowFactor = state.lowPower ? 0.45 : 1;
  for(const tab in prodQ){
    const s = prodQ[tab][0];
    if(!s || s.ready || s.hold) continue;
    const def = s.isUnit ? UNIT_DEFS[s.key] : BUILD_DEFS[s.key];
    if(!prereqOk(def)) continue;              // factory lost: production stalls
    if(s.progress < 1){
      const rate = dt / def.time * lowFactor;
      const cost = def.cost * rate;
      if(state.credits[PLAYER] < cost) continue;
      state.credits[PLAYER] -= cost;
      s.spent += cost;
      s.progress = Math.min(1, s.progress + rate);
    }
    if(s.progress >= 1){
      if(s.isUnit){
        if(deliverUnit(s.key, PLAYER)){
          prodQ[tab].shift();
          announce(dispName(def, PLAYER) + ' ready', false, 'Unit ready');
          sfx('ready');
        }
      } else {
        s.ready = true;
        announce('Construction complete', false, 'Construction complete');
        sfx('built');
      }
    }
  }
  refreshSidebar();
}

// A finished unit leaves its factory (door animation) and heads for the rally point.
export function deliverUnit(key, team){
  const def = UNIT_DEFS[key];
  if(def.jet){   // jets appear on a free landing pad
    const pad = freePad(team);
    if(!pad) return null;
    const pp = padPos(pad);
    const u = spawnUnit(key, pp.x, pp.y, team);
    u.pad = pad; u.docked = true;
    return u;
  }
  const srcs = buildings.filter(b => !b.dead && b.team === team && b.def.key === def.from && b.buildUp >= 1);
  const src = srcs.find(b => b.primary) || srcs[0];
  if(!src) return null;
  const spot = def.naval ? freeTileNear(src.tx + 1, src.ty + 1, 5, sailable) : freeTileNear(src.tx + Math.floor(src.w / 2), src.ty + src.h, 5);
  if(!spot) return null;
  const u = spawnUnit(key, spot.x * T + T / 2, spot.y * T + T / 2, team);
  u.face = u.tface = Math.PI / 2;              // rolling out of the door
  if(src.def.key === 'factory') src.doorT = 0;
  u.order = {type: 'move'};
  if(src.rally && src.rally.patrol){ if(orderPatrol(u, patrolRoute(team, u))) return u; }   // patrol rally: straight onto the round
  if(src.rally && !src.rally.patrol) orderMove(u, src.rally.x, src.rally.y);
  else if(!def.naval) orderMove(u, u.x + (rand() - .5) * 40, u.y + T * 1.5);
  return u;
}

// ---------- harvester logic ----------
export function nearestOreTile(u){
  let best = null, bd = 1e9;
  const t = tileOf(u);
  for(let y = 0; y < MH; y++)
    for(let x = 0; x < MW; x++){
      // skip ore under buildings and tiles this harvester already failed to reach
      if(ore[idx(x, y)] <= 0 || occ[idx(x, y)] !== 0 || (u.badOre && u.badOre.has(idx(x, y)))) continue;
      const d = Math.hypot(x - t.x, y - t.y);
      if(d < bd){ bd = d; best = {x, y}; }
    }
  return best;
}
export function nearestRefinery(u){
  let best = null, bd = 1e9;
  for(const b of buildings){
    if(b.dead || b.team !== u.team || b.def.key !== 'refinery') continue;
    const d = dist(u, b);
    if(d < bd){ bd = d; best = b; }
  }
  return best;
}

// the truck's gun shoots whatever comes close while it keeps working
export function truckGun(u, dt){
  const w = weaponOf(u);
  let t = u.gTarget;
  if(t && (!onMap(t) || t.team === u.team || hiddenFrom(t, u.team) || dist(u, t) > w.range * T)) t = null;
  if(!t && u.scanT <= 0){ u.scanT = 0.4; t = findEnemyInRange(u, w.range); }
  u.gTarget = t;
  if(!t){ u.tface = turnToward(u.tface, u.face, 3 * dt); return; }
  const a = Math.atan2(t.y - u.y, t.x - u.x);
  u.tface = turnToward(u.tface, a, 6 * dt);
  if(u.cool <= 0 && Math.abs(angDiff(u.tface, a)) < 0.2) fireWeapon(u, t);
}

// the Allied hauler jumps home to its refinery with a full load
export function haulerJump(u, dt){
  if(u.jumpT == null){ u.jumpT = 1.5; effects.push({type:'blink', x: u.x, y: u.y, t: 0, dur: 1.5}); }
  u.jumpT -= dt;
  if(u.jumpT > 0) return;
  u.jumpT = null;
  const b = u.retB, spot = freeTileNear(b.tx + 1, b.ty + b.h, 3);
  if(!spot) return;
  u.x = spot.x * T + T / 2; u.y = spot.y * T + T / 2; u.path = null;
  effects.push({type:'blink', x: u.x, y: u.y, t: 0, dur: 0.4, arrive: true});
  u.hState = 'unload'; u.hTimer = 0;
  if(u.team === PLAYER) sfx('blink', u);
}

export function updateHarvester(u, dt){
  const CAP = 700;
  if(weaponOf(u)) truckGun(u, dt);
  if(u.hState === 'seek'){
    if(!u.oreTile || ore[idx(u.oreTile.x, u.oreTile.y)] <= 0){
      u.oreTile = nearestOreTile(u);
      if(!u.oreTile){ u.hState = 'idle'; return; }
      orderMove(u, u.oreTile.x * T + T/2, u.oreTile.y * T + T/2);
    }
    const done = followPath(u, dt);
    const d = Math.hypot(u.x - (u.oreTile.x * T + T/2), u.y - (u.oreTile.y * T + T/2));
    if(d < T * 0.8){ u.hState = 'mine'; u.hTimer = 0; }
    else if(done && d > T){
      (u.badOre = u.badOre || new Set()).add(idx(u.oreTile.x, u.oreTile.y));
      u.oreTile = null;
    }
  } else if(u.hState === 'mine'){
    u.hTimer += dt;
    if(u.hTimer >= 0.45){
      u.hTimer = 0;
      const i = idx(u.oreTile.x, u.oreTile.y);
      const take = Math.min(30, ore[i], CAP - u.carry);
      ore[i] -= take; u.carry += take;
      if(ore[i] <= 0.5) ore[i] = 0;
      if(u.carry >= CAP){ u.hState = 'return'; u.retB = null; }
      else if(ore[i] <= 0){ u.hState = 'seek'; u.oreTile = null; }
    }
  } else if(u.hState === 'return'){
    if(!u.retB || u.retB.dead){
      u.retB = nearestRefinery(u);
      if(!u.retB){ u.hState = 'idle'; return; }
      orderMove(u, u.retB.x, (u.retB.ty + u.retB.h) * T + T/2);
    }
    if(u.fac === 'allied'){ haulerJump(u, dt); return; }
    followPath(u, dt);
    if(dist(u, u.retB) < T * 2.4){
      u.hState = 'unload'; u.hTimer = 0;
    }
  } else if(u.hState === 'unload'){
    u.hTimer += dt;
    if(u.hTimer >= 1.2){
      state.credits[u.team] += Math.round(u.carry * (u.team === ENEMY ? diff.harvest : 1));
      if(u.team === PLAYER) sfx('cash', u);
      u.carry = 0; u.hState = 'seek'; u.oreTile = null;
    }
  } else {
    u.hTimer += dt;
    if(u.hTimer > 3){ u.hTimer = 0; u.hState = u.carry > 100 ? 'return' : 'seek'; u.oreTile = null; }
  }
  if(u.order.type === 'move'){
    const done = followPath(u, dt);
    if(done){ u.order = {type:'idle'}; u.hState = 'seek'; u.oreTile = null; }
  }
}

// ---------- scout (unarmed recon infantry, never player-controlled) ----------
// it heads for the nearest unexplored ground, steering clear of any enemy building or unit sighting once that
// ground has shown up on the radar; a nearby enemy makes it turn and run instead of just avoiding the target tile.
const SCOUT_PANIC_R = 4;     // an enemy this close (tiles) makes it drop what it's doing and run
const SCOUT_AVOID_R = 6;     // stays this far from known enemy ground when picking where to explore next
const SCOUT_COORD_R = 10;    // stays this far from where another scout is already headed, so a group spreads out
const SCOUT_ALERT_LIFE = 90; // seconds a spotted enemy unit's location is remembered as dangerous ground

// enemy ground the scout's team already knows about: revealed enemy buildings (permanent) plus recent unit sightings
function scoutDanger(u){
  const spots = [];
  for(const b of buildings)
    if(!b.dead && b.team !== u.team && b.team !== NEUTRAL && explored[idx(b.tx, b.ty)])
      spots.push({x: b.tx + b.w / 2, y: b.ty + b.h / 2});
  for(const a of (state.scoutAlerts || []))
    if(a.team === u.team && a.expire > state.time) spots.push(a);
  return spots;
}

function markScoutAlert(u, tx, ty){
  const list = state.scoutAlerts = (state.scoutAlerts || []).filter(a => a.expire > state.time - 5);
  const near = list.find(a => a.team === u.team && Math.hypot(a.x - tx, a.y - ty) < 2);
  if(near) near.expire = state.time + SCOUT_ALERT_LIFE;
  else list.push({team: u.team, x: tx, y: ty, expire: state.time + SCOUT_ALERT_LIFE});
  state.scoutAlerts = list;
}

// nearest enemy unit or building within `rangeTiles`, ignoring stealthed ones it shouldn't be able to see
function nearestThreat(u, rangeTiles){
  let best = null, bd = rangeTiles * T;
  for(const v of units){
    if(!onMap(v) || v.team === u.team || v.team === NEUTRAL || hiddenFrom(v, u.team)) continue;
    const d = dist(u, v);
    if(d < bd){ bd = d; best = v; }
  }
  for(const b of buildings){
    if(b.dead || b.team === u.team || b.team === NEUTRAL) continue;
    const d = dist(u, b);
    if(d < bd){ bd = d; best = b; }
  }
  return best;
}

// Each scout wanders along its own random heading: a new scout picks the direction furthest from its
// teammates' headings, and the heading drifts a little every time it picks a new spot.
const SCOUT_TURN_COST = 7;    // tiles of extra distance that a frontier tile straight behind the heading "costs"
const SCOUT_JITTER = 5;       // random tiles added per candidate, so similar spots are chosen between at random
function scoutHeading(u){
  if(u.scoutHeading != null) return u.scoutHeading;
  const others = units.filter(v => v.def.scout && v !== u && v.team === u.team && !v.dead && v.scoutHeading != null)
                      .map(v => v.scoutHeading);
  let best = rand() * Math.PI * 2, bestGap = -1;
  for(let i = 0; i < 8 && others.length; i++){       // a few random tries; keep the one furthest from the others
    const a = rand() * Math.PI * 2;
    const gap = Math.min(...others.map(o => Math.abs(angDiff(a, o))));
    if(gap > bestGap){ bestGap = gap; best = a; }
  }
  return u.scoutHeading = best;
}

// an unexplored, walkable tile that isn't known enemy ground or where another scout is already headed:
// close by, roughly along this scout's heading, with some randomness between similar choices
function pickFrontierTile(u){
  const danger = scoutDanger(u);
  const rivals = units.filter(v => v.def.scout && v !== u && v.team === u.team && v.exploreTarget);
  const t = tileOf(u);
  const heading = scoutHeading(u);
  let best = null, bd = 1e9;
  for(let y = 0; y < MH; y++)
    for(let x = 0; x < MW; x++){
      const i = idx(x, y);
      if(explored[i] || occ[i] === BLOCKED) continue;
      if(u.badFrontier && u.badFrontier.has(i)) continue;
      if(danger.some(s => Math.hypot(x - s.x, y - s.y) < SCOUT_AVOID_R)) continue;
      if(rivals.some(v => Math.hypot(x - v.exploreTarget.x, y - v.exploreTarget.y) < SCOUT_COORD_R)) continue;
      const d = Math.hypot(x - t.x, y - t.y);
      const off = d > 0.5 ? Math.abs(angDiff(heading, Math.atan2(y - t.y, x - t.x))) / Math.PI : 0;   // 0 ahead .. 1 behind
      const score = d + off * SCOUT_TURN_COST * (1 + d / 16) + rand() * SCOUT_JITTER;
      if(score < bd){ bd = score; best = {x, y}; }
    }
  if(best){   // carry on roughly the way it went, drifting a little
    const a = Math.atan2(best.y - t.y, best.x - t.x);
    u.scoutHeading = heading + angDiff(heading, a) * 0.5 + (rand() - 0.5) * 0.6;
  }
  return best;
}

export function updateScout(u, dt){
  u.badFrontier = u.badFrontier || new Set();
  if(u.scoutState === 'home') return;   // done for the match, parked at the base

  const threat = nearestThreat(u, u.def.sight);
  if(threat){
    if(threat.kind === 'unit'){ const tt = tileOf(threat); markScoutAlert(u, tt.x, tt.y); }
    if(dist(u, threat) < SCOUT_PANIC_R * T){
      if(u.scoutState !== 'flee'){ u.scoutState = 'flee'; ack('spot', u); }
      const a = Math.atan2(u.y - threat.y, u.x - threat.x);
      orderMove(u, u.x + Math.cos(a) * 6 * T, u.y + Math.sin(a) * 6 * T);
      u.fleeT = 3;
    }
  }
  if(u.scoutState === 'flee'){
    followPath(u, dt);
    u.fleeT -= dt;
    if(u.fleeT <= 0){ u.scoutState = 'explore'; u.exploreTarget = null; u.path = null; }
    return;
  }

  if(u.scoutState === 'gohome'){
    followPath(u, dt);
    if(!u.path || u.pathI >= u.path.length){ u.scoutState = 'home'; ack('home', u); }
    return;
  }

  if(!u.exploreTarget || !u.path || u.pathI >= u.path.length){
    const target = pickFrontierTile(u);
    if(!target){
      const home = buildings.find(b => !b.dead && b.team === u.team && b.def.key === 'conyard')
                || buildings.find(b => !b.dead && b.team === u.team);
      u.scoutState = 'gohome'; u.exploreTarget = null;
      orderMove(u, home ? home.x : u.x, home ? home.y : u.y);
      return;
    }
    u.exploreTarget = target;
    orderMove(u, (target.x + 0.5) * T, (target.y + 0.5) * T);
    if(!u.path){ u.badFrontier.add(idx(target.x, target.y)); u.exploreTarget = null; return; }
  }
  followPath(u, dt);

  u.chatT = (u.chatT == null ? 10 + rand() * 20 : u.chatT) - dt;
  if(u.chatT <= 0){ ack('scout', u); u.chatT = 25 + rand() * 20; }
}

// ---------- movement & combat ----------
export function followPath(u, dt){
  if(!u.path || u.pathI >= u.path.length) return true;
  if(u.def.blink) return blinkStep(u, dt);
  const wp = u.path[u.pathI];
  const dx = wp.x - u.x, dy = wp.y - u.y;
  const d = Math.hypot(dx, dy);
  if(d < (u.def.air ? Math.max(6, u.def.r * 0.8) : 6)){ u.pathI++; return u.pathI >= u.path.length; }
  const sp = u.def.speed * dt;
  const want = Math.atan2(dy, dx);
  if(u.def.air){   // no terrain up here: turn while flying
    u.face = isInf(u.def) ? want : turnToward(u.face, want, 5 * dt);
    u.moving = true;
    u.walkPhase += dt * u.def.speed / 7;
    const k = Math.min(1, sp / d);
    u.x += dx * k; u.y += dy * k;
    return false;
  }
  if(u.def.armor === 'inf') u.face = want;
  else {
    // vehicles turn on the spot before driving off
    u.face = turnToward(u.face, want, 4.5 * dt);
    if(Math.abs(angDiff(u.face, want)) > 0.55) return false;
  }
  u.moving = true;
  u.walkPhase += dt * u.def.speed / 7;
  const nx = u.x + dx / d * sp, ny = u.y + dy / d * sp;
  if(canMove(u, Math.floor(nx / T), Math.floor(ny / T))){ u.x = nx; u.y = ny; }
  else {
    u.repathT -= dt;
    if(u.repathT <= 0){
      u.repathT = 0.6;
      const last = u.path[u.path.length - 1];
      orderMove(u, last.x, last.y);
    }
  }
  return false;
}


export function updateUnit(u, dt){
  u.cool -= dt; u.scanT -= dt; u.flash -= dt;
  u.fireT += dt; u.moving = false;
  if(u.inside){ u.x = u.inside.x; u.y = u.inside.y; return; }
  if(u.latched){ updateLatched(u, dt); return; }
  if(u.def.stealth) stealthTick(u, dt);
  if(u.def.selfRepair && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.def.selfRepair * dt);
  if(u.def.jet){ updateJet(u, dt); return; }
  if(u.def.lands){ updateHeli(u, dt); return; }
  if(u.def.air) u.z = approach(u.z, u.def.alt, 40 * dt);
  if(u.deployed && (u.order.type === 'move' || u.order.type === 'attackmove' || u.order.type === 'board' || u.order.type === 'patrol')) u.deployed = false;
  if(u.order.type === 'board'){ updateBoarding(u, dt); applySeparation(u, dt); return; }
  if(u.def.harvester){ updateHarvester(u, dt); applySeparation(u, dt); return; }
  if(u.def.engineer || u.def.spy){ updateEngineer(u, dt); applySeparation(u, dt); return; }
  if(u.def.scout){ updateScout(u, dt); applySeparation(u, dt); return; }
  let o = u.order;
  // turrets drift back to the hull's heading when not engaging
  if(hasTurret(u.def) && o.type !== 'attack') u.tface = turnToward(u.tface, u.face, 3 * dt);
  const w = weaponOf(u);
  if(u.def.ifv && !w) ifvRepair(u, dt);
  if(!w){
    if(o.type === 'attack' || o.type === 'attackmove') u.order = o = {type: o.type === 'attackmove' ? 'move' : 'idle'};
    if(o.type === 'patrol'){ patrolStep(u, o, dt); }
    else if(o.type !== 'idle' && followPath(u, dt)) u.order = {type:'idle'};
  } else if(o.type === 'attack'){
    // a patroller breaks off once the threat is gone or it has chased too far from its round
    if(o.patrol && (!o.target || !onMap(o.target) || o.target.team === u.team || hiddenFrom(o.target, u.team) ||
                    dist(u, o.leash) > PATROL_LEASH * T)){ resumePatrol(u, o.patrol); return; }
    if(!o.target || !onMap(o.target) || o.target.team === u.team || hiddenFrom(o.target, u.team)){
      if(o.resume){ u.order = {type:'attackmove', x: o.resume.x, y: o.resume.y}; orderMove(u, o.resume.x, o.resume.y); }
      else { u.order = {type:'idle'}; u.path = null; }
    }
    else combatStep(u, o.target, dt);
  } else if(o.type === 'patrol'){
    if(u.scanT <= 0){
      u.scanT = 0.4;
      const t = findEnemyInRange(u, u.def.scan || w.range + 2.2);
      const wp = o.pts[o.i];   // only threats near the round: no being lured away bit by bit
      if(t && dist(t, wp) < PATROL_LEASH * T){ u.order = {type:'attack', target: t, patrol: o, leash: wp}; return; }
    }
    patrolStep(u, o, dt);
  } else if(o.type === 'move' || o.type === 'attackmove'){
    if(o.type === 'attackmove' && u.scanT <= 0){
      u.scanT = 0.4;
      const t = findEnemyInRange(u, w.range + 1.5);
      if(t){ u.order = {type:'attack', target: t, resume: {x: o.x, y: o.y}}; return; }
    }
    const done = followPath(u, dt);
    if(done) u.order = {type:'idle'};
  } else {
    if(u.scanT <= 0){
      u.scanT = 0.45;
      const t = findEnemyInRange(u, (u.deployed ? w.range : u.def.scan || w.range + 2.2) + (groundZ(u.x, u.y) > 18 ? 1 : 0));
      if(t) u.order = {type:'attack', target: t, auto: true};
    }
  }
  if(u.def.treeDisguise) u.stillT = u.moving ? 0 : (u.stillT || 0) + dt;
  applySeparation(u, dt);
}
// ---------- patrol ----------
// P: selected units walk a loop round their base and attack whatever threat they spot, then go back to it.
export const PATROL_LEASH = 8;   // tiles from its round a patroller will chase a target
const PATROL_WANDER = 1.5, PATROL_PAUSE = 0.3;   // tiles off each point it may head for; chance to stop at one
export const canPatrol = u => !u.def.air && !u.def.naval && !u.def.harvester && !u.def.engineer && !u.def.spy &&
                              !u.def.scout && !u.def.mcv;
// eight points round the team's buildings (near its hub), 3 tiles out, clockwise; round `at` when it has none
export function patrolRoute(team, at){
  let own = buildings.filter(b => !b.dead && b.team === team && !b.def.garrison);
  const hub = own.find(b => b.def.key === 'conyard');
  if(hub) own = own.filter(b => dist(b, hub) < 18 * T);   // the main base, not a far-off captured building
  let x0, y0, x1, y1;
  if(own.length){
    x0 = Math.min(...own.map(b => b.tx)) - 3; y0 = Math.min(...own.map(b => b.ty)) - 3;
    x1 = Math.max(...own.map(b => b.tx + b.w)) + 2; y1 = Math.max(...own.map(b => b.ty + b.h)) + 2;
  } else {
    const t = tileOf(at);
    x0 = t.x - 5; y0 = t.y - 5; x1 = t.x + 5; y1 = t.y + 5;
  }
  x0 = clamp(x0, 1, MW - 2); x1 = clamp(x1, 1, MW - 2); y0 = clamp(y0, 1, MH - 2); y1 = clamp(y1, 1, MH - 2);
  const mx = Math.round((x0 + x1) / 2), my = Math.round((y0 + y1) / 2);
  const pts = [];
  for(const [x, y] of [[x0, y0], [mx, y0], [x1, y0], [x1, my], [x1, y1], [mx, y1], [x0, y1], [x0, my]]){
    const f = freeTileNear(x, y, 4);
    if(f && !pts.some(p => p.tx === f.x && p.ty === f.y)) pts.push({tx: f.x, ty: f.y, x: (f.x + 0.5) * T, y: (f.y + 0.5) * T});
  }
  return pts;
}
export function orderPatrol(u, pts){
  if(!canPatrol(u) || pts.length < 2) return false;
  let i = 0;   // start at the nearest point of the round
  pts.forEach((p, k) => { if(dist(u, p) < dist(u, pts[i])) i = k; });
  u.deployed = false;
  resumePatrol(u, {type:'patrol', pts, i});
  return true;
}
// on to the next point; after each full lap the loop is worked out again, so it follows the base as it grows
function nextPatrolPoint(u, o){
  o.i = (o.i + 1) % o.pts.length;
  if(o.i === 0){
    const pts = patrolRoute(u.team, u);
    if(pts.length >= 2){   // carry on from the point after the one it stands by
      let k0 = 0;
      pts.forEach((p, k) => { if(dist(u, p) < dist(u, pts[k0])) k0 = k; });
      o.pts = pts; o.i = (k0 + 1) % pts.length;
    }
  }
  resumePatrol(u, o);
}
// walk the round, now and then stopping to look around a while
function patrolStep(u, o, dt){
  if(o.waitT > 0){
    o.waitT -= dt;
    if(isInf(u.def)) u.face = o.lookA; else u.face = turnToward(u.face, o.lookA, 1.5 * dt);
    return;
  }
  if(!followPath(u, dt)) return;
  if(rand() < PATROL_PAUSE){ o.waitT = 1 + rand() * 2.5; o.lookA = rand() * Math.PI * 2; }
  nextPatrolPoint(u, o);
}
function resumePatrol(u, o){
  u.order = o;
  // not the point itself but somewhere open near it, so patrollers don't all walk the same line
  const p = o.pts[o.i];
  const j = freeTileNear(p.tx + Math.round((rand() - 0.5) * 2 * PATROL_WANDER), p.ty + Math.round((rand() - 0.5) * 2 * PATROL_WANDER), 1);
  const to = j ? {x: (j.x + 0.2 + rand() * 0.6) * T, y: (j.y + 0.2 + rand() * 0.6) * T} : p;
  orderMove(u, to.x, to.y);
  if(!u.path){ u.path = [{x: u.x, y: u.y}]; u.pathI = 0; }   // unreachable: counts as reached, on to the next
}

// a parked Veil Tank that hasn't fired lately looks like a tree
export const treeDisguised = u => !!u.def.treeDisguise && u.stillT > 1 && u.fireT > 3;

// a drone inside a vehicle rides along and eats it; it goes down with its host
export function updateLatched(u, dt){
  const h = u.latched;
  if(h.dead){ u.dead = true; return; }
  u.x = h.x; u.y = h.y;
  applyDamage(h, u.def.drain * dt, null, u);
  if(rand() < dt * 5)
    effects.push({type:'spark', x: h.x, y: h.y, vx:(rand()-.5)*90, vy:(rand()-.5)*90 - 30, t:0, dur:.35});
}

// ---------- aircraft ----------
export const approach = (a, b, d) => a < b ? Math.min(b, a + d) : Math.max(b, a - d);

// Stealth units can't be seen or targeted by the other side unless something of
// theirs is close by, or the unit has just fired (or, for a helicopter, landed).
export function hiddenFrom(u, team){ return !!u.def.stealth && u.team !== team && !u.revealed; }
export function stealthTick(u, dt){
  u.stealthT = (u.stealthT || 0) - dt;
  if(u.stealthT > 0) return;
  u.stealthT = 0.3;
  const near = e => !e.dead && e.team !== u.team && e.team !== NEUTRAL && dist(u, e) < (e.kind === 'building' ? 3.2 : 2.5) * T;
  u.revealed = u.fireT < 3 || (u.def.lands && u.z < 8) || units.some(v => onMap(v) && near(v)) || buildings.some(near);
}

// jet landing pads: {b: airfield, i: pad index}
export function padPos(p){ const [ox, oy] = p.b.def.pads[p.i]; return {x: p.b.x + ox * T, y: p.b.y + oy * T}; }
export function padTaken(b, i){ return units.some(j => !j.dead && j.pad && j.pad.b === b && j.pad.i === i); }
export function freePad(team){
  for(const b of buildings){
    if(b.dead || b.team !== team || !b.def.pads || b.buildUp < 1) continue;
    for(let i = 0; i < b.def.pads.length; i++) if(!padTaken(b, i)) return {b, i};
  }
  return null;
}
export function padCount(team){ return buildings.reduce((n, b) => n + (!b.dead && b.team === team && b.def.pads ? b.def.pads.length : 0), 0); }

// Strike jet: sits on its pad until ordered out, makes one bomb run, flies back
// to a pad and rearms there. With no pad to go to it circles where it is.
export function updateJet(u, dt){
  const o = u.order, alt = u.def.alt;
  if(u.pad && (u.pad.b.dead || u.pad.b.team !== u.team)) u.pad = null;
  let goal = null, bombing = false, landing = false;
  if(o.type === 'attack' && u.ammo > 0 && o.target && onMap(o.target) && o.target.team !== u.team && !hiddenFrom(o.target, u.team)){
    goal = o.target; bombing = true;
  } else if((o.type === 'move' || o.type === 'attackmove') && u.path && u.pathI < u.path.length){
    goal = u.path[u.path.length - 1];
  } else if(o.type !== 'idle') u.order = {type: 'idle'};
  if(!goal){
    if(!u.pad) u.pad = freePad(u.team);
    if(u.pad){
      const pp = padPos(u.pad);
      if(u.docked || (dist(u, pp) < 5 && u.z < 8)){
        u.docked = true; u.moving = false;
        u.x = pp.x; u.y = pp.y; u.z = approach(u.z, 0, 50 * dt);
        if(u.ammo < u.def.ammo && (u.rearmT = (u.rearmT || 0) + dt) >= u.def.rearm){ u.ammo = u.def.ammo; u.rearmT = 0; }
        return;
      }
      goal = pp; landing = true;
    }
  }
  u.docked = false; u.moving = true;
  // climb off the pad before flying anywhere
  const d = goal ? dist(u, goal) : 1e9;
  u.z = approach(u.z, landing && d < 2.5 * T ? 0 : alt, 55 * dt);
  if(u.z < 16 && !landing) return;
  if(!goal){ u.face += 1.3 * dt; }   // nowhere to land: circle
  else {
    const want = Math.atan2(goal.y - u.y, goal.x - u.x);
    u.face = turnToward(u.face, want, (d < 3 * T ? 7 : 2.4) * dt);
  }
  let sp = u.def.speed * dt;
  if(landing) sp *= clamp(d / (3 * T), 0.2, 1);
  if(goal && d <= sp && Math.abs(angDiff(u.face, Math.atan2(goal.y - u.y, goal.x - u.x))) < 1){ u.x = goal.x; u.y = goal.y; }
  else { u.x += Math.cos(u.face) * sp; u.y += Math.sin(u.face) * sp; }
  u.x = clamp(u.x, T / 2, WPX - T / 2); u.y = clamp(u.y, T / 2, HPX - T / 2);
  if(bombing){
    const pad = goal.kind === 'building' ? Math.max(goal.w, goal.h) * T * 0.4 : 0;
    if(dist(u, goal) - pad <= u.def.weapon.range * T){
      fireWeapon(u, goal);
      u.ammo--;
      u.order = {type: 'idle'};
    }
  } else if(goal && !landing && d < T * 0.6) u.order = {type: 'idle'};
}

// Transport helicopter: lands whenever it has nowhere to go, takes off to move.
export function updateHeli(u, dt){
  const o = u.order;
  const flying = o.type !== 'idle' && u.path && u.pathI < u.path.length;
  if(!flying && o.type !== 'idle') u.order = {type: 'idle'};
  const t = tileOf(u);
  const canLand = passable(t.x, t.y) && !units.some(v => v !== u && v.def.lands && onMap(v) && v.z < 6 && dist(u, v) < T);
  u.z = approach(u.z, flying || !canLand ? u.def.alt : 0, 45 * dt);
  u.moving = u.z > 1;
  if(flying && u.z > u.def.alt * 0.5 && followPath(u, dt)) u.order = {type: 'idle'};
  if(u.unloadLanded && (u.z < 2 || !canLand)){ u.unloadLanded = false; unloadTransport(u, true); }
  applySeparation(u, dt);
}

// ---------- special infantry ----------
// disguised spies fool everyone except hounds
export function fooledBy(e, u){
  if(u.def.treeDisguise) return u.fireT > 3;           // the Veil Tank gives itself away only by firing
  if(!u.def.disguise) return false;
  const w = weaponOf(e);
  return !(w && w.kind === 'bite');
}

// Psion: takes over one enemy ground unit (not another psion) until the psion dies.
export function mindable(e, t){ return t.kind === 'unit' && !t.def.air && t.def.key !== 'psion' && !t.mindOwner; }
export function mindControl(e, t){
  if(!mindable(e, t) || t.team === e.team) return;
  if(t.cargo && t.cargo.length) unloadTransport(t, true);
  t.mindOwner = e; t.origTeam = t.team;
  t.team = e.team; t.order = {type:'idle'}; t.path = null; t.role = 'attacker'; t.deployed = false;
  e.controlled = t;
  if(t.origTeam === PLAYER){
    announce('Unit lost to mind control!', true, 'Unit mind controlled');
    setSelection(selection.filter(s => s !== t));
    for(const k in groups) groups[k] = groups[k].filter(s => s !== t);
  }
}
// a dead psion lets go
export function releaseMind(e){
  const t = e.controlled;
  e.controlled = null;
  if(!t || t.dead) return;
  t.team = t.origTeam; t.mindOwner = null; t.order = {type:'idle'}; t.path = null; t.role = 'defend';
  if(t.team === PLAYER) announce('Unit freed', false);
}

// Radiation: puddles left by isotope shots, and a field round each deployed isotope trooper.
export const radPuddles = [];
export const RAD_VS = {inf:1, heavy:0.2, building:0};
export function radSources(){
  const out = radPuddles.slice();
  for(const u of units) if(onMap(u) && u.deployed && u.def.radiate) out.push({x: u.x, y: u.y, r: u.def.radiate * T, team: u.team, dps: 32, src: u});
  return out;
}
export function tickRadiation(dt){
  for(let i = radPuddles.length - 1; i >= 0; i--) if(radPuddles[i].until <= state.time) radPuddles.splice(i, 1);
  for(const z of radSources())
    for(const u of units){
      if(!onMap(u) || u.team === z.team || u.team === NEUTRAL || u.def.air) continue;
      if(Math.hypot(u.x - z.x, u.y - z.y) < z.r) applyDamage(u, z.dps * dt, RAD_VS, z.src.dead ? null : z.src);
    }
}

// Blink trooper: instead of walking, charges up and appears at the end of its path.
export function blinkStep(u, dt){
  const dest = u.path[u.path.length - 1];
  if(u.blinkT == null){
    u.blinkT = 0.5 + Math.hypot(dest.x - u.x, dest.y - u.y) / 500;
    effects.push({type:'blink', x: u.x, y: u.y, t: 0, dur: u.blinkT});
  }
  u.blinkT -= dt;
  if(u.blinkT > 0) return false;
  u.blinkT = null;
  let x = dest.x, y = dest.y;
  if(!passable(Math.floor(x / T), Math.floor(y / T))){
    const f = freeTileNear(Math.floor(x / T), Math.floor(y / T), 4);
    if(f){ x = f.x * T + T / 2; y = f.y * T + T / 2; }
  }
  u.face = Math.atan2(y - u.y, x - u.x);
  u.x = x; u.y = y;
  u.pathI = u.path.length;
  effects.push({type:'blink', x, y, t: 0, dur: 0.4, arrive: true});
  sfx('blink', u);
  if(u.team === PLAYER) revealAround(x, y, 6);
  return true;
}

// Infiltrator: walks into an enemy building and sabotages it
export function spyCan(b, team){ return !!b && b.kind === 'building' && !b.dead && b.team !== team && b.team !== NEUTRAL && !b.def.garrison; }
export function spyEnter(u, b){
  u.dead = true;
  const was = b.team, mine = u.team === PLAYER;
  let msg = 'Building infiltrated';
  if(b.def.key === 'refinery'){
    const take = Math.min(3000, Math.floor(state.credits[was] * 0.5));
    state.credits[was] -= take; state.credits[u.team] += take;
    msg = 'Credits stolen: $' + take;
  } else if(b.def.key === 'power'){
    state.blackout[was] = state.time + 45;
    msg = 'Enemy power sabotaged';
  } else if(b.def.key === 'radar' && mine){
    explored.fill(1); flags.shroudDirty = true;
    msg = 'Enemy radar compromised';
  }
  if(mine){ revealAround(b.x, b.y, 10); announce(msg, false, msg); sfx('cash'); }
  else if(was === PLAYER) announce('Our base has been infiltrated!', true, 'Base infiltrated');
}

// ---------- transports ----------
// infantry board friendly transports, or garrison a town building that is empty or already theirs
export const capacity = t => t.def.transport || t.def.garrison || 0;
export const canGarrison = def => def.armor === 'inf' && !!def.weapon && def.weapon.kind !== 'bite';
export function canBoard(u, t){
  if(!t || t.dead || t === u || !t.cargo || t.cargo.length >= capacity(t)) return false;
  if(t.def.carriesVehicles)   // landing craft: any ground unit that isn't carrying anyone itself
    return t.team === u.team && !u.def.air && !u.def.naval && !(u.cargo && u.cargo.length);
  if(u.def.armor !== 'inf') return false;
  if(t.kind === 'building') return (t.team === NEUTRAL || t.team === u.team) && canGarrison(u.def) && t.buildUp >= 1;
  return t.team === u.team && !!t.def.transport;
}
// a building's edge (or a unit's centre) is close enough to step in
export function atDoor(u, t){
  if(t.def.naval) return dist(u, t) < T * 1.8;   // step aboard from the shore
  if(t.kind !== 'building') return dist(u, t) < T * 0.9;
  const ex = clamp(u.x, t.tx * T, (t.tx + t.w) * T), ey = clamp(u.y, t.ty * T, (t.ty + t.h) * T);
  return Math.hypot(u.x - ex, u.y - ey) < T * 0.8;
}
export function updateBoarding(u, dt){
  const t = u.order.target;
  if(!canBoard(u, t)){ u.order = {type:'idle'}; u.path = null; return; }
  if(atDoor(u, t)){
    if(t.def.lands && t.z > 4){ u.path = null; return; }   // wait for it to touch down
    u.inside = t; u.order = {type:'idle'}; u.path = null; u.deployed = false;
    t.cargo.push(u);
    if(t.kind === 'building'){ t.team = u.team; t.target = null; }   // the town building flies our flag
    if(u.team === PLAYER){ setSelection(selection.filter(s => s !== u)); sfx('click'); }
    return;
  }
  u.repathT -= dt;
  if(!u.path || u.pathI >= u.path.length || u.repathT <= 0){ u.repathT = 0.6; orderMove(u, t.x, t.y); }
  followPath(u, dt);
}
// everyone out, spread over the free tiles around the transport
export function unloadTransport(t, now){
  if(!t.cargo || !t.cargo.length) return [];
  if(t.def.lands && t.z > 2 && !now){   // a helicopter sets down first
    t.unloadLanded = true; t.order = {type:'idle'}; t.path = null;
    return [];
  }
  const tt = tileOf(t);
  if(t.def.naval && !freeTileNear(tt.x, tt.y, 2)){   // a landing craft needs a beach
    if(t.team === PLAYER) announce('Move closer to the shore', false, 'Move closer to the shore');
    return [];
  }
  const out = t.cargo.splice(0);
  out.forEach((u, i) => {
    const a = i / out.length * Math.PI * 2 + 0.6;
    const spot = freeTileNear(Math.round(tt.x + Math.cos(a) * 1.2), Math.round(tt.y + Math.sin(a) * 1.2), 3) || freeTileNear(tt.x, tt.y, 3) || tt;
    u.inside = null;
    u.x = spot.x * T + T / 2 + (rand() - 0.5) * 10; u.y = spot.y * T + T / 2 + (rand() - 0.5) * 10;
    u.order = {type:'idle'}; u.path = null;
  });
  t.order = {type:'idle'}; t.path = null;
  if(t.team === PLAYER) sfx('click');
  if(t.kind === 'building'){ t.team = NEUTRAL; t.target = null; setSelection(selection.filter(s => s !== t)); }
  return out;
}

// Garrisoned town building: every occupant fires its own weapon from it, with a
// little extra range for the height.
export function garrisonFire(b){
  for(const u of b.cargo){
    const w = weaponOf(u);
    if(!w || u.cool > 0) continue;
    const reach = w.range + 1 + b.w * 0.4;
    let t = u.gTarget;
    if(!t || !onMap(t) || t.team === b.team || hiddenFrom(t, b.team) || dist(b, t) > reach * T) t = null;
    if(!t && u.scanT <= 0){ u.scanT = 0.4; t = findEnemyInRange(u, reach); }
    u.gTarget = t;
    if(t) fireWeapon(u, t);
  }
}
// an IFV carrying an engineer patches up the nearest damaged friendly vehicle
export function ifvRepair(u, dt){
  let best = null, bd = 4 * T;
  for(const v of units){
    if(!onMap(v) || v.team !== u.team || v === u || v.def.armor !== 'heavy' || v.hp >= v.maxHp) continue;
    const d = dist(u, v);
    if(d < bd){ bd = d; best = v; }
  }
  if(!best) return;
  best.hp = Math.min(best.maxHp, best.hp + 18 * dt);
  u.face = turnToward(u.face, Math.atan2(best.y - u.y, best.x - u.x), 3 * dt);
  if(u.cool <= 0){
    u.cool = 0.5;
    effects.push({type:'beam', x1: u.x, y1: u.y, z1: 12, x2: best.x, y2: best.y, t: 0, dur: 0.25, thin: true, heal: true});
  }
}

// ---------- engineers ----------
export function engineerCan(b, team){
  return !!b && b.kind === 'building' && !b.dead && b.buildUp >= 1 && !b.def.garrison &&
    ((b.team !== team && b.team !== NEUTRAL) || (b.team === team && b.hp < b.maxHp));
}
export function updateEngineer(u, dt){
  const o = u.order;
  if(o.type !== 'capture'){
    if(o.type === 'patrol'){ patrolStep(u, o, dt); }
    else if(o.type !== 'idle' && followPath(u, dt)) u.order = {type:'idle'};
    return;
  }
  const b = o.target;
  if(!(u.def.spy ? spyCan(b, u.team) : engineerCan(b, u.team))){ u.order = {type:'idle'}; u.path = null; return; }
  // close enough to the footprint's edge to walk in?
  if(atDoor(u, b)){ if(u.def.spy) spyEnter(u, b); else engineerEnter(u, b); return; }
  u.repathT -= dt;
  if(!u.path || u.pathI >= u.path.length || u.repathT <= 0){ u.repathT = 1; orderMove(u, b.x, b.y); }
  followPath(u, dt);
}
export function engineerEnter(u, b){
  u.dead = true;
  sfx('built');
  if(b.team === u.team){
    b.hp = b.maxHp; b.repairing = false;
    if(u.team === PLAYER) announce('Structure repaired', false, 'Structure repaired');
    return;
  }
  const was = b.team;
  b.team = u.team; b.target = null; b.repairing = false; b.rally = null; b.primary = false;
  if(u.team === PLAYER) announce(dispName(b.def, was) + ' captured', false, 'Building captured');
  else if(was === PLAYER){ announce('Structure captured by the enemy!', true, 'Our building has been captured'); setSelection(selection.filter(s => s !== b)); }
  if(u.team === PLAYER) revealAround(b.x, b.y, 7);
  refreshSidebar();
}

// between two ore trucks: a loaded one heading home goes first, else the older one
const rightOfWay = (u, v) => (u.hState === 'return') !== (v.hState === 'return') ? u.hState === 'return' : u.id < v.id;
export function applySeparation(u, dt){
  if(u.def.jet) return;
  for(const v of units){
    if(v === u || !onMap(v) || !!v.def.air !== !!u.def.air || !!v.def.naval !== !!u.def.naval || v.def.jet) continue;
    if(u.def.harvester && !v.def.harvester) continue;   // everyone makes way for the ore trucks
    if(u.def.harvester && v.def.harvester && rightOfWay(u, v)) continue;   // and trucks for each other, or two meeting head-on stall
    const dx = u.x - v.x, dy = u.y - v.y;
    const d = Math.hypot(dx, dy);
    const min = (u.def.r + v.def.r) * (u.def.air ? 0.6 : 1);   // aircraft may overlap a bit
    if(d > 0.01 && d < min){
      const push = (min - d) * 2.4 * dt * 10;
      const nx = u.x + dx / d * push, ny = u.y + dy / d * push;
      if(u.def.air || canMove(u, Math.floor(nx / T), Math.floor(ny / T))){ u.x = nx; u.y = ny; }
    }
  }
  u.x = clamp(u.x, T/2, WPX - T/2);
  u.y = clamp(u.y, T/2, HPX - T/2);
}

export function updateBuilding(b, dt){
  b.cool -= dt; b.scanT -= dt; b.flash -= dt;
  if(b.doorT != null) b.doorT += dt;
  if(b.buildUp < 1) b.buildUp = Math.min(1, b.buildUp + dt * 1.4);
  if(b.repairing){
    const heal = Math.min(b.maxHp * 0.08 * dt, b.maxHp - b.hp);
    const cost = b.def.cost * 0.35 * heal / b.maxHp;
    if(heal <= 0) b.repairing = false;
    else if(state.credits[b.team] >= cost){ state.credits[b.team] -= cost; b.hp += heal; }
  }
  if(b.hp < b.maxHp * 0.5){
    b.smokeAcc = (b.smokeAcc || 0) + dt * (b.hp < b.maxHp * 0.25 ? 9 : 4);
    while(b.smokeAcc > 1){
      b.smokeAcc -= 1;
      effects.push({type:'puff', x: b.x + (rand() - .5) * b.w * T * 0.5, y: b.y + (rand() - .5) * b.h * T * 0.5,
                    z: b.def.z * 0.8, r: 6 + rand() * 5, t: 0, dur: 1.8 + rand(), dark: true});
    }
  }
  if(b.def.flat && b.buildUp >= 1) serviceDepot(b, dt);
  if(b.cargo && b.cargo.length) garrisonFire(b);
  if(!b.def.weapon) return;
  const p = powerOf(b.team);
  if(p.used > p.prod) return;
  if(b.target && (!onMap(b.target) || b.target.team === b.team || hiddenFrom(b.target, b.team) || dist(b, b.target) > b.def.weapon.range * T * 1.1)) b.target = null;
  if(!b.target && b.scanT <= 0){
    b.scanT = 0.4;
    b.target = findEnemyInRange(b, b.def.weapon.range);
  }
  if(b.target && b.cool <= 0 && dist(b, b.target) <= b.def.weapon.range * T)
    fireWeapon(b, b.target);
}

// Service depot: fixes the most damaged vehicle parked on it (for credits, at half
// speed on low power) and pulls out any drone latched inside a parked vehicle.
export const onFootprint = (u, b) => u.x >= b.tx * T && u.x < (b.tx + b.w) * T && u.y >= b.ty * T && u.y < (b.ty + b.h) * T;
export function serviceDepot(b, dt){
  b.svcT = (b.svcT || 0) - dt;
  const parked = units.filter(u => onMap(u) && u.team === b.team && u.def.armor === 'heavy' && !u.moving && onFootprint(u, b));
  for(const d of units){
    if(!d.latched || !parked.includes(d.latched)) continue;
    d.x = d.latched.x + T * 0.6; d.y = d.latched.y + T * 0.6;
    d.latched = null;
    kill(d);
    if(b.team === PLAYER) announce('Drone removed', false, 'Drone removed');
  }
  const v = parked.filter(u => u.hp < u.maxHp).sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp)[0];
  if(!v) return;
  const p = powerOf(b.team);
  const heal = Math.min(v.maxHp * 0.1 * dt * (p.used > p.prod ? 0.5 : 1), v.maxHp - v.hp);
  const cost = v.def.cost * 0.4 * heal / v.maxHp;
  if(state.credits[b.team] < cost) return;
  state.credits[b.team] -= cost;
  v.hp += heal;
  if(b.svcT <= 0){
    b.svcT = 0.4;
    effects.push({type:'beam', x1: b.x - T, y1: b.y - T, z1: 30, x2: v.x, y2: v.y, t: 0, dur: 0.3, thin: true, heal: true});
  }
}
