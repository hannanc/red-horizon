// Aircraft: the altitude layer, the air armour class, jets and their airfield,
// the airship, the stealth transport helicopter and jetpack troops.
// Same arena as units.spec.js: cleared ground at tiles 32-47 x 48-63.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 16, 16));
});
test.afterEach(() => expectClean(errors));

test('aircraft fly straight over blocked ground at altitude', async ({ page }) => {
  const r = await page.evaluate(() => {
    const wall = __RH.place('factory', 38, 52, 1);           // a building in the way
    const ship = __RH.spawn('airship', 35, 53, 1);
    ship.order = {type: 'move'};
    __RH.orderMove(ship, 43 * 32, 53 * 32);
    const pathLen = ship.path.length;
    __RH.step(2);
    const z = ship.z;
    __RH.step(28);
    return {pathLen, z, x: ship.x / 32, alt: ship.def.alt, wallHp: wall.hp};
  });
  expect(r.pathLen).toBe(1);                                // no A*, one waypoint
  expect(r.z).toBe(r.alt);
  expect(r.x).toBeGreaterThan(42);                         // crossed the building
});

test('only rockets, flak and IFV missiles can hit aircraft', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ship = __RH.spawn('airship', 40, 55, 1);
    ship.order = {type: 'move'};
    const shooters = ['rifle', 'rocket', 'ltank', 'ifv', 'sniper', 'beamtank', 'pillbox'].map((k, i) =>
      k === 'pillbox' ? __RH.place(k, 34 + i, 50) : __RH.spawn(k, 34 + i, 50));
    const soviet = ['halftrack', 'arctrooper', 'launcher', 'drone'].map((k, i) => __RH.spawn(k, 34 + i, 60, 1));
    const jp = __RH.spawn('jetpack', 44, 60);
    const can = {};
    for(const s of shooters) can[s.def.key] = __RH.canHurt(s, ship);
    for(const s of soviet) can[s.def.key] = __RH.canHurt(s, jp);
    return can;
  });
  expect(r).toEqual({rifle: false, rocket: true, ltank: false, ifv: true, sniper: false, beamtank: false, pillbox: false,
                     halftrack: true, arctrooper: false, launcher: false, drone: false});
});

test('rocket soldiers shoot down an airship; it repairs itself when left alone', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ship = __RH.spawn('airship', 40, 55, 1);
    ship.order = {type: 'move'};
    const rk = [0, 1, 2].map(i => __RH.spawn('rocket', 35, 53 + i));
    __RH.step(6);
    const hurt = ship.hp < ship.maxHp;
    rk.forEach(u => u.dead = true);
    __RH.step(1.5);                                        // let the last rockets land
    const hp = ship.hp;
    __RH.step(5);
    return {hurt, healed: ship.hp - hp};
  });
  expect(r.hurt).toBe(true);
  expect(r.healed).toBeGreaterThan(30);
});

test('airship bombs a building below it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const b = __RH.place('power', 42, 55, 0);
    const ship = __RH.spawn('airship', 36, 55, 1);
    ship.order = {type: 'attack', target: b};
    __RH.step(40);
    return {hp: b.hp, max: b.maxHp, dead: b.dead};
  });
  expect(r.dead || r.hp < r.max * 0.6).toBe(true);
});

test('strike jet: built on a pad, one bomb run, flies home and rearms', async ({ page }) => {
  const r = await page.evaluate(() => {
    const af = __RH.place('airfield', 34, 50);
    const jet = __RH.deliver('jet', 0);
    const jet2 = __RH.deliver('jet', 0);
    const third = __RH.deliver('jet', 0);                  // only two pads
    const start = {docked: jet.docked, z: jet.z, onPad: Math.hypot(jet.x - af.x, jet.y - af.y) < 32};
    const target = __RH.place('barracks', 44, 58, 1);
    jet.order = {type: 'attack', target};
    __RH.step(1.5);
    const climbing = jet.z > 20 && !jet.docked;
    __RH.step(5);
    const afterRun = {ammo: jet.ammo, targetHurt: target.hp < target.maxHp, order: jet.order.type};
    // a second attack order without ammo does nothing
    jet.order = {type: 'attack', target};
    __RH.step(8);
    const home = {docked: jet.docked, z: jet.z};
    __RH.step(9);
    return {start, third: third === null, twoPads: jet.pad.i !== jet2.pad.i, climbing, afterRun, home, ammo: jet.ammo};
  });
  expect(r.start).toEqual({docked: true, z: 0, onPad: true});
  expect(r.third).toBe(true);
  expect(r.twoPads).toBe(true);
  expect(r.climbing).toBe(true);
  expect(r.afterRun.ammo).toBe(0);
  expect(r.afterRun.targetHurt).toBe(true);
  expect(r.home.docked).toBe(true);
  expect(r.home.z).toBeLessThan(2);
  expect(r.ammo).toBe(1);                                  // rearmed on the pad
});

test('a jet with its airfield gone circles instead of landing', async ({ page }) => {
  const r = await page.evaluate(() => {
    const af = __RH.place('airfield', 34, 50);
    const jet = __RH.deliver('jet', 0);
    jet.order = {type: 'move'};
    __RH.orderMove(jet, 44 * 32, 58 * 32);
    __RH.step(2);
    af.hp = 1; af.dead = true;
    __RH.step(10);
    return {z: jet.z, docked: !!jet.docked, dead: jet.dead};
  });
  expect(r.dead).toBe(false);
  expect(r.docked).toBe(false);
  expect(r.z).toBeGreaterThan(40);
});

test('helicopter carries five infantry over water, lands and unloads', async ({ page }) => {
  const r = await page.evaluate(() => {
    const heli = __RH.spawn('heli', 36, 55);
    const riders = [0, 1, 2, 3, 4, 5].map(i => __RH.spawn('rifle', 34, 51 + i));
    riders.forEach(u => u.order = {type: 'board', target: heli});
    __RH.step(4);
    const loaded = heli.cargo.length;
    // a strip of blocked ground between here and the drop zone
    for(let y = 48; y < 64; y++) __RH.block(40, y);
    heli.order = {type: 'move'};
    __RH.orderMove(heli, 44 * 32 + 16, 55 * 32 + 16);
    __RH.step(1.5);
    const flying = heli.z;
    __RH.step(6);
    const crossed = heli.x > 43 * 32;
    __RH.select([heli]);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'd'}));
    window.dispatchEvent(new KeyboardEvent('keyup', {key: 'd'}));
    __RH.step(3);
    return {loaded, flying, crossed, z: heli.z, left: heli.cargo.length,
            out: riders.filter(u => !u.inside && u.x > 41 * 32).length};
  });
  expect(r.loaded).toBe(5);
  expect(r.flying).toBeGreaterThan(20);
  expect(r.crossed).toBe(true);
  expect(r.z).toBeLessThan(2);
  expect(r.left).toBe(0);
  expect(r.out).toBe(5);
});

test('stealth helicopter is not targeted until an enemy gets close', async ({ page }) => {
  const r = await page.evaluate(() => {
    const heli = __RH.spawn('heli', 36, 55);
    __RH.block(36, 55);                                    // nowhere to land: it hovers
    heli.z = heli.def.alt;
    const ht = __RH.spawn('halftrack', 41, 55, 1);         // flak, 5.5 tiles, heli 5 tiles away
    __RH.step(3);
    const farHp = heli.hp;
    __RH.orderMove(ht, 37 * 32, 55 * 32);
    ht.order = {type: 'move'};
    __RH.step(5);
    return {farHp, max: heli.maxHp, nearHp: heli.hp};
  });
  expect(r.farHp).toBe(r.max);
  expect(r.nearHp).toBeLessThan(r.max);
});

test('jetpack troops hover over obstacles, shoot infantry and shrug off rifles', async ({ page }) => {
  const r = await page.evaluate(() => {
    const jp = __RH.spawn('jetpack', 35, 55);
    for(let y = 48; y < 64; y++) __RH.block(38, y);
    const foe = __RH.spawn('rifle', 41, 55, 1);
    __RH.step(1);
    jp.order = {type: 'attack', target: foe};
    __RH.step(10);
    return {z: jp.z, foeDead: foe.dead, jpHp: jp.hp, max: jp.maxHp, canBeShot: __RH.canHurt(foe, jp)};
  });
  expect(r.z).toBeGreaterThan(10);
  expect(r.foeDead).toBe(true);
  expect(r.canBeShot).toBe(false);
  expect(r.jpHp).toBe(r.max);
});
