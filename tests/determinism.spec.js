// The simulation is deterministic: the same map seed replays exactly the same game.
const { test, expect } = require('@playwright/test');
const { expectClean } = require('./helpers');

// load a fresh page with a given seed, let the AI play against a small defended base, snapshot the world
async function playOut(browser, seed){
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(s => localStorage.setItem('rh-setup', JSON.stringify({seed: s})), seed);
  await page.goto('/');
  await page.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  const snap = await page.evaluate(() => {
    __RH.start(); __RH.pause(true);
    __RH.place('conyard', 8, 49);
    for(const [x, y] of [[4, 52], [4, 55], [7, 55]]) __RH.place('power', x, y);
    for(const [x, y] of [[13, 46], [14, 49], [15, 52]]) __RH.place('beamtower', x, y);
    for(let i = 0; i < 4; i++) __RH.spawn('ltank', 16 + i, 46);
    for(let i = 0; i < 240; i++) __RH.step(1);
    const r = n => Math.round(n * 1000) / 1000;
    return {
      time: r(__RH.state.time), credits: __RH.state.credits.map(r),
      units: __RH.units.filter(u => !u.dead).map(u => [u.id, u.def.key, u.team, r(u.x), r(u.y), r(u.hp), u.order.type]),
      buildings: __RH.buildings.filter(b => !b.dead).map(b => [b.id, b.def.key, b.team, r(b.hp)]),
    };
  });
  expectClean(errors);
  await page.close();
  return snap;
}

test('two runs with the same seed end in exactly the same state; another seed differs @slow', async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await playOut(browser, 12345), b = await playOut(browser, 12345), c = await playOut(browser, 999);
  expect(a.units.length).toBeGreaterThan(5);
  expect(b).toEqual(a);
  expect(c).not.toEqual(a);
});
