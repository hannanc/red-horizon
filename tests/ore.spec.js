// Ore that comes back: fields regrow and creep outwards, and new deposits appear now and then, fair to both sides.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => { errors = await boot(page); });
test.afterEach(() => expectClean(errors));

const I = (x, y) => y * 64 + x;

test('ore fields thicken back up to a cap and creep onto free ground next to them', async ({ page }) => {
  const r = await page.evaluate(I => {
    I = eval(I);
    __RH.clear(24, 24, 16, 16);
    __RH.state.oreNewT = 1e9;                              // no new deposits in this test
    for(let y = 24; y < 40; y++) for(let x = 24; x < 40; x++) __RH.ore[I(x, y)] = 0;
    for(let y = 30; y < 34; y++) for(let x = 30; x < 34; x++) __RH.ore[I(x, y)] = 300;
    __RH.ore[I(31, 31)] = 100;                           // a half-mined tile
    const count = () => { let n = 0; for(let y = 24; y < 40; y++) for(let x = 24; x < 40; x++) if(__RH.ore[I(x, y)] > 0) n++; return n; };
    const before = count();
    __RH.step(60);
    const mid = __RH.ore[I(31, 31)];
    __RH.step(900);
    let top = 0; for(let y = 24; y < 40; y++) for(let x = 24; x < 40; x++) top = Math.max(top, __RH.ore[I(x, y)]);
    return {before, after: count(), mid, top};
  }, I.toString());
  expect(r.mid).toBeGreaterThan(100);          // regrowing
  expect(r.top).toBeLessThanOrEqual(500);      // but only up to the cap
  expect(r.after).toBeGreaterThan(r.before);   // and spreading
});

test('now and then a new ore deposit appears, as far from one start as the other', async ({ page }) => {
  const r = await page.evaluate(() => {
    const tiles = () => { const s = new Set(); for(let i = 0; i < 64 * 64; i++) if(__RH.ore[i] > 0) s.add(i); return s; };
    const was = tiles();
    __RH.state.oreNewT = 0.05;
    __RH.step(0.2);
    const fresh = [...tiles()].filter(i => !was.has(i)).map(i => ({x: i % 64, y: Math.floor(i / 64)}));
    const cx = fresh.reduce((s, p) => s + p.x, 0) / fresh.length, cy = fresh.reduce((s, p) => s + p.y, 0) / fresh.length;
    const [a, b] = __RH.map.bases, da = Math.hypot(cx - a.x, cy - a.y), db = Math.hypot(cx - b.x, cy - b.y);
    const said = [...document.querySelectorAll('.announceMsg')].some(e => /ore deposit/i.test(e.textContent));
    return {n: fresh.length, fair: Math.abs(da - db) / Math.max(da, db), near: Math.min(da, db), said, next: __RH.state.oreNewT};
  });
  expect(r.n).toBeGreaterThan(5);
  expect(r.fair).toBeLessThan(0.3);
  expect(r.near).toBeGreaterThan(10);
  expect(r.said).toBe(true);
  expect(r.next).toBeGreaterThan(100);          // and the next one is a few minutes off
});
