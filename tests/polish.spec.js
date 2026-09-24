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
    return {foeHurt: foe.hp < foe.maxHp, haulerGun: !!__RH.weaponOf(hauler), turned: Math.abs(truck.tface - truck.face) > 0.01 || foe.dead};
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
