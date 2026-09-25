// Pause menu: Esc / Options pause and open it; Resume, Restart, Quit to title; volume and scroll settings persist.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => {
  errors = await boot(page);
  await page.evaluate(() => __RH.pause(false));             // real time runs, so pausing is visible
});
test.afterEach(() => expectClean(errors));

const simTime = page => page.evaluate(() => __RH.state.time);

test('Esc and the Options button pause the game and open the menu; Resume carries on', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  const t0 = await simTime(page);
  await page.waitForTimeout(600);
  expect(await simTime(page)).toBe(t0);                     // paused
  await page.click('#mResume');
  await expect(page.locator('#menu')).toBeHidden();
  await page.waitForTimeout(600);
  expect(await simTime(page)).toBeGreaterThan(t0 + 0.3);
  await page.click('#helpBtn');
  await expect(page.locator('#menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
});

test('Esc cancels a building placement before it opens the menu', async ({ page }) => {
  await page.evaluate(() => { __RH.state.placing = 'power'; });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => __RH.state.placing)).toBeNull();
  await expect(page.locator('#menu')).toBeHidden();
});

test('volume and scroll speed are remembered after a reload', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.locator('#volSfx').fill('25');
  await page.locator('#volVoice').fill('0');
  await page.locator('#scrollSpd').fill('200');
  expect(await page.evaluate(() => ({...__RH.settings}))).toEqual({sfx: 0.25, voice: 0, scroll: 2});
  await page.reload();
  await page.waitForFunction(() => window.__RH && window.__RH.ready);
  expect(await page.evaluate(() => ({...__RH.settings}))).toEqual({sfx: 0.25, voice: 0, scroll: 2});
});

test('scroll speed sets how fast the arrow keys move the camera', async ({ page }) => {
  const move = async speed => {
    await page.evaluate(s => { __RH.settings.scroll = s; __RH.look(32, 32); }, speed);
    const x0 = await page.evaluate(() => __RH.state.camX);
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(300); await page.keyboard.up('ArrowRight');
    return (await page.evaluate(() => __RH.state.camX)) - x0;
  };
  const slow = await move(0.5), fast = await move(2);
  expect(fast).toBeGreaterThan(slow * 2);
});

test('Restart starts the same skirmish over; Quit goes back to the start screen', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.pause(true);
    __RH.step(20);
    __RH.spawn('htank', 20, 40);
    const before = __RH.units.length;
    __RH.restart();
    __RH.pause(true);
    return {before, after: __RH.units.length, time: __RH.state.time, mcv: __RH.units.some(u => u.team === 0 && u.def.mcv),
            enemy: __RH.buildings.filter(b => b.team === 1).map(b => b.def.key)};
  });
  expect(r.time).toBe(0);
  expect(r.mcv).toBe(true);
  expect(r.after).toBeLessThan(r.before);
  expect(r.enemy).toEqual(['conyard']);
  await page.keyboard.press('Escape');
  await page.click('#mQuit');
  await page.waitForFunction(() => window.__RH && window.__RH.ready);
  await expect(page.locator('#setupBox')).toBeVisible();
  expect(await page.evaluate(() => __RH.state.started)).toBe(false);
});
