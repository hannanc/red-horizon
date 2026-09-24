// Every map (the handmade layouts and a spread of random seeds) joins the two bases by land,
// lets both sides reach every ore field, and leaves every factory door a way out to the enemy.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

const MAPS = [['classic', 1], ['twinlakes', 1], ['highland', 1]];
for(let s = 1; s <= 12; s++) MAPS.push(['random', s * 7919]);

// rebuild the world for a map, then check the paths on it (runs in the page)
const CHECK = ([map, seed]) => {
  __RH.rebuild({map, seed});
  __RH.start(); __RH.pause(true);
  const m = __RH.map, a = m.bases[0], b = m.bases[1];
  const hub = {x: b.x + 1, y: b.y + 3};                                  // the enemy hub's door
  const bad = [];
  if(!__RH.pathOK(a.x, a.y, hub.x, hub.y)) bad.push('bases');
  const near = (x, y) => {
    for(let r = 0; r < 6; r++) for(let dy = -r; dy <= r; dy++) for(let dx = -r; dx <= r; dx++)
      if(__RH.passable(x + dx, y + dy)) return {x: x + dx, y: y + dy};
    return null;
  };
  m.ore.forEach(([x, y], i) => {
    const t = near(x, y);
    if(!t || !__RH.pathOK(a.x, a.y, t.x, t.y) || !__RH.pathOK(hub.x, hub.y, t.x, t.y)) bad.push('ore ' + i);
  });
  // the player unpacks where the hub lands and builds a war factory at the first free spot around it
  const mcv = __RH.units.find(u => u.team === 0 && u.def.mcv);
  const c = {x: Math.floor(mcv.x / 32) - 1, y: Math.floor(mcv.y / 32) - 1};
  mcv.dead = true;
  __RH.place('conyard', c.x, c.y);
  let fac = null;
  for(let r = 4; r < 10 && !fac; r++) for(let dy = -r; dy <= r && !fac; dy++) for(let dx = -r; dx <= r && !fac; dx++)
    if(Math.max(Math.abs(dx), Math.abs(dy)) === r && __RH.canPlace('factory', c.x + dx, c.y + dy, 0)) fac = __RH.place('factory', c.x + dx, c.y + dy);
  if(!fac) bad.push('no factory spot');
  else {
    const x = fac.tx + Math.floor(fac.w / 2), y = fac.ty + fac.h;
    if(!__RH.passable(x, y) || !__RH.pathOK(x, y, hub.x, hub.y)) bad.push('factory door');
  }
  return {map, seed, bad};
};

test('every map joins the bases, reaches every ore field and lets a new factory out', async ({ page }) => {
  const errors = await boot(page);
  for(const ms of MAPS){
    const r = await page.evaluate(CHECK, ms);
    expect(r.bad, JSON.stringify(r)).toEqual([]);
  }
  expectClean(errors);
});

test('random maps put the bases in opposite corners with matching ore fields', async ({ page }) => {
  const errors = await boot(page);
  const r = await page.evaluate(() => {
    const out = [];
    for(let s = 1; s <= 20; s++){
      __RH.rebuild({map: 'random', seed: s});
      const m = __RH.map, [a, b] = m.bases;
      // each base's own field: same size, same distance; every other field has a mirror twin (bar the middle one)
      const own = p => m.ore.map(o => ({d: Math.round(Math.hypot(o[0] - p.x - 1, o[1] - p.y - 1) * 10) / 10, amt: o[3]})).sort((u, v) => u.d - v.d)[0];
      const unpaired = m.ore.filter(o => !(o[0] === 32 && o[1] === 32) &&
        !m.ore.some(q => q !== o && q[0] === 63 - o[0] && q[1] === 63 - o[1] && q[3] === o[3])).length;
      out.push({s, dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), oa: own(a), ob: own(b), fields: m.ore.length,
                unpaired, town: !!m.town, lakes: m.lakes.length});
    }
    // and a seed always makes the same map
    __RH.rebuild({map: 'random', seed: 42}); const one = JSON.stringify(__RH.map);
    __RH.rebuild({map: 'random', seed: 43});
    __RH.rebuild({map: 'random', seed: 42}); const two = JSON.stringify(__RH.map);
    return {out, same: one === two};
  });
  expect(r.same).toBe(true);
  for(const m of r.out){
    const why = JSON.stringify(m);
    expect(m.dx, why).toBeGreaterThan(30);
    expect(m.dy, why).toBeGreaterThan(30);
    expect(m.oa, why).toEqual(m.ob);
    expect(m.oa.d, why).toBeLessThan(10);
    expect(m.fields, why).toBeGreaterThanOrEqual(3);
  }
  // the base fields sit right by each base, so only flank pairs can be unmatched, and they never are
  expect(r.out.filter(m => m.unpaired > 2)).toEqual([]);
  expect(r.out.some(m => m.town)).toBe(true);
  expect(r.out.some(m => m.lakes > 0)).toBe(true);
  expectClean(errors);
});

// the AI builds a full base on each handmade map and a few random ones; every door it builds must reach the player
for(const ms of [...MAPS.slice(0, 3), ['random', 7919], ['random', 3 * 7919], ['random', 5 * 7919]]){
  test(`the AI's factory, barracks and refinery doors reach the player on ${ms.join(' ')} @slow`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await boot(page);
    const r = await page.evaluate(([map, seed]) => {
      __RH.rebuild({map, seed});
      __RH.start(); __RH.pause(true);
      const mcv = __RH.units.find(u => u.team === 0 && u.def.mcv);
      mcv.dead = true;
      const hub = __RH.place('conyard', Math.floor(mcv.x / 32) - 1, Math.floor(mcv.y / 32) - 1);
      hub.hp = hub.maxHp = 1e7;
      for(let t = 0; t < 300; t++){
        __RH.step(1);
        for(const u of __RH.units) if(u.team === 1 && u.def.engineer) u.dead = true;
      }
      const doors = __RH.buildings.filter(b => b.team === 1 && !b.dead && ['factory', 'barracks', 'refinery'].includes(b.def.key)).map(b => {
        const x = b.tx + Math.floor(b.w / 2), y = b.ty + b.h;
        return {key: b.def.key, x, y, open: __RH.passable(x, y) && __RH.pathOK(x, y, hub.tx + 1, hub.ty + 3)};
      });
      return {doors, over: __RH.state.over};
    }, ms);
    expect(r.over).toBe(false);
    expect(r.doors.map(d => d.key)).toEqual(expect.arrayContaining(['factory', 'barracks', 'refinery']));
    expect(r.doors.filter(d => !d.open), JSON.stringify(r.doors)).toEqual([]);
    expectClean(errors);
  });
}
