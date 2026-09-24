// Whole-game smoke test: let the AI play for several simulated minutes against a
// player base that holds out, and check that nothing breaks or gets stuck.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

test('AI builds, attacks with every unit type and never gets stuck @slow', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  const r = await page.evaluate(() => {
    // a sturdy player base so the game runs the full length
    __RH.place('conyard', 8, 49);
    for(const [x, y] of [[4, 52], [4, 55], [7, 55], [10, 55]]) __RH.place('power', x, y);     // towers need power
    for(const [x, y] of [[13, 46], [14, 49], [11, 45], [15, 52], [12, 43], [16, 47]]) __RH.place('beamtower', x, y);
    __RH.state.credits[0] = 1e9;
    // Balance isn't what this test checks (the current AI flattens an idle base in
    // about five minutes), so make the player's buildings effectively indestructible.
    for(const b of __RH.buildings) if(b.team === 0) b.hp = b.maxHp = 1e7;
    const built = new Set(), leftBase = new Set();
    let maxCargo = 0, stuck = [];
    for(let t = 0; t < 420; t++){
      __RH.step(1);
      for(const u of __RH.units){
        if(u.team !== 1 || u.dead) continue;
        built.add(u.def.key);
        if(u.def.armor === 'heavy' && !u.def.harvester && u.x < 40 * 32) leftBase.add(u.id);
        if(u.cargo) maxCargo = Math.max(maxCargo, u.cargo.length);
      }
      if(__RH.state.over) break;
    }
    // anything still trying to board or capture a target that is long gone?
    for(const u of __RH.units)
      if(!u.dead && (u.order.type === 'board' || u.order.type === 'capture') && (!u.order.target || u.order.target.dead))
        stuck.push(u.def.key + ':' + u.order.type);
    const endText = document.getElementById('endTitle').textContent;
    const mine = __RH.buildings.filter(b => b.team === 0 && !b.dead).map(b => b.def.key);
    return {endText, mine, time: __RH.state.time, over: __RH.state.over, built: [...built], leftBase: leftBase.size, maxCargo, stuck};
  });
  expect(r.over, JSON.stringify({t: r.time, end: r.over && r.endText, mine: r.mine})).toBe(false);   // ran the full length
  expect(r.built).toEqual(expect.arrayContaining(['rifle', 'arctrooper', 'ltank', 'drone', 'halftrack', 'launcher']));
  expect(r.leftBase).toBeGreaterThan(3);                 // vehicles get out of the enemy base
  expect(r.maxCargo).toBeGreaterThan(1);                 // halftracks carry troops
  expect(r.stuck).toEqual([]);
  expectClean(errors);
});
