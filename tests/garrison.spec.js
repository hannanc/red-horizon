// Garrisoning town buildings, and riflemen digging in behind sandbags.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 16, 16));
});
test.afterEach(() => expectClean(errors));

test('infantry garrison a town building, which takes their side and fires their weapons', async ({ page }) => {
  const r = await page.evaluate(() => {
    const house = __RH.place('civ', 38, 54, 2);
    const squad = [0, 1, 2].map(i => __RH.spawn('rifle', 35, 53 + i));
    squad.forEach(u => u.order = {type: 'board', target: house});
    __RH.step(4);
    const inside = squad.filter(u => u.inside === house).length, team = house.team;
    const foe = __RH.spawn('rifle', 44, 55, 1);               // 5+ tiles from the house
    foe.order = {type: 'move'};
    __RH.step(4);
    return {inside, team, foeHurt: foe.dead || foe.hp < foe.maxHp, onMap: squad.some(u => !u.inside)};
  });
  expect(r.inside).toBe(3);
  expect(r.team).toBe(0);
  expect(r.foeHurt).toBe(true);
  expect(r.onMap).toBe(false);
});

test('only armed foot soldiers get in, five at most, and never into an enemy-held building', async ({ page }) => {
  const r = await page.evaluate(() => {
    const house = __RH.place('civ', 38, 54, 2);
    const U = (k, t = 0) => __RH.spawn(k, 35, 55, t);
    const can = {rifle: __RH.canBoard(U('rifle'), house), dog: __RH.canBoard(U('dog'), house),
                 engineer: __RH.canBoard(U('engineer'), house), tank: __RH.canBoard(U('ltank'), house)};
    const six = [0, 1, 2, 3, 4, 5].map(i => __RH.spawn('rocket', 34 + (i % 3), 53 + Math.floor(i / 3)));
    six.forEach(u => u.order = {type: 'board', target: house});
    __RH.step(6);
    const inside = house.cargo.length;
    const enemy = __RH.spawn('rifle', 36, 58, 1);
    return {can, inside, enemyCan: __RH.canBoard(enemy, house)};
  });
  expect(r.can).toEqual({rifle: true, dog: false, engineer: false, tank: false});
  expect(r.inside).toBe(5);
  expect(r.enemyCan).toBe(false);
});

test('D empties a garrison and the building goes back to the town', async ({ page }) => {
  const r = await page.evaluate(() => {
    const house = __RH.place('civ', 38, 54, 2);
    const u = __RH.spawn('rifle', 36, 55);
    u.order = {type: 'board', target: house};
    __RH.step(3);
    const was = house.team;
    __RH.select([house]);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'd'}));
    window.dispatchEvent(new KeyboardEvent('keyup', {key: 'd'}));
    __RH.step(0.2);
    return {was, team: house.team, out: !u.inside && !u.dead};
  });
  expect(r.was).toBe(0);
  expect(r.team).toBe(2);
  expect(r.out).toBe(true);
});

test('a destroyed garrison lets its survivors out, and town buildings never decide the game', async ({ page }) => {
  const r = await page.evaluate(() => {
    const house = __RH.place('civ', 38, 54, 2);
    const u = __RH.spawn('rifle', 36, 55, 1);
    u.order = {type: 'board', target: house};
    __RH.step(3);
    const held = house.team;
    // the enemy's only building would be this garrison: remove the real base
    for(const b of __RH.buildings) if(b.team === 1 && b !== house) b.dead = true;
    __RH.place('conyard', 33, 49);
    __RH.step(1.5);
    const over = __RH.state.over;
    __RH.state.over = false;
    __RH.place('power', 60, 2, 1);                          // keep the game going for the rest
    house.hp = 1;
    const tank = __RH.spawn('ltank', 42, 55);
    tank.order = {type: 'attack', target: house};
    for(let i = 0; i < 40 && !house.dead; i++) __RH.step(0.1);
    return {held, over, houseDead: house.dead, survivor: !u.dead && !u.inside};
  });
  expect(r.held).toBe(1);
  expect(r.over).toBe(true);                               // victory: the garrison doesn't count as a base
  expect(r.houseDead).toBe(true);
  expect(r.survivor).toBe(true);
});

test('riflemen dig in with D: more range, half damage, and they stay put', async ({ page }) => {
  const r = await page.evaluate(() => {
    const a = __RH.spawn('rifle', 36, 54), b = __RH.spawn('rifle', 36, 58);
    const range = __RH.weaponOf(a).range;
    __RH.select([a]);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'd'}));
    window.dispatchEvent(new KeyboardEvent('keyup', {key: 'd'}));
    const dugRange = __RH.weaponOf(a).range;
    const shooter = __RH.spawn('ltank', 40, 56, 1);
    shooter.order = {type: 'move'};
    __RH.applyDamage(a, 50, null, shooter);
    __RH.applyDamage(b, 50, null, shooter);
    // a far enemy it can't reach: a dug-in rifleman doesn't leave its sandbags
    shooter.dead = true;
    const far = __RH.spawn('rifle', 36 + 9, 54, 1);
    far.order = {type: 'move'};
    a.order = {type: 'attack', target: far};
    __RH.step(2);
    const stayed = Math.abs(a.x - (36 * 32 + 16)) < 4;
    // a move order climbs out again
    a.order = {type: 'move'};
    __RH.orderMove(a, 36 * 32 + 16, 50 * 32 + 16);
    __RH.step(0.2);
    return {range, dugRange, lossA: 125 - a.hp, lossB: 125 - b.hp, stayed, deployedAfterMove: a.deployed};
  });
  expect(r.dugRange).toBeGreaterThan(r.range);
  expect(r.lossA).toBeCloseTo(r.lossB / 2, 5);
  expect(r.stayed).toBe(true);
  expect(r.deployedAfterMove).toBe(false);
});

test('the AI digs in troopers at home and garrisons town buildings near a fight', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.step(4);
    const dug = __RH.units.filter(u => u.team === 1 && u.def.key === 'rifle' && u.deployed).length;
    const house = __RH.place('civ', 38, 54, 2);
    const foe = __RH.spawn('ltank', 44, 54, 0);
    foe.order = {type: 'move'};
    const t = [0, 1, 2].map(i => __RH.spawn('rifle', 35, 53 + i, 1));
    t.forEach(u => { u.role = 'attacker'; u.order = {type: 'attackmove', x: foe.x, y: foe.y}; __RH.orderMove(u, foe.x, foe.y); });
    __RH.step(12);
    return {dug, garrisoned: house.cargo.length, team: house.team};
  });
  expect(r.dug).toBeGreaterThan(0);
  expect(r.garrisoned).toBeGreaterThan(0);
  expect(r.team).toBe(1);
});
