// Scenario tests for unit abilities. Each test builds a small fight on cleared
// ground in the south-east of the map (tiles 34-46 x 50-62), far from both bases,
// runs the simulation for a few seconds and checks the outcome.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 16, 16));
});
test.afterEach(() => expectClean(errors));

test('Hound kills infantry but ignores vehicles', async ({ page }) => {
  const r = await page.evaluate(() => {
    const dog = __RH.spawn('dog', 36, 54);
    const foe = __RH.spawn('rifle', 39, 54, 1);
    const tank = __RH.spawn('ltank', 36, 57, 1);
    tank.order = {type: 'move'};
    __RH.step(4);
    return {foeDead: foe.dead, canBiteTank: __RH.canHurt(dog, tank), tankHp: tank.hp, tankMax: tank.maxHp};
  });
  expect(r.foeDead).toBe(true);
  expect(r.canBiteTank).toBe(false);
  expect(r.tankHp).toBe(r.tankMax);
});

test('Marksman one-shots infantry from long range and leaves tanks alone', async ({ page }) => {
  const r = await page.evaluate(() => {
    const sn = __RH.spawn('sniper', 35, 52);
    const foe = __RH.spawn('rifle', 43, 52, 1);          // 8 tiles away
    foe.order = {type: 'move'};
    const tank = __RH.spawn('ltank', 38, 56, 1);
    tank.order = {type: 'move'};
    __RH.step(3);
    return {foeDead: foe.dead, tankHp: tank.hp, tankMax: tank.maxHp, snHp: sn.hp};
  });
  expect(r.foeDead).toBe(true);
  expect(r.tankHp).toBe(r.tankMax);
});

test("Lancer Tank's beam chains to nearby enemies", async ({ page }) => {
  const r = await page.evaluate(() => {
    const lancer = __RH.spawn('beamtank', 35, 55);
    const foes = [[40, 55], [41, 56], [41, 54]].map(([x, y]) => __RH.spawn('rifle', x, y, 1));
    foes.forEach(f => f.order = {type: 'move'});
    lancer.order = {type: 'attack', target: foes[0]};
    __RH.step(3);                                      // time to turn and fire
    return foes.map(f => f.dead || f.hp < f.maxHp);
  });
  expect(r.filter(Boolean).length).toBeGreaterThanOrEqual(2);
});

test('Leech Drone latches inside a vehicle, drains it, and dies with it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const drone = __RH.spawn('drone', 36, 55, 1);
    const tank = __RH.spawn('ltank', 39, 55, 0);
    tank.order = {type: 'move'};                          // don't shoot back
    drone.order = {type: 'attack', target: tank};
    __RH.step(3);
    const latched = drone.latched === tank;
    const hpAfterLatch = tank.hp;
    __RH.step(12);
    return {latched, drained: tank.hp < hpAfterLatch || tank.dead, tankDead: tank.dead, droneDead: drone.dead};
  });
  expect(r.latched).toBe(true);
  expect(r.drained).toBe(true);
  expect(r.tankDead).toBe(true);
  expect(r.droneDead).toBe(true);
});

test('Siege Launcher missile does splash damage and then reloads', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ln = __RH.spawn('launcher', 34, 58, 1);
    const a = __RH.spawn('rifle', 44, 58, 0), b = __RH.spawn('rifle', 44, 59, 0);
    a.order = b.order = {type: 'move'};
    ln.order = {type: 'attack', target: a};
    __RH.step(6);
    return {aHit: a.dead || a.hp < a.maxHp, bHit: b.dead || b.hp < b.maxHp, cool: ln.cool};
  });
  expect(r.aHit).toBe(true);
  expect(r.bHit).toBe(true);                             // splash, not a direct hit
  expect(r.cool).toBeGreaterThan(0);                     // reloading
});

test('Engineer captures an enemy building and repairs a friendly one', async ({ page }) => {
  const r = await page.evaluate(() => {
    const eb = __RH.place('barracks', 40, 52, 1);
    const pb = __RH.place('power', 36, 58, 0);
    pb.hp = 100;
    const e1 = __RH.spawn('engineer', 37, 53), e2 = __RH.spawn('engineer', 34, 60);
    e1.order = {type: 'capture', target: eb};
    e2.order = {type: 'capture', target: pb};
    __RH.step(6);
    return {ebTeam: eb.team, ebLook: eb.fac, pbHp: pb.hp, pbMax: pb.maxHp, used: e1.dead && e2.dead};
  });
  expect(r.ebTeam).toBe(0);
  expect(r.ebLook).toBe('soviet');                       // keeps its original look
  expect(r.pbHp).toBe(r.pbMax);
  expect(r.used).toBe(true);
});

test('IFV takes its passenger\'s weapon; an engineer inside repairs vehicles', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ifv = __RH.spawn('ifv', 36, 54);
    const empty = __RH.weaponOf(ifv).kind;
    const rifle = __RH.spawn('rifle', 34, 54);
    rifle.order = {type: 'board', target: ifv};
    __RH.step(2);
    const withRifle = rifle.inside === ifv ? __RH.weaponOf(ifv).kind : null;

    const ifv2 = __RH.spawn('ifv', 36, 59);
    const eng = __RH.spawn('engineer', 34, 59);
    const tank = __RH.spawn('ltank', 38, 59);
    tank.hp = 100;
    eng.order = {type: 'board', target: ifv2};
    __RH.step(2);
    const before = tank.hp;
    __RH.step(4);
    return {empty, withRifle, engWeapon: __RH.weaponOf(ifv2), repaired: tank.hp - before};
  });
  expect(r.empty).toBe('rocket');
  expect(r.withRifle).toBe('bullet');
  expect(r.engWeapon).toBeNull();
  expect(r.repaired).toBeGreaterThan(40);
});

test('Transports unload with D; passengers die with the transport', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ht = __RH.spawn('halftrack', 38, 55, 1);
    const riders = [0, 1, 2].map(i => __RH.spawn('rifle', 36 + i, 57, 1));
    riders.forEach(u => u.order = {type: 'board', target: ht});
    __RH.step(3);
    const loaded = ht.cargo.length;
    ht.hp = 1;
    const shooter = __RH.spawn('htank', 42, 55, 0);
    shooter.order = {type: 'attack', target: ht};
    __RH.step(4);

    const ifv = __RH.spawn('ifv', 36, 60);
    const p = __RH.spawn('rocket', 34, 60);
    p.order = {type: 'board', target: ifv};
    __RH.step(2);
    const boarded = p.inside === ifv;
    __RH.select([ifv]);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'd'}));
    window.dispatchEvent(new KeyboardEvent('keyup', {key: 'd'}));
    __RH.step(0.2);
    return {loaded, htDead: ht.dead, ridersDead: riders.filter(u => u.dead).length, boarded, out: !p.inside && !p.dead};
  });
  expect(r.loaded).toBe(3);
  expect(r.htDead).toBe(true);
  expect(r.ridersDead).toBe(3);
  expect(r.boarded).toBe(true);
  expect(r.out).toBe(true);
});
