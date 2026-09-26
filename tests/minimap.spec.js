// Clicking the minimap moves the view there, with or without the advisor panel showing over it.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

test('clicking the minimap moves the camera there, even while the advisor is talking', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { __RH.place('conyard', 8, 49); __RH.place('power', 12, 49); __RH.place('radar', 14, 52); __RH.pause(false); });
  await page.waitForTimeout(2500);                                 // radar boots up
  const box = await page.locator('#minimap').boundingBox();
  const cam = () => page.evaluate(() => [Math.round(__RH.state.camX), Math.round(__RH.state.camY)]);
  const c0 = await cam();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
  const c1 = await cam();
  expect(c1).not.toEqual(c0);
  await page.evaluate(() => __RH.showAdvisor('Enemy forces are massing.'));
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.7);
  const c2 = await cam();
  expect(c2).not.toEqual(c1);
  expectClean(errors);
});
