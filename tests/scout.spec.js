// The Scout: unarmed recon infantry that explores on its own, avoids known enemy ground, and can't be selected.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 24, 24));
});
test.afterEach(() => expectClean(errors));

test('heads for unexplored ground on its own, unarmed', async ({ page }) => {
  const r = await page.evaluate(() => {
    const u = __RH.spawn('scout', 40, 55, 0);
    const p0 = {x: u.x, y: u.y};
    __RH.step(5);
    return {moved: Math.hypot(u.x - p0.x, u.y - p0.y), hasTarget: !!u.exploreTarget, weapon: __RH.weaponOf(u)};
  });
  expect(r.moved).toBeGreaterThan(10);
  expect(r.hasTarget).toBe(true);
  expect(r.weapon).toBe(null);
});

test('runs from a nearby enemy instead of fighting, and remembers the spot as dangerous', async ({ page }) => {
  const r = await page.evaluate(() => {
    const u = __RH.spawn('scout', 40, 55, 0);
    const foe = __RH.spawn('rifle', 41, 55, 1);
    __RH.step(1);
    const fled = u.scoutState === 'flee';
    const d0 = Math.hypot(u.x - foe.x, u.y - foe.y);
    __RH.step(2);
    const d1 = Math.hypot(u.x - foe.x, u.y - foe.y);
    return {fled, farther: d1 > d0, alerts: (__RH.state.scoutAlerts || []).length};
  });
  expect(r.fled).toBe(true);
  expect(r.farther).toBe(true);
  expect(r.alerts).toBeGreaterThan(0);
});

test('once the whole map is explored it heads home and parks there', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.reveal(32, 32, 200);   // the whole 64x64 map, from the centre
    const home = __RH.place('conyard', 20, 45, 0);
    const u = __RH.spawn('scout', 40, 55, 0);
    __RH.step(60);
    const parked = u.scoutState === 'home';
    const near = Math.hypot(u.x - home.x, u.y - home.y) < 4 * 32;
    const p0 = {x: u.x, y: u.y};
    __RH.step(3);
    return {parked, near, stayedPut: u.x === p0.x && u.y === p0.y};
  });
  expect(r.parked).toBe(true);
  expect(r.near).toBe(true);
  expect(r.stayedPut).toBe(true);
});

test('cannot be selected by clicking or box-select', async ({ page }) => {
  const pos = await page.evaluate(() => {
    const scout = __RH.spawn('scout', 40, 55, 0);
    const rifle = __RH.spawn('rifle', 41, 55, 0);
    window.__t = {scout, rifle};
    __RH.look(40.5, 55.5);
    __RH.step(0.05);
    return {scout: __RH.toScreen(scout), rifle: __RH.toScreen(rifle)};
  });
  await page.mouse.click(pos.scout.x, pos.scout.y - 8);
  expect(await page.evaluate(() => __RH.selection.length)).toBe(0);
  await page.mouse.click(pos.rifle.x, pos.rifle.y - 8);
  expect(await page.evaluate(() => __RH.selection.includes(__t.rifle))).toBe(true);
  // a drag box over both only picks up the rifle
  await page.mouse.move(pos.scout.x - 40, pos.scout.y - 40);
  await page.mouse.down();
  await page.mouse.move(pos.rifle.x + 40, pos.rifle.y + 40);
  await page.mouse.up();
  const sel = await page.evaluate(() => __RH.selection.map(u => u.def.key));
  expect(sel).toEqual(['rifle']);
});

test('is available to both sides and needs a Radar', async ({ page }) => {
  const r = await page.evaluate(() => ({prereq: __RH.UNIT_DEFS.scout.prereq, side: __RH.UNIT_DEFS.scout.side}));
  expect(r.prereq).toContain('radar');
  expect(r.side).toBeUndefined();
});

test('two scouts from the same spot head off in clearly different directions', async ({ page }) => {
  const r = await page.evaluate(() => {
    const a = __RH.spawn('scout', 44, 60, 0), b = __RH.spawn('scout', 44, 60, 0);
    const p0 = {x: a.x, y: a.y};
    __RH.step(25);
    const dir = u => Math.atan2(u.y - p0.y, u.x - p0.x);
    let gap = Math.abs(dir(a) - dir(b)); if(gap > Math.PI) gap = 2 * Math.PI - gap;
    return {apart: Math.hypot(a.x - b.x, a.y - b.y) / 32, gap: gap * 180 / Math.PI,
            moved: [Math.hypot(a.x - p0.x, a.y - p0.y) / 32, Math.hypot(b.x - p0.x, b.y - p0.y) / 32]};
  });
  expect(r.moved[0]).toBeGreaterThan(3);
  expect(r.moved[1]).toBeGreaterThan(3);
  expect(r.apart, JSON.stringify(r)).toBeGreaterThan(5);      // tiles between them
  expect(r.gap, JSON.stringify(r)).toBeGreaterThan(45);       // degrees between their directions from the start
});

test('a scout\'s route depends on the map seed', async ({ page }) => {
  const r = await page.evaluate(() => {
    const firsts = [];
    for(const seed of [3, 11, 29, 47]){
      __RH.rebuild({map: 'classic', seed});
      __RH.start(); __RH.pause(true);
      __RH.clear(32, 48, 24, 24);
      const u = __RH.spawn('scout', 44, 60, 0);
      __RH.step(6);
      firsts.push(u.exploreTarget && (u.exploreTarget.x + ',' + u.exploreTarget.y));
    }
    return firsts;
  });
  expect(new Set(r).size, JSON.stringify(r)).toBeGreaterThan(1);   // not the same spot every game
});
