// Red Horizon: Weapons, damage, death, projectiles and splash.
import {NEUTRAL, PLAYER, T, angDiff, bareOcc, buildings, clamp, dist, effects, flags, groundZ, hasTurret, idx, isInf, occ, onMap, projectiles, state, turnToward, uName, units, vsMult, walk, weaponOf} from './data.js';
import {orderMove} from './pathfinding.js';
import {CHUNK, LOW_SCALE, TERRAIN_SCALE, chunkCols, chunks, lowC, paintScorch, scorches} from './render.js';
import {announce, underAttackAlert} from './ui.js';
import {sfx} from './sound.js';
import {followPath, fooledBy, hiddenFrom, mindControl, mindable, radPuddles, releaseMind, unloadTransport} from './units.js';
import {rand} from './rng.js';

// the weapon a unit uses on this particular target (the Striker blows up buildings with a charge)
export const weaponFor = (e, t) => t && t.kind === 'building' && e.def.demolish ? e.def.demolish : weaponOf(e);
export const canHurt = (e, t) => {
  const w = weaponFor(e, t);
  if(!w || vsMult(w.vs, t.def.armor) <= 0 || (w.kind === 'mind' && !mindable(e, t))) return false;
  if(w.seaOnly && !t.def.naval && !t.def.onWater) return false;   // torpedoes need water
  if(t.def.naval && w.range < 1.5 && !e.def.air) return false;     // nobody wades out to a ship
  return true;
};

// ---------- damage / death ----------
export function applyDamage(target, dmg, vs, attacker){
  if(target.dead) return;
  const mult = vsMult(vs, target.def.armor);
  const vet = attacker && attacker.vet || 0;           // veterans hit harder
  const armor = 1 - (target.vet || 0) * 0.12;          // ...and take less damage
  target.hp -= dmg * mult * (1 + vet * 0.25) * armor * (target.deployed ? 0.5 : 1);   // sandbags halve it
  target.flash = 0.12;
  if(target.team === PLAYER) underAttackAlert(target);
  if(target.kind === 'unit' && weaponOf(target) && !target.def.harvester && target.order.type === 'idle' && attacker && onMap(attacker)
     && attacker.team !== NEUTRAL && canHurt(target, attacker))
    target.order = {type:'attack', target: attacker, auto:true};
  if(target.hp <= 0){
    kill(target);
    if(attacker && attacker.kind === 'unit' && !attacker.dead && target.team !== NEUTRAL) gainXp(attacker, target);
  }
}

// veterancy: destroying enough enemy value (relative to your own cost) promotes once, twice for elite
export function gainXp(u, victim){
  u.xp = (u.xp || 0) + (victim.def.cost || 400);
  const lvl = u.xp >= u.def.cost * 3 ? 2 : u.xp >= u.def.cost * 1.5 ? 1 : 0;
  if(lvl > (u.vet || 0)){
    u.vet = lvl;
    if(u.team === PLAYER) announce(lvl === 2 ? 'Unit promoted to elite' : 'Unit promoted', false, 'Unit promoted');
  }
}

export function kill(e){
  e.dead = true;
  if(e.controlled) releaseMind(e);
  if(e.cargo && e.kind === 'building'){                // a garrison bails out of a falling building, hurt
    for(const p of unloadTransport(e)) p.hp = Math.max(1, p.hp * 0.5);
  } else if(e.cargo) for(const p of e.cargo) p.dead = true;   // nobody gets out of a burning transport
  sfx(e.kind === 'building' ? 'collapse' : isInf(e.def) ? 'death' : 'explosion', e);
  const dieSprite = e.kind === 'unit' ? uName(e) + '_die' : null;
  if(e.kind === 'unit' && isInf(e.def) && Sprites.has(dieSprite)){
    effects.push({type:'corpse', x: e.x, y: e.y, name: dieSprite, team: e.team, t: 0, dur: 4});
  } else if(e.kind === 'building'){
    // a building goes up in several staggered blasts
    for(let i = 0; i < e.w * e.h; i++){
      const ox = (rand() - 0.5) * e.w * T * 0.8, oy = (rand() - 0.5) * e.h * T * 0.8;
      effects.push({type:'delay', t: 0, dur: i * 0.12, then: {x: e.x + ox, y: e.y + oy, size: 22 + rand() * 16}});
    }
    boom(e.x, e.y, e.def.w * 16);
    scorch(e.x, e.y, e.w * T * 0.6);
    effects.push({type:'smokecol', x: e.x, y: e.y, t: 0, dur: 6, acc: 0});
  } else {
    boom(e.x, e.y, 18);
    scorch(e.x, e.y, 18);
    effects.push({type:'smokecol', x: e.x, y: e.y, t: 0, dur: 3.5, acc: 0});
  }
  if(e.kind === 'building'){
    for(let y = e.ty; y < e.ty + e.h; y++)
      for(let x = e.tx; x < e.tx + e.w; x++)
        if(occ[idx(x, y)] === e.id){ occ[idx(x, y)] = bareOcc(idx(x, y)); walk[idx(x, y)] = 0; }
    if(e.team === PLAYER) announce('Structure lost', true);
  }
}

export function boom(x, y, size){
  effects.push({type:'boom', x, y, size, t: 0, dur: 0.7});
  for(let i = 0; i < 5; i++)
    effects.push({type:'puff', x: x + (rand() - .5) * size * 0.8, y: y + (rand() - .5) * size * 0.8,
                  z: 4 + rand() * size * 0.4, r: size * (0.35 + rand() * 0.3), t: -i * 0.04, dur: 1.2 + rand() * 0.6});
  for(let i = 0; i < 8; i++)
    effects.push({type:'spark', x, y, vx:(rand()-.5)*200, vy:(rand()-.5)*200 - 40, t:0, dur:.5 + rand()*.4});
}

// burn mark painted permanently into the ground
export function scorch(x, y, r){
  const s = {x, y, r};
  scorches.push(s);
  chunks.forEach((c, id) => {
    if(c instanceof HTMLCanvasElement) paintScorch(c, (id % chunkCols) * CHUNK, Math.floor(id / chunkCols) * CHUNK, TERRAIN_SCALE, s);
  });
  paintScorch(lowC, 0, 0, LOW_SCALE, s);
  flags.mmBaseDirty = true;
}


export function findEnemyInRange(e, rangeTiles){
  let best = null, bd = 1e9;
  const rp = rangeTiles * T;
  for(const u of units){
    if(!onMap(u) || u.team === e.team || u.team === NEUTRAL || !canHurt(e, u) || hiddenFrom(u, e.team) || fooledBy(e, u)) continue;
    const d = dist(e, u);
    if(d <= rp && d < bd){ bd = d; best = u; }
  }
  if(!best && !e.def.demolish) for(const b of buildings){
    if(b.dead || b.team === e.team || b.team === NEUTRAL || !canHurt(e, b)) continue;
    const d = dist(e, b) - Math.max(b.w, b.h) * T * 0.35;
    if(d <= rp && d < bd){ bd = d; best = b; }
  }
  return best;
}

export function fireWeapon(e, target){
  const w = weaponFor(e, target);
  e.cool = w.rof / (1 + (e.vet || 0) * 0.2);
  e.fireT = 0;
  if(e.kind === 'unit'){
    const a = Math.atan2(target.y - e.y, target.x - e.x);
    if(hasTurret(e.def) || e.def.harvester) e.tface = a; else e.face = a;
  }
  const zSrc = (e.kind === 'building' ? e.def.z - 4 : isInf(e.def) ? 10 : 14) + (e.z || 0);
  if(w.kind === 'beam' || w.kind === 'arc'){
    effects.push({type: w.kind, x1: e.x, y1: e.y, z1: zSrc, x2: target.x, y2: target.y, t: 0, dur: 0.18});
    applyDamage(target, w.dmg, w.vs, e);
    // the Lancer's beam refracts off its target into enemies close by
    let from = target;
    const hit = new Set([target]);
    for(let i = 0; i < (w.chain || 0); i++){
      let next = null, nd = 2.6 * T;
      for(const v of units){
        if(!onMap(v) || hit.has(v) || v.team === e.team || v.team === NEUTRAL || !canHurt(e, v) || hiddenFrom(v, e.team)) continue;
        const d = dist(from, v);
        if(d < nd){ nd = d; next = v; }
      }
      if(!next) break;
      effects.push({type: 'beam', x1: from.x, y1: from.y, z1: 6, x2: next.x, y2: next.y, t: 0, dur: 0.18, thin: true});
      applyDamage(next, w.dmg * 0.5, w.vs, e);
      hit.add(next); from = next;
    }
    sfx(w.kind === 'arc' ? 'arc' : 'zap', e);
  } else if(w.kind === 'snipe'){
    effects.push({type: 'tracer', x1: e.x, y1: e.y, x2: target.x, y2: target.y, t: 0, dur: 0.12});
    applyDamage(target, w.dmg, w.vs, e);
    sfx('snipe', e);
  } else if(w.kind === 'bite'){
    applyDamage(target, w.dmg, w.vs, e);
    sfx('bite', e);
    return;
  } else if(w.kind === 'latch'){
    if(target.def.armor === 'inf'){ applyDamage(target, w.dmg, w.vs, e); sfx('bite', e); return; }
    // crawl inside the vehicle and take it apart from within
    e.latched = target;
    e.order = {type: 'idle'}; e.path = null;
    e.x = target.x; e.y = target.y;
    sfx('latch', e);
    if(target.team === PLAYER) announce('Vehicle infested!', true, 'Vehicle infested');
    return;
  } else if(w.kind === 'charge'){
    // a timed charge stuck to the target; it goes off after `fuse` seconds
    effects.push({type:'charge', target, x: target.x, y: target.y, t: 0, dur: w.fuse, dmg: w.dmg, vs: w.vs, src: e, team: e.team});
    sfx('click', e);
    if(target.team === PLAYER && state.time - state.chargeMsgT > 8){ state.chargeMsgT = state.time; announce('Explosive charge planted!', true); }
    return;
  } else if(w.kind === 'mind'){
    effects.push({type:'arc', x1: e.x, y1: e.y, z1: zSrc, x2: target.x, y2: target.y, t: 0, dur: 0.35, col: '200,120,255'});
    mindControl(e, target);
    sfx('mind', e);
    return;
  } else if(w.kind === 'rad'){
    effects.push({type:'beam', x1: e.x, y1: e.y, z1: zSrc, x2: target.x, y2: target.y, t: 0, dur: 0.2, col: '140,255,90'});
    applyDamage(target, w.dmg, w.vs, e);
    radPuddles.push({x: target.x, y: target.y, r: T, team: e.team, until: state.time + 5, dps: 18, src: e});
    sfx('rad', e);
    return;
  } else if(w.kind === 'bomb'){
    // dropped from altitude: a jet lays a pair across its path, the airship one at a time
    const n = e.def.jet ? 2 : 1, side = e.face + Math.PI / 2;
    for(let i = 0; i < n; i++){
      const off = (i - (n - 1) / 2) * 0.7 * T;
      projectiles.push({x: e.x, y: e.y, sx: e.x, sy: e.y, tx: target.x + Math.cos(side) * off, ty: target.y + Math.sin(side) * off,
                        z0: e.z || 0, z: e.z || 0, t: 0, fall: 0.7 + i * 0.12, target: null,
                        dmg: w.dmg, vs: w.vs, kind: 'bomb', splash: w.splash * T, team: e.team, src: e, life: 5});
    }
    sfx('bomb', e);
    return;
  } else if(w.kind === 'missile'){
    // lobbed at the ground where the target stands now; splash hurts everything nearby
    projectiles.push({
      x: e.x, y: e.y, sx: e.x, sy: e.y, target: null, tx: target.x, ty: target.y,
      total: Math.max(1, dist(e, target)), speed: 150,
      dmg: w.dmg, vs: w.vs, kind: 'missile', splash: w.splash * T, team: e.team, src: e, life: 12,
    });
    sfx('missile', e);
    return;
  } else {
    projectiles.push({
      x: e.x, y: e.y, target, tx: target.x, ty: target.y,
      z0: e.z || 0, zt: target.z || 0, total: Math.max(1, dist(e, target)),
      speed: w.kind === 'rocket' ? 210 : w.kind === 'torpedo' ? 160 : 380,
      dmg: w.dmg, vs: w.vs, kind: w.kind, team: e.team, src: e, life: 3,
    });
    sfx(w.kind === 'shell' ? 'cannon' : w.kind === 'torpedo' || w.kind === 'rocket' || w.kind === 'flak' ? w.kind : 'shoot', e);
  }
  effects.push({type:'muzzle', x: e.x, y: e.y, z: zSrc, a: Math.atan2(target.y - e.y, target.x - e.x), t: 0, dur: 0.07});
}

// shooting down from the plateau reaches a tile further
export const highGround = (a, b) => groundZ(a.x, a.y) > TerrainGen.CLIFF_H * 0.9 && groundZ(b.x, b.y) < TerrainGen.CLIFF_H * 0.5 && !a.def.air ? 1 : 0;

export function combatStep(u, target, dt){
  const w = weaponFor(u, target);
  const pad = target.kind === 'building' ? Math.max(target.w, target.h) * T * 0.4 : 0;
  // hand-placed charges and bombs reach a building's walls, not just near its middle
  const d = target.kind === 'building' && w.range <= 1 ? Math.hypot(u.x - clamp(u.x, target.tx * T, (target.tx + target.w) * T),
                                                                   u.y - clamp(u.y, target.ty * T, (target.ty + target.h) * T))
                                                        : dist(u, target) - pad;
  if(d <= (w.range + highGround(u, target)) * T){
    u.path = null;
    const a = Math.atan2(target.y - u.y, target.x - u.x);
    let aimed = true;
    if(hasTurret(u.def)){
      u.tface = turnToward(u.tface, a, 5 * dt);
      aimed = Math.abs(angDiff(u.tface, a)) < 0.15;
    } else if(isInf(u.def)) u.face = a;
    else if(w.kind !== 'bomb'){             // turretless vehicles swing the whole hull round
      u.face = turnToward(u.face, a, 4 * dt);
      aimed = Math.abs(angDiff(u.face, a)) < 0.12;
    }
    if(u.cool <= 0 && aimed) fireWeapon(u, target);
  } else if(u.deployed){ u.order = {type:'idle'}; u.path = null;   // dug in: doesn't chase
  } else {
    u.repathT -= dt;
    if(!u.path || u.pathI >= u.path.length || u.repathT <= 0){
      u.repathT = 0.8;
      orderMove(u, target.x, target.y);
    }
    followPath(u, dt);
  }
}


export function updateProjectiles(dt){
  for(const p of projectiles){
    p.life -= dt;
    if(p.kind === 'bomb'){
      p.t += dt;
      const f = Math.min(1, p.t / p.fall);
      p.x = p.sx + (p.tx - p.sx) * f; p.y = p.sy + (p.ty - p.sy) * f; p.z = p.z0 * (1 - f * f);
      if(f >= 1){
        splashDamage(p.tx, p.ty, p.splash, p.dmg, p.vs, p.src, p.team);
        boom(p.tx, p.ty, 30); scorch(p.tx, p.ty, 24); sfx('explosion', {x: p.tx, y: p.ty});
        p.dead = true;
      }
      continue;
    }
    if(p.target && !p.target.dead){ p.tx = p.target.x; p.ty = p.target.y; p.zt = p.target.z || 0; }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if(d <= step + 6 || p.life <= 0){
      if(p.splash){
        splashDamage(p.tx, p.ty, p.splash, p.dmg, p.vs, p.src, p.team);
        boom(p.tx, p.ty, 26); scorch(p.tx, p.ty, 22); sfx('explosion', {x: p.tx, y: p.ty}, 0.8);
      } else {
        if(p.target && !p.target.dead) applyDamage(p.target, p.dmg, p.vs, p.src);
        effects.push({type:'hit', x: p.tx, y: p.ty, z: p.zt || 0, t: 0, dur: 0.22, big: p.kind !== 'bullet'});
      }
      p.dead = true;
    } else {
      p.x += dx / d * step; p.y += dy / d * step;
      if((p.kind === 'rocket' && rand() < 0.6) || p.kind === 'missile')
        effects.push({type:'smoke', x: p.x, y: p.y, z: missileZ(p), t: 0, dur: p.kind === 'missile' ? 0.9 : 0.4});
    }
  }
}

// height of a lobbed missile: a high arc over its flight
export function missileZ(p){
  const f = clamp(1 - Math.hypot(p.tx - p.x, p.ty - p.y) / p.total, 0, 1);
  return 14 + Math.sin(f * Math.PI) * Math.min(220, p.total * 0.45);
}

// area damage with linear falloff; spares the attacker's own side
export function splashDamage(x, y, r, dmg, vs, src, team){
  const c = {x, y};
  for(const u of units){
    if(!onMap(u) || u.team === team || vsMult(vs, u.def.armor) <= 0) continue;
    const d = dist(c, u);
    if(d < r) applyDamage(u, dmg * (1 - d / r * 0.6), vs, src);
  }
  for(const b of buildings){
    if(b.dead || b.team === team) continue;
    const d = Math.max(0, dist(c, b) - Math.max(b.w, b.h) * T * 0.4);
    if(d < r) applyDamage(b, dmg * (1 - d / r * 0.6), vs, src);
  }
}
