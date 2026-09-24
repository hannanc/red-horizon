// Skirmish setup screen: side, starting credits and map seed.
const { test, expect } = require('@playwright/test');
const { expectClean } = require('./helpers');

async function load(page, setup){
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  if(setup) await page.addInitScript(s => localStorage.setItem('rh-setup', s), JSON.stringify(setup));
  await page.goto('/');
  await page.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  return errors;
}

test('playing the Soviet side with 12,000 credits', async ({ page }) => {
  const errors = await load(page);
  await page.click('[data-side="soviet"]');
  await page.click('[data-credits="12000"]');
  await page.click('#startBtn');
  await page.evaluate(() => __RH.pause(true));
  expect(await page.isVisible('#setupBox')).toBe(false);
  await page.click('#tabs .tab[data-tab="infantry"]');
  const infantry = await page.locator('#buildGrid .cameo .nm').allTextContents();
  expect(infantry).toEqual(expect.arrayContaining(['Trooper', 'Arc Trooper', 'Sapper']));
  expect(infantry).not.toContain('Hound');
  const r = await page.evaluate(() => {
    const credits = __RH.state.credits[0];
    const seen = new Set();
    for(let i = 0; i < 200; i++){ __RH.step(1); for(const u of __RH.units) if(u.team === 1) seen.add(u.def.key); }
    const towers = [...new Set(__RH.buildings.filter(b => b.team === 1 && b.def.weapon).map(b => b.def.key))];
    const built = [...seen];
    return {faction: __RH.faction.slice(0, 2), towers, credits, built};
  });
  expect(r.faction).toEqual(['soviet', 'allied']);
  expect(r.credits).toBe(12000);
  expect(r.towers).toEqual(['beamtower']);                 // the Allied AI builds its own side's defences
  expect(r.built).toEqual(expect.arrayContaining(['dog']));
  expect(r.built).not.toContain('arctrooper');
  expectClean(errors);
});

test('the same map seed gives the same map; another seed gives another', async ({ browser }) => {
  const world = async setup => {
    const page = await browser.newPage();
    const errors = await load(page, setup);
    const w = await page.evaluate(() => __RH.world());
    expectClean(errors);
    await page.close();
    return w;
  };
  const a = await world({seed: 4242}), b = await world({seed: 4242}), c = await world({seed: 77}), classic = await world(null);
  expect(a).toEqual(b);
  expect(a.water).not.toEqual(c.water);
  expect(a.trees).not.toEqual(c.trees);
  expect(classic.water).not.toEqual(a.water);
});

test('changing the seed on the start screen rebuilds the map when the game starts', async ({ page }) => {
  const errors = await load(page);
  const before = await page.evaluate(() => __RH.world().water);
  await page.fill('#seedIn', '321');
  await page.dispatchEvent('#seedIn', 'change');
  await page.click('#startBtn');
  const r = await page.evaluate(() => { __RH.pause(true); return {water: __RH.world().water, units: __RH.units.length}; });
  expect(r.water).not.toEqual(before);
  expect(r.units).toBeGreaterThan(5);                      // both sides set up again
  expectClean(errors);
});
