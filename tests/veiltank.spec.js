// Veil Tank: passes for a tree while parked and isn't picked as a target until it fires.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.clear(32, 48, 16, 16));
});
test.afterEach(() => expectClean(errors));

test('enemies ignore a Veil Tank until it fires, then shoot back', async ({ page }) => {
  const r = await page.evaluate(() => {
    const vt = __RH.spawn('veiltank', 36, 55);
    vt.order = {type: 'move'};                               // parked, holding fire
    vt.cool = 99;
    const foe = __RH.spawn('ltank', 40, 55, 1);
    __RH.step(3);
    const ignored = vt.hp === vt.maxHp && foe.order.type === 'idle', tree = __RH.treeDisguised(vt);
    vt.cool = 0;
    vt.order = {type: 'attack', target: foe};
    __RH.step(3);
    return {ignored, tree, fired: foe.hp < foe.maxHp, shotBack: vt.hp < vt.maxHp, treeAfter: __RH.treeDisguised(vt)};
  });
  expect(r.ignored).toBe(true);
  expect(r.tree).toBe(true);
  expect(r.fired).toBe(true);
  expect(r.shotBack).toBe(true);
  expect(r.treeAfter).toBe(false);
});

test('a moving Veil Tank is not drawn as a tree but still is not auto-targeted', async ({ page }) => {
  const r = await page.evaluate(() => {
    const vt = __RH.spawn('veiltank', 35, 52);
    vt.order = {type: 'move'};
    __RH.orderMove(vt, 35 * 32 + 16, 60 * 32 + 16);
    const foe = __RH.spawn('rocket', 39, 56, 1);
    __RH.step(1.5);
    return {tree: __RH.treeDisguised(vt), moving: vt.moving, hp: vt.hp, max: vt.maxHp};
  });
  expect(r.moving).toBe(true);
  expect(r.tree).toBe(false);
  expect(r.hp).toBe(r.max);
});
