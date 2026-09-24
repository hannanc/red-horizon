// Service Depot: vehicles parked on it are repaired for credits, latched drones are
// pulled out, and its tiles can be driven over but not built on.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 16, 16));
});
test.afterEach(() => expectClean(errors));

test('a vehicle parked on the depot is repaired for credits; one beside it is not', async ({ page }) => {
  const r = await page.evaluate(() => {
    const depot = __RH.place('depot', 38, 53);
    __RH.place('power', 44, 58);                              // full speed needs power
    const on = __RH.spawn('ltank', 35, 54), off = __RH.spawn('ltank', 35, 58);
    on.hp = off.hp = 100;
    on.order = {type: 'move'};
    __RH.orderMove(on, 39.5 * 32, 54.5 * 32);                // centre tile of the depot
    __RH.step(4);
    const credits = __RH.state.credits[0], hp = on.hp;
    __RH.step(6);
    return {healed: on.hp - hp, full: on.hp === on.maxHp, spent: credits - __RH.state.credits[0], offHp: off.hp, onDepot: Math.floor(on.x / 32) === 39};
  });
  expect(r.onDepot).toBe(true);
  expect(r.healed).toBeGreaterThan(100);
  expect(r.full).toBe(true);
  expect(r.spent).toBeGreaterThan(50);
  expect(r.offHp).toBe(100);
});

test('units drive across a depot but nothing can be built on it', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.place('conyard', 33, 49);                            // so the player may build here
    const depot = __RH.place('depot', 38, 53);
    const rifle = __RH.spawn('rifle', 36, 54);
    rifle.order = {type: 'move'};
    __RH.orderMove(rifle, 42.5 * 32, 54.5 * 32);
    const straight = rifle.path.length <= 7;                 // through, not around
    __RH.step(6);
    return {straight, across: rifle.x > 42 * 32, canBuild: __RH.canPlace('power', 38, 53, 0)};
  });
  expect(r.straight).toBe(true);
  expect(r.across).toBe(true);
  expect(r.canBuild).toBe(false);
});

test('a drone latched inside a vehicle is destroyed when the vehicle parks on a depot', async ({ page }) => {
  const r = await page.evaluate(() => {
    const depot = __RH.place('depot', 40, 53);
    const tank = __RH.spawn('htank', 36, 54);
    const drone = __RH.spawn('drone', 34, 54, 1);
    tank.order = {type: 'move'};                             // busy driving, so it doesn't shoot the drone
    __RH.orderMove(tank, 36.5 * 32, 60.5 * 32);
    drone.order = {type: 'attack', target: tank};
    __RH.step(3);
    const latched = drone.latched === tank;
    tank.order = {type: 'move'};
    __RH.orderMove(tank, 41.5 * 32, 54.5 * 32);
    __RH.step(6);
    return {latched, droneDead: drone.dead, tankDead: tank.dead};
  });
  expect(r.latched).toBe(true);
  expect(r.droneDead).toBe(true);
  expect(r.tankDead).toBe(false);
});

test('right-clicking a depot with a tank selected parks it there', async ({ page }) => {
  const pos = await page.evaluate(() => {
    const depot = __RH.place('depot', 39, 53);
    const tank = __RH.spawn('ltank', 35, 54);
    tank.hp = 150;
    window.__t = {depot, tank};
    __RH.look(38, 55);
    __RH.step(0.05);
    __RH.select([tank]);
    return __RH.toScreen(depot);
  });
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down({button: 'right'}); await page.mouse.up({button: 'right'});
  const r = await page.evaluate(() => { __RH.step(8); const {depot, tank} = __t;
    return {onDepot: tank.x >= depot.tx * 32 && tank.x < (depot.tx + 3) * 32 && tank.y >= depot.ty * 32 && tank.y < (depot.ty + 3) * 32, hp: tank.hp}; });
  expect(r.onDepot).toBe(true);
  expect(r.hp).toBeGreaterThan(150);
});

test('the AI sends damaged vehicles at home to its depot', async ({ page }) => {
  const r = await page.evaluate(() => {
    const depot = __RH.place('depot', 57, 15, 1);                // the AI builds one early; here it's given one
    const tank = __RH.units.find(u => u.team === 1 && u.def.key === 'ltank');
    tank.hp = 90;
    __RH.step(15);
    return {hasDepot: !!depot, hp: tank.hp, max: tank.maxHp};
  });
  expect(r.hasDepot).toBe(true);
  expect(r.hp).toBeGreaterThan(150);
});
