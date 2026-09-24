// Naval: the sea, the Dockyard, ships on water, landing craft, subs and AA ships.
// Arena: the west coast, land at tiles 5-15 x 18-35, sea at x < ~4.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(4, 18, 12, 18, true));   // trees gone, the sea stays
});
test.afterEach(() => expectClean(errors));

test('the sea joins both coasts, and ships sail along it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ship = __RH.spawn('frigate', 1, 50);
    ship.order = {type: 'move'};
    __RH.orderMove(ship, 58 * 32 + 16, 1 * 32 + 16);
    const path = ship.path || [];
    return {water: [[1, 50], [2, 30], [1, 1], [58, 1]].every(([x, y]) => __RH.sailable(x, y)),
            land: __RH.sailable(9, 51), steps: path.length, allWater: path.every(p => __RH.sailable(Math.floor(p.x / 32), Math.floor(p.y / 32)))};
  });
  expect(r.water).toBe(true);
  expect(r.land).toBe(false);
  expect(r.steps).toBeGreaterThan(60);
  expect(r.allWater).toBe(true);
});

test('a Dockyard goes only on water, and its ships come out on water and stay there', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.place('conyard', 8, 25);
    __RH.reveal(2, 26, 6);
    const onWater = __RH.canPlace('shipyard', 0, 25, 0), onLand = __RH.canPlace('shipyard', 8, 30, 0);
    __RH.place('shipyard', 0, 25);
    const ship = __RH.deliver('frigate', 0);
    const born = __RH.sailable(Math.floor(ship.x / 32), Math.floor(ship.y / 32));
    ship.order = {type: 'move'};
    __RH.orderMove(ship, 10 * 32, 32 * 32);                   // inland: it goes as close as the water allows
    __RH.step(8);
    return {onWater, onLand, born, stays: __RH.sailable(Math.floor(ship.x / 32), Math.floor(ship.y / 32))};
  });
  expect(r.onWater).toBe(true);
  expect(r.onLand).toBe(false);
  expect(r.born).toBe(true);
  expect(r.stays).toBe(true);
});

test('a landing craft loads a tank and a rifleman at the shore and lands them further up the coast', async ({ page }) => {
  const r = await page.evaluate(() => {
    // find the coast: the first land column on rows 32 and 20
    const coast = y => { let x = 0; while(__RH.sailable(x, y)) x++; return x; };
    const c1 = coast(32), c2 = coast(20);
    const boat = __RH.spawn('lander', c1 - 1, 32);
    const tank = __RH.spawn('ltank', c1 + 3, 31), rifle = __RH.spawn('rifle', c1 + 3, 33);
    tank.order = rifle.order = {type: 'board', target: boat};
    __RH.step(6);
    const loaded = boat.cargo.length;
    // out at sea there is nowhere to land
    boat.x = 0.5 * 32; boat.y = 26.5 * 32;
    const atSea = __RH.unload(boat).length;
    boat.order = {type: 'move'};
    __RH.orderMove(boat, (c2 - 1) * 32 + 16, 20 * 32 + 16);
    __RH.step(8);
    const out = __RH.unload(boat);
    return {c1, loaded, atSea, out: out.length, onLand: out.every(u => __RH.passable(Math.floor(u.x / 32), Math.floor(u.y / 32)))};
  });
  expect(r.loaded).toBe(2);
  expect(r.atSea).toBe(0);
  expect(r.out).toBe(2);
  expect(r.onLand).toBe(true);
});

test('only frigates can hurt a sub; torpedoes only hit ships', async ({ page }) => {
  const r = await page.evaluate(() => {
    const sub = __RH.spawn('sub', 1, 26, 1);
    const fr = __RH.spawn('frigate', 1, 31, 0), pk = __RH.spawn('picket', 2, 34, 0);
    const tank = __RH.spawn('htank', 7, 26, 0), rk = __RH.spawn('rocket', 7, 28, 0);
    const can = {frigate: __RH.canHurt(fr, sub), picket: __RH.canHurt(pk, sub), tank: __RH.canHurt(tank, sub), rocket: __RH.canHurt(rk, sub),
                 subVsFrigate: __RH.canHurt(sub, fr), subVsTank: __RH.canHurt(sub, tank)};
    tank.dead = rk.dead = pk.dead = true;
    __RH.step(25);
    return {can, subDead: sub.dead, frHurt: fr.hp < fr.maxHp};
  });
  expect(r.can).toEqual({frigate: true, picket: false, tank: false, rocket: false, subVsFrigate: true, subVsTank: false});
  expect(r.frHurt).toBe(true);
  expect(r.subDead).toBe(true);
});

test('a Picket Cruiser shoots down aircraft; a Frigate shells the shore', async ({ page }) => {
  const r = await page.evaluate(() => {
    const pk = __RH.spawn('picket', 1, 22, 0);
    const ship = __RH.spawn('airship', 6, 22, 1);
    ship.order = {type: 'move'};
    ship.hp = 400;
    const fr = __RH.spawn('frigate', 1, 32, 0);
    const b = __RH.place('power', 7, 31, 1);
    __RH.step(15);
    return {shipDead: ship.dead, bHurt: b.dead || b.hp < b.maxHp};
  });
  expect(r.shipDead).toBe(true);
  expect(r.bHurt).toBe(true);
});
