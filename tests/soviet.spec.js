// Playing the Soviet side: the AI takes the Allies, builds its own base and army, and attacks.
const { test, expect } = require('@playwright/test');
const { expectClean } = require('./helpers');

test('as the Soviets, the Allied AI builds its base, trains Allied units and attacks @slow', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => localStorage.setItem('rh-setup', JSON.stringify({side: 'soviet'})));
  await page.goto('/');
  await page.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  const r = await page.evaluate(() => {
    __RH.start(); __RH.pause(true);
    const mcv = __RH.units.find(u => u.team === 0 && u.def.mcv);
    const look = {mcv: mcv.fac, sidebar: document.body.classList.contains('soviet')};
    // a sturdy Soviet base with its own towers
    __RH.place('conyard', 8, 49);
    for(const [x, y] of [[4, 52], [4, 55], [7, 55], [10, 55], [1, 55]]) __RH.place('power', x, y);
    for(const [x, y] of [[13, 46], [14, 49], [11, 45], [15, 52]]) __RH.place('arctower', x, y);
    for(const b of __RH.buildings) if(b.team === 0) b.hp = b.maxHp = 1e7;
    __RH.state.credits[0] = 1e9;
    const built = new Set(), attacked = new Set();
    for(let t = 0; t < 600; t++){
      __RH.step(1);
      for(const u of __RH.units) if(u.team === 1 && !u.dead){ built.add(u.def.key); if(u.role === 'attacker') attacked.add(u.def.key); }
      for(const u of __RH.units) if(u.team === 1 && u.def.engineer) u.dead = true;   // keep the test base ours
    }
    const stuck = __RH.units.filter(u => !u.dead && (u.order.type === 'board' || u.order.type === 'capture') && (!u.order.target || u.order.target.dead))
      .map(u => u.def.key);
    return {look, built: [...built], attacked: [...attacked], stuck,
            base: [...new Set(__RH.buildings.filter(b => b.team === 1).map(b => b.def.key))], over: __RH.state.over};
  });
  expect(r.look).toEqual({mcv: 'soviet', sidebar: true});
  expect(r.over).toBe(false);
  expect(r.base).toEqual(expect.arrayContaining(['conyard', 'power', 'refinery', 'barracks', 'factory', 'radar', 'beamtower']));
  expect(r.base).not.toContain('arctower');
  expect(r.built).toEqual(expect.arrayContaining(['rifle', 'dog', 'ltank', 'ifv', 'sniper', 'beamtank']));
  expect(r.built.filter(k => ['arctrooper', 'drone', 'halftrack', 'launcher', 'airship', 'sub', 'psion'].includes(k))).toEqual([]);
  expect(r.attacked.length).toBeGreaterThan(2);
  expect(r.stuck).toEqual([]);
  expectClean(errors);
});
