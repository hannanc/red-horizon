// The tactical advisor's idle nag: first after 30 s with nothing under construction, then backing off
// by 30 s more each time (30, 60, 90 ... s apart), and starting over once something is queued.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

test('"nothing under construction" backs off by 30 s each time and resets when you build', async ({ page }) => {
  const errors = await boot(page);
  const r = await page.evaluate(() => {
    const hub = __RH.place('conyard', 8, 49);
    hub.hp = hub.maxHp = 1e7;                        // the AI mustn't end the game before the test does
    const times = [], late = [];
    let last = __RH.ai.buildNagAt;
    const run = secs => {
      for(let t = 0; t < secs; t++){
        __RH.step(1);
        if(__RH.ai.buildNagAt !== last){
          if(__RH.ai.buildNagAt > last){ times.push(last); late.push(__RH.ai.idleBuildT - last); }   // threshold crossed, and how late
          last = __RH.ai.buildNagAt;
        }
      }
    };
    run(320);
    const idleNags = times.slice();
    // queue a building: the idle clock and the back-off start over
    __RH.prodQ.structure.push({key: 'power', isUnit: false, progress: 0, spent: 0, ready: false, hold: true});
    __RH.step(2);
    const reset = {at: __RH.ai.buildNagAt, idle: __RH.ai.idleBuildT};
    __RH.prodQ.structure.length = 0;
    times.length = 0; last = __RH.ai.buildNagAt;
    run(35);
    return {idleNags, reset, afterReset: times.slice(), late: Math.max(...late)};
  });
  expect(r.idleNags).toEqual([30, 90, 180, 300]);
  expect(r.reset).toEqual({at: 30, idle: 0});
  expect(r.afterReset).toEqual([30]);
  expect(r.late).toBeLessThan(1.05);                    // each nag fires within the step that crosses its threshold
  expectClean(errors);
});

test('low power: the advisor says to build a Power Plant, with a cooldown that survives save and load', async ({ page }) => {
  const errors = await boot(page);
  const r = await page.evaluate(() => {
    const hub = __RH.place('conyard', 8, 49);
    hub.hp = hub.maxHp = 1e7;
    __RH.place('barracks', 12, 49);                   // draws power with no plant to feed it
    __RH.step(3);
    const early = __RH.ai.advPowerT;                  // not straight away: it has to last a few seconds
    __RH.step(3);
    const text = document.getElementById('advisorText').textContent;
    const at = __RH.ai.advPowerT;
    __RH.save(1);
    __RH.ai.advPowerT = 0;
    __RH.load(1);
    return {early, text, at, loaded: __RH.ai.advPowerT};
  });
  expect(r.early).toBe(0);
  expect(r.text).toContain('Power is low, build a Power Plant');
  expect(r.at).toBeGreaterThan(60);
  expect(r.loaded).toBe(r.at);
  // a plant in the queue: no nagging while the fix is on its way
  const again = await page.evaluate(() => {
    __RH.pause(true);
    __RH.ai.advPowerT = 0;
    __RH.prodQ.structure.push({key: 'power', isUnit: false, progress: 0, spent: 0, ready: false, hold: true});
    __RH.step(6);
    return __RH.ai.advPowerT;
  });
  expect(again).toBe(0);
  expectClean(errors);
});
