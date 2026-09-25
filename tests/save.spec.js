// Save and load: a loaded game carries on exactly as the saved one would have, in the same page or
// after a reload, with every link between units intact; the slots show in the pause menu and on the title screen.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

// a small defended player base under AI attack, with riders in a transport and a control group
const SCENE = () => {
  __RH.place('conyard', 8, 49);
  for(const [x, y] of [[4, 52], [4, 55], [7, 55]]) __RH.place('power', x, y);
  for(const [x, y] of [[13, 46], [14, 49], [15, 52]]) __RH.place('beamtower', x, y);
  __RH.place('refinery', 12, 55);
  for(let i = 0; i < 4; i++) __RH.spawn('ltank', 16 + i, 46);
  const ifv = __RH.spawn('ifv', 12, 44), rifle = __RH.spawn('rifle', 13, 44);
  rifle.order = {type: 'board', target: ifv};
};
// everything a player could notice, rounded so it prints well when it differs
const SNAP = () => {
  const r = n => Math.round(n * 1000) / 1000;
  return {
    time: r(__RH.state.time), credits: __RH.state.credits.map(r), wave: [r(__RH.ai.waveTimer), __RH.ai.waveSize, __RH.ai.bKey],
    units: __RH.units.filter(u => !u.dead).map(u => [u.id, u.def.key, u.team, r(u.x), r(u.y), r(u.hp), u.order.type, r(u.face)]),
    buildings: __RH.buildings.filter(b => !b.dead).map(b => [b.id, b.def.key, b.team, r(b.hp), r(b.buildUp)]),
    effects: __RH.effects.length,
  };
};

test('a loaded game continues exactly as the saved one did, in the same page and after a reload @slow', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  const r = await page.evaluate(([scene, snap]) => {
    eval(scene)();
    for(let i = 0; i < 180; i++) __RH.step(1);
    const ifv = __RH.units.find(u => u.def.key === 'ifv' && u.team === 0);
    const boarded = !!ifv && ifv.cargo.length === 1;
    if(!__RH.save(2)) return {saved: false};
    for(let i = 0; i < 150; i++) __RH.step(1);
    const a = eval(snap)();
    __RH.load(2); __RH.pause(true);
    // links between objects survive: riders point at their transport, definitions are the shared ones
    const ifv2 = __RH.units.find(u => u.def.key === 'ifv' && u.team === 0);
    const links = !!ifv2 && ifv2.cargo.every(p => p.inside === ifv2) &&
                  __RH.units.every(u => u.def === __RH.UNIT_DEFS[u.def.key]) &&
                  __RH.units.every(u => !u.order.target || u.order.target.dead || __RH.units.includes(u.order.target) || __RH.buildings.includes(u.order.target));
    for(let i = 0; i < 150; i++) __RH.step(1);
    return {saved: true, boarded, links, a, b: eval(snap)()};
  }, [SCENE.toString(), SNAP.toString()]);
  expect(r.saved).toBe(true);
  expect(r.boarded).toBe(true);
  expect(r.links).toBe(true);
  expect(r.a.units.length).toBeGreaterThan(5);
  expect(r.b).toEqual(r.a);

  // a fresh page (same browser storage) loads it from the title screen
  const page2 = await page.context().newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push('pageerror: ' + e.message));
  page2.on('console', m => { if(m.type() === 'error') errors2.push('console: ' + m.text()); });
  await page2.goto('/');
  await page2.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  await page2.click('#loadBtn');
  await expect(page2.locator('#slots .slotRow')).toHaveCount(5);
  await expect(page2.locator('#slots .save').first()).toBeHidden();         // no saving from the title screen
  await page2.evaluate(() => __RH.pause(true));                              // no real time between loading and stepping
  await page2.click('#slots .load[data-slot="2"]');
  await expect(page2.locator('#menu')).toBeHidden();
  const c = await page2.evaluate(snap => {
    const started = __RH.state.started;
    for(let i = 0; i < 150; i++) __RH.step(1);
    return {started, snap: eval(snap)()};
  }, SNAP.toString());
  expect(c.started).toBe(true);
  expect(c.snap).toEqual(r.a);
  expectClean(errors);
  expectClean(errors2);
});

test('the pause menu lists the save slots; saving fills one, loading brings the game back', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => __RH.step(65));
  await page.keyboard.press('Escape');
  await page.click('#mSaves');
  await expect(page.locator('#menu h1')).toHaveText('SAVE / LOAD');
  await expect(page.locator('#slots .slotRow')).toHaveCount(5);
  await expect(page.locator('#mRestart')).toBeHidden();
  await expect(page.locator('#slots .load[data-slot="3"]')).toBeDisabled();
  await page.click('#slots .save[data-slot="3"]');
  await expect(page.locator('#slots .slotRow').nth(2)).toContainText('Allied');
  await expect(page.locator('#slots .slotRow').nth(2)).toContainText('Classic');
  await expect(page.locator('#slots .slotRow').nth(2)).toContainText('1:05');
  await expect(page.locator('#slots .load[data-slot="3"]')).toBeEnabled();
  // play on, spend the money, get a new tank, then load: the money is back and the tank gone, the clock too
  await page.click('#mResume');
  const saved = await page.evaluate(() => { __RH.pause(true); const c = Math.round(__RH.state.credits[0]); __RH.state.credits[0] = 1; __RH.spawn('htank', 20, 40); __RH.step(5); return c; });
  await page.keyboard.press('Escape');
  await page.click('#mSaves');
  await page.click('#slots .load[data-slot="3"]');
  await expect(page.locator('#menu')).toBeHidden();
  const r = await page.evaluate(() => ({time: Math.round(__RH.state.time), credits: Math.round(__RH.state.credits[0]),
                                        htank: __RH.units.some(u => u.def.key === 'htank'), mcv: __RH.units.some(u => u.def.mcv && !u.dead)}));
  expect(r).toEqual({time: 65, credits: saved, htank: false, mcv: true});
  expectClean(errors);
});

test('a Soviet game on a random map saves and loads with its side, map and difficulty', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    localStorage.setItem('rh-setup', JSON.stringify({side: 'soviet', map: 'random', seed: 77}));
    localStorage.setItem('rh-difficulty', 'hard');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  const r = await page.evaluate(() => {
    __RH.start(); __RH.pause(true);
    for(let i = 0; i < 30; i++) __RH.step(1);
    const before = {map: JSON.stringify(__RH.map), fac: [...__RH.faction]};
    __RH.save(1);
    // switch to another skirmish, then load
    __RH.rebuild({side: 'allied', map: 'classic', seed: 5});
    __RH.load(1); __RH.pause(true);
    return {same: JSON.stringify(__RH.map) === before.map, fac: [...__RH.faction], soviet: document.body.classList.contains('soviet'),
            before: before.fac, diff: document.querySelector('#diffRow .on').dataset.diff};
  });
  expect(r.same).toBe(true);
  expect(r.fac).toEqual(r.before);
  expect(r.soviet).toBe(true);
  expect(r.diff).toBe('hard');
  expectClean(errors);
});
