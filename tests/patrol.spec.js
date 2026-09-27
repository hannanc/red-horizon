// Patrol (P): units walk a loop round their base, attack threats they spot, then go back to the round.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => { errors = await boot(page); });
test.afterEach(() => expectClean(errors));

test('P sends the selected units round the base', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(28, 28, 24, 24);
    const hub = __RH.place('conyard', 38, 38);
    const t = __RH.spawn('ltank', 36, 42), eng = __RH.spawn('engineer', 37, 42);
    __RH.select([t, eng]);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'p'}));
    const pts = t.order.pts;
    const seen = new Set([t.order.i]);
    for(let s = 0; s < 60; s++){ __RH.step(1); if(t.order.type === 'patrol') seen.add(t.order.i); }
    // every point is round the hub, outside its footprint
    const outside = pts.every(p => p.tx < 38 || p.tx >= 41 || p.ty < 38 || p.ty >= 41);
    return {type: t.order.type, n: pts.length, visited: seen.size, outside, eng: eng.order.type};
  });
  expect(r.n).toBe(8);
  expect(r.outside).toBe(true);
  expect(r.type).toBe('patrol');
  expect(r.visited).toBeGreaterThanOrEqual(4);   // keeps going round
  expect(r.eng).not.toBe('patrol');              // engineers aren't patrollers
});

test('a patroller attacks a threat it spots, then goes back to its round', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(28, 28, 24, 24);
    __RH.place('conyard', 38, 38);
    const t = __RH.spawn('ltank', 43, 39);
    __RH.patrol([t]);
    const foe = __RH.spawn('rifle', 48, 40, 1);
    let attacked = false;
    for(let s = 0; s < 40 && !foe.dead; s++){ __RH.step(0.5); if(t.order.type === 'attack' && t.order.target === foe) attacked = true; }
    __RH.step(1);
    return {attacked, dead: foe.dead, type: t.order.type};
  });
  expect(r.attacked).toBe(true);
  expect(r.dead).toBe(true);
  expect(r.type).toBe('patrol');
});

test('a patroller gives up a chase that drags it away from the base', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(20, 28, 40, 24);
    __RH.place('conyard', 30, 38);
    const t = __RH.spawn('ltank', 35, 39);
    __RH.patrol([t]);
    const foe = __RH.spawn('dog', 40, 39, 1);
    foe.hp = foe.maxHp = 1e6;                       // can't be killed: the tank must give up
    let chased = false;
    for(let s = 0; s < 80; s++){
      __RH.step(0.25);
      if(t.order.type === 'attack') chased = true;
      foe.order = {type: 'idle'}; foe.x = Math.min(foe.x + 6, 58 * 32); foe.path = null;   // runs east
    }
    return {chased, type: t.order.type, far: t.x / 32};
  });
  expect(r.chased).toBe(true);
  expect(r.type).toBe('patrol');
  expect(r.far).toBeLessThan(30 + 3 + 3 + 8 + 2);   // right edge of the round plus the leash
});

test('a patrol survives save and load', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(28, 28, 24, 24);
    __RH.place('conyard', 38, 38);
    const t = __RH.spawn('ltank', 36, 42);
    t.hp = 319;                                      // a mark to find it again
    __RH.patrol([t]);
    __RH.step(3);
    const i = t.order.i;
    __RH.save(2);
    __RH.load(2);
    __RH.pause(true);
    const u = __RH.units.find(v => v.hp === 319 && v.def.key === 'ltank');
    return {type: u.order.type, i: u.order.i, n: u.order.pts.length, was: i};
  });
  expect(r.type).toBe('patrol');
  expect(r.i).toBe(r.was);
  expect(r.n).toBe(8);
});

test('the AI keeps a few defenders patrolling its base and pulls damaged ones off', async ({ page }) => {
  const r = await page.evaluate(() => {
    const hub = __RH.buildings.find(b => b.team === 1 && b.def.key === 'conyard');
    for(let k = 0; k < 6; k++) __RH.spawn('ltank', hub.tx + 1 + (k % 3), hub.ty + 4 + Math.floor(k / 3), 1);
    __RH.step(5);
    const mine = () => __RH.units.filter(u => !u.dead && u.team === 1 && (u.order.type === 'patrol' || u.order.patrol));
    const first = mine();
    const far = first.every(u => u.order.type !== 'patrol' ||
      u.order.pts.every(p => Math.hypot(p.x - hub.x, p.y - hub.y) < 30 * 32));
    const hurt = first[0];
    hurt.hp = hurt.maxHp * 0.3;
    __RH.step(2.5);
    return {n: first.length, far, hurtOff: hurt.order.type !== 'patrol' && !hurt.order.patrol, after: mine().length};
  });
  expect(r.n).toBe(2);                 // Normal: two patrollers
  expect(r.far).toBe(true);            // the round stays by its base
  expect(r.hurtOff).toBe(true);        // damaged: off to be repaired
  expect(r.after).toBe(2);             // and someone else takes its place
});

test('P on a Barracks sends its new units on patrol; P again turns it off', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(28, 28, 24, 24);
    __RH.place('conyard', 38, 38);
    const bar = __RH.place('barracks', 42, 38);
    __RH.select([bar]);
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'p'}));
    press();
    const rally = JSON.stringify(bar.rally);
    const rifle = __RH.deliver('rifle', 0), eng = __RH.deliver('engineer', 0);
    __RH.step(1);
    press();
    const off = bar.rally;
    const rifle2 = __RH.deliver('rifle', 0);
    __RH.step(0.1);
    return {rally, rifle: rifle.order.type, eng: eng.order.type, off, rifle2: rifle2.order.type};
  });
  expect(r.rally).toBe('{"patrol":true}');
  expect(r.rifle).toBe('patrol');
  expect(r.eng).not.toBe('patrol');    // engineers just roll out as usual
  expect(r.off).toBeNull();
  expect(r.rifle2).not.toBe('patrol');
});
