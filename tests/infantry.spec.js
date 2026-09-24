// Special infantry: Sapper, Striker, Psion, Isotope Trooper, Infiltrator, Blink Trooper.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 16, 16));
});
test.afterEach(() => expectClean(errors));

test('Sapper plants timed charges on buildings and vehicles, not on infantry', async ({ page }) => {
  const r = await page.evaluate(() => {
    const sp = __RH.spawn('sapper', 36, 54, 1);
    const b = __RH.place('barracks', 39, 53, 0);
    const rifle = __RH.spawn('rifle', 36, 58, 0);
    const canInf = __RH.canHurt(sp, rifle);
    rifle.dead = true;                                       // only needed for the check
    sp.order = {type: 'attack', target: b};
    __RH.step(3);
    const armed = __RH.effects.some(e => e.type === 'charge' && e.target === b), before = b.hp;
    __RH.step(3.5);
    const tank = __RH.spawn('ltank', 37, 60, 0);
    tank.order = {type: 'move'};
    sp.x = 36 * 32; sp.y = 60 * 32 + 16; sp.cool = 0;
    sp.order = {type: 'attack', target: tank};
    __RH.step(5);
    return {canInf, armed, before, after: b.dead ? 0 : b.hp, tankHp: tank.dead ? 0 : tank.hp, tankMax: tank.maxHp};
  });
  expect(r.canInf).toBe(false);
  expect(r.armed).toBe(true);
  expect(r.before).toBe(700);                              // nothing until the fuse runs out
  expect(r.after).toBeLessThan(10);
  expect(r.tankHp).toBeLessThan(r.tankMax - 300);
});

test('Striker one-shots infantry, ignores tanks, and demolishes buildings when ordered', async ({ page }) => {
  const r = await page.evaluate(() => {
    const st = __RH.spawn('striker', 35, 55);
    const foes = [0, 1].map(i => __RH.spawn('isotope', 39, 54 + i * 2, 1));
    foes.forEach(f => { f.order = {type: 'move'}; __RH.orderMove(f, 46 * 32, f.y); });   // walking away, not shooting
    const b = __RH.place('power', 37, 59, 1);
    const tank = __RH.spawn('ltank', 34, 60, 1);
    const canTank = __RH.canHurt(st, tank);
    tank.dead = true;
    __RH.step(2.5);
    const shots = foes.filter(f => f.dead).length, autoBuilding = b.hp < b.maxHp;
    st.order = {type: 'attack', target: b};
    __RH.step(6);
    return {shots, autoBuilding, canTank, bDead: b.dead};
  });
  expect(r.shots).toBe(2);
  expect(r.autoBuilding).toBe(false);                      // only blows up what it is told to
  expect(r.canTank).toBe(false);
  expect(r.bDead).toBe(true);
});

test('only one Striker at a time', async ({ page }) => {
  await page.evaluate(() => {
    __RH.place('conyard', 33, 49); __RH.place('barracks', 36, 49); __RH.place('radar', 39, 49);
    __RH.place('power', 42, 49); __RH.place('power', 44, 49);
    __RH.state.credits[0] = 50000;
  });
  await page.click('#tabs .tab[data-tab="infantry"]');
  const cameo = page.locator('#buildGrid .cameo', {hasText: 'Striker'});
  await cameo.click(); await cameo.click();
  const queued = await page.evaluate(() => __RH.prodQ.infantry.filter(s => s.key === 'striker').length);
  expect(queued).toBe(1);
});

test('Psion takes over one unit, and lets it go when it dies', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ps = __RH.spawn('psion', 36, 55, 1);
    const tank = __RH.spawn('ltank', 40, 55, 0);
    const other = __RH.spawn('rifle', 40, 57, 0);
    tank.order = other.order = {type: 'move'};
    ps.order = {type: 'attack', target: tank};
    __RH.step(1);
    const taken = tank.team;
    __RH.step(3);
    const onlyOne = other.team;
    ps.hp = 1;
    __RH.applyDamage(ps, 10, null, null);
    __RH.step(0.1);
    return {taken, onlyOne, back: tank.team};
  });
  expect(r.taken).toBe(1);
  expect(r.onlyOne).toBe(0);
  expect(r.back).toBe(0);
});

test('Isotope shots leave radiation, and a deployed trooper irradiates infantry around it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const iso = __RH.spawn('isotope', 36, 55, 1);
    const victim = __RH.spawn('rifle', 39, 55, 0);
    victim.order = {type: 'move'};
    iso.order = {type: 'attack', target: victim};
    __RH.step(0.3);
    const puddles = __RH.radiation().length;
    iso.dead = true;
    __RH.step(0.1);
    // a deployed trooper, with a rifleman and a tank standing in its field
    const iso2 = __RH.spawn('isotope', 40, 60, 1);
    iso2.deployed = true;
    const inf = __RH.spawn('rocket', 41, 60, 0), tank = __RH.spawn('htank', 39, 61, 0);
    inf.order = tank.order = {type: 'move'};
    iso2.cool = 99;                                          // only the field, no shots
    __RH.step(2);
    return {puddles, infLoss: inf.maxHp - inf.hp, tankLoss: tank.maxHp - tank.hp};
  });
  expect(r.puddles).toBeGreaterThan(0);
  expect(r.infLoss).toBeGreaterThan(40);
  expect(r.tankLoss).toBeGreaterThan(0);
  expect(r.tankLoss).toBeLessThan(r.infLoss);
});

test('Infiltrator is ignored by the enemy, steals credits and blacks out power; hounds see through it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const spy = __RH.spawn('infiltrator', 36, 55);
    const guards = [0, 1].map(i => __RH.spawn('rifle', 38, 54 + i * 2, 1));
    const tower = __RH.place('arctower', 41, 58, 1);
    __RH.step(2);
    const unhurt = spy.hp === spy.maxHp;
    const ref = __RH.place('refinery', 40, 52, 1);
    __RH.state.credits[1] = 4000;
    const mine = __RH.state.credits[0];
    spy.order = {type: 'capture', target: ref};
    __RH.step(4);
    const stolen = __RH.state.credits[0] - mine;
    const spy2 = __RH.spawn('infiltrator', 36, 60);
    const pp = __RH.place('power', 34, 62, 1);
    const prodBefore = __RH.powerOf(1).prod;
    spy2.order = {type: 'capture', target: pp};
    __RH.step(4);
    const prodAfter = __RH.powerOf(1).prod;
    const spy3 = __RH.spawn('infiltrator', 44, 50, 1);
    const dog = __RH.spawn('dog', 44, 53, 0);
    __RH.step(3);
    return {unhurt, stolen, spyUsed: spy.dead, prodBefore, prodAfter, dogFound: spy3.dead};
  });
  expect(r.unhurt).toBe(true);
  expect(r.spyUsed).toBe(true);
  expect(r.stolen).toBeGreaterThan(1500);                  // about half their money (they earn and spend meanwhile)
  expect(r.stolen).toBeLessThanOrEqual(2200);
  expect(r.prodBefore).toBeGreaterThan(0);
  expect(r.prodAfter).toBe(0);
  expect(r.dogFound).toBe(true);
});

test('Blink Trooper jumps across water instead of walking', async ({ page }) => {
  const r = await page.evaluate(() => {
    const bt = __RH.spawn('blink', 35, 55);
    for(let y = 48; y < 64; y++) for(let x = 38; x < 41; x++) __RH.block(x, y);   // a river
    bt.order = {type: 'move'};
    __RH.orderMove(bt, 44 * 32 + 16, 55 * 32 + 16);
    __RH.step(0.3);
    const midway = bt.x;
    __RH.step(2);
    return {startX: 35 * 32 + 16, midway, x: bt.x, y: bt.y};
  });
  expect(r.midway).toBe(r.startX);                         // charging, not walking
  expect(r.x).toBe(44 * 32 + 16);
  expect(r.y).toBe(55 * 32 + 16);
});
