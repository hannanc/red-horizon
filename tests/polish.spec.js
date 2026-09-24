// Polish items: the Soviet ore truck's gun, the Allied hauler's jump home, AI engineers.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 16, 16));
});
test.afterEach(() => expectClean(errors));

test('the Soviet ore truck shoots infantry that comes close; the Allied hauler has no gun', async ({ page }) => {
  const r = await page.evaluate(() => {
    const truck = __RH.spawn('harv', 36, 55, 1);
    const hauler = __RH.spawn('harv', 36, 60, 0);
    const foe = __RH.spawn('rifle', 39, 55, 0);
    foe.order = {type: 'move'};
    foe.cool = 99;                                         // holds its fire
    __RH.step(3);
    // the gun (tface) points at the rifleman, whichever way the truck itself is driving
    const want = Math.atan2(foe.y - truck.y, foe.x - truck.x), off = Math.abs(Math.atan2(Math.sin(truck.tface - want), Math.cos(truck.tface - want)));
    return {foeHurt: foe.hp < foe.maxHp, haulerGun: !!__RH.weaponOf(hauler), turned: off < 0.3 || foe.dead};
  });
  expect(r.foeHurt).toBe(true);
  expect(r.haulerGun).toBe(false);
  expect(r.turned).toBe(true);
});

test('a full Allied hauler jumps straight back to its refinery', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ref = __RH.place('refinery', 34, 50, 0);
    const h = __RH.spawn('harv', 44, 61, 0);
    h.carry = 700; h.hState = 'return'; h.retB = null;
    const credits = __RH.state.credits[0];
    __RH.step(1);
    const waited = Math.floor(h.x / 32) === 44;
    __RH.step(2.5);
    return {waited, near: Math.hypot(h.x - ref.x, h.y - ref.y) < 3 * 32, paid: __RH.state.credits[0] - credits};
  });
  expect(r.waited).toBe(true);                             // charging, not driving
  expect(r.near).toBe(true);
  expect(r.paid).toBe(700);
});

test('AI engineers go after the player\'s buildings', async ({ page }) => {
  const r = await page.evaluate(() => {
    const pp = __RH.place('power', 42, 58, 0);
    const tower = __RH.place('beamtower', 33, 62, 0);      // out of range of the engineer's walk
    const eng = __RH.spawn('engineer', 44, 52, 1);
    __RH.step(2.5);
    const order = eng.order.type, target = eng.order.target && eng.order.target.def.key;
    __RH.step(6);
    return {order, target, captured: pp.team};
  });
  expect(r.order).toBe('capture');
  expect(r.target).toBe('power');                          // not the gun tower
  expect(r.captured).toBe(1);
});

test('the plateau: cliffs block, ramps lead up, nothing is built on top', async ({ page }) => {
  const r = await page.evaluate(() => {
    const P = __RH.plateau;
    const at = (x, y) => ({pass: __RH.passable(x, y), z: __RH.groundZ((x + 0.5) * 32, (y + 0.5) * 32)});
    const top = at(P.x, P.y);
    // walk round the rim: every raised tile that isn't on a ramp is a cliff
    let cliffs = 0, open = 0;
    for(let y = 20; y < 40; y++) for(let x = 35; x < 55; x++){
      const t = at(x, y);
      if(t.z > 0 && t.z < 25.9 && !__RH.onRamp(x + 0.5, y + 0.5)) cliffs++, open += t.pass ? 1 : 0;
    }
    const tank = __RH.spawn('ltank', 34, 29);
    tank.order = {type: 'move'};
    __RH.orderMove(tank, P.x * 32 + 16, P.y * 32 + 16);
    const viaRamp = (tank.path || []).some(p => __RH.onRamp(p.x / 32, p.y / 32) && __RH.groundZ(p.x, p.y) > 2);
    __RH.step(12);
    __RH.place('conyard', 38, 20);
    __RH.reveal(P.x, P.y, 8);
    return {top, cliffs, open, viaRamp, up: __RH.groundZ(tank.x, tank.y), canBuild: __RH.canPlace('power', P.x - 1, P.y - 1, 0)};
  });
  expect(r.top).toEqual({pass: true, z: 26});
  expect(r.cliffs).toBeGreaterThan(8);
  expect(r.open).toBe(0);
  expect(r.viaRamp).toBe(true);
  expect(r.up).toBe(26);
  expect(r.canBuild).toBe(false);
});

test('units on the plateau shoot a tile further at targets below', async ({ page }) => {
  const r = await page.evaluate(() => {
    const P = __RH.plateau;
    const hi = __RH.spawn('rocket', P.x, P.y + 3);             // on top, near the south edge
    const range = __RH.weaponOf(hi).range;
    // a tank below, a little beyond normal range
    const ty = P.y + 3 + range + 0.6;
    const below = __RH.spawn('ltank', P.x, Math.ceil(ty), 1);
    below.x = P.x * 32 + 16; below.y = ty * 32 + 16; below.order = {type: 'move'};
    hi.order = {type: 'attack', target: below};
    __RH.step(4);
    const fromTop = below.hp < below.maxHp;
    // the same distance on flat ground: out of range, so it walks instead of firing
    __RH.clear(32, 48, 16, 16);
    const lo = __RH.spawn('rocket', 36, 50), t2 = __RH.spawn('ltank', 36, 60, 1);
    t2.x = 36 * 32 + 16; t2.y = (50 + range + 0.6) * 32 + 16; t2.order = {type: 'move'};
    lo.order = {type: 'attack', target: t2};
    __RH.step(0.5);
    return {fromTop, onTop: __RH.groundZ(hi.x, hi.y), flatFired: t2.hp < t2.maxHp};
  });
  expect(r.onTop).toBe(26);
  expect(r.fromTop).toBe(true);
  expect(r.flatFired).toBe(false);
});
