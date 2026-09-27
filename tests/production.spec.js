// Production: more Barracks / Factories build faster, and double-clicking one makes it the primary exit.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => { errors = await boot(page); });
test.afterEach(() => expectClean(errors));

test('a second Barracks trains 1.5x as fast, a third 1.8x', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(4, 36, 30, 20);
    __RH.place('conyard', 6, 40); __RH.place('power', 10, 40); __RH.place('power', 10, 43);
    const train = () => {
      __RH.prodQ.infantry.length = 0;
      __RH.prodQ.infantry.push({key: 'rifle', isUnit: true, progress: 0, spent: 0, ready: false, hold: false});
      __RH.step(1);
      return __RH.prodQ.infantry[0].progress;
    };
    __RH.place('barracks', 14, 40);
    const one = train();
    __RH.place('barracks', 18, 40);
    const two = train();
    __RH.place('barracks', 22, 40);
    const three = train();
    return {two: two / one, three: three / one};
  });
  expect(r.two).toBeCloseTo(1.5, 2);
  expect(r.three).toBeCloseTo(1.8, 2);
});

test('double-clicking a Barracks makes new infantry come out of it', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(4, 36, 40, 20);
    __RH.place('conyard', 6, 40); __RH.place('power', 10, 40);
    const a = __RH.place('barracks', 14, 40), b = __RH.place('barracks', 34, 44);
    window.__t = {a, b};
    const first = __RH.deliver('rifle', 0);
    __RH.look(35, 45);
    __RH.step(0.1);
    return {firstNearA: Math.hypot(first.x - a.x, first.y - a.y) < 4 * 32, at: __RH.toScreen(b)};
  });
  expect(r.firstNearA).toBe(true);                                  // by default: the first one built
  await page.mouse.dblclick(r.at.x, r.at.y - 12);
  const s = await page.evaluate(() => {
    const {a, b} = __t;
    const u = __RH.deliver('rifle', 0);
    return {aPrimary: !!a.primary, bPrimary: !!b.primary, nearB: Math.hypot(u.x - b.x, u.y - b.y) < 4 * 32};
  });
  expect(s).toEqual({aPrimary: false, bPrimary: true, nearB: true});
});
