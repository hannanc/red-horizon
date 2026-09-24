// Synthesised sound: every effect renders to real audio without clipping; sounds are placed by the camera
// (panned, faded, silent far away), busy sounds are capped, the volume setting mutes them, and game events
// pick the right sound.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => { errors = await boot(page); });
test.afterEach(() => expectClean(errors));

const ALL = ['shoot', 'cannon', 'rocket', 'flak', 'torpedo', 'zap', 'arc', 'mind', 'rad', 'snipe', 'bite', 'bark', 'chirp', 'latch',
             'missile', 'bomb', 'explosion', 'collapse', 'death', 'blink', 'ready', 'built', 'place', 'deploy', 'cash', 'alert', 'deny',
             'click', 'powerdown', 'win', 'lose'];

test('every sound renders to audible audio that never clips and dies away', async ({ page }) => {
  const r = await page.evaluate(async all => {
    const out = {};
    for(const k of all) out[k] = await __RH.renderSfx(k);
    out.bigBoom = await __RH.renderSfx('explosion', 1.6);
    return out;
  }, ALL);
  for(const [k, m] of Object.entries(r)){
    expect(m.peak, k).toBeGreaterThan(0.03);
    expect(m.peak, k).toBeLessThan(1);
    expect(m.len, k).toBeLessThan(2.2);
  }
  expect(r.bigBoom.len).toBeGreaterThan(r.explosion.len);       // a bigger blast rings longer
});

test('sounds are panned by where they happen, fade off screen and are silent far away', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.look(20, 40);
    const log = __RH.sfxLog, play = (type, tx, ty) => { __RH.sfx(type, tx, ty); return log[log.length - 1]; };
    const out = {};
    out.here = play('cannon', 20, 40);
    // world x - y runs across the screen: the tile north-west of here is on the left, south-east on the right
    out.left = play('explosion', 14, 46);
    out.right = play('death', 26, 34);
    out.far = play('snipe', 55, 5);
    out.ui = play('ready');
    return out;
  });
  expect(r.here.gain).toBe(1);
  expect(Math.abs(r.here.pan)).toBeLessThan(0.05);
  expect(r.left.pan).toBeLessThan(-0.2);
  expect(r.right.pan).toBeGreaterThan(0.2);
  expect(r.far).toEqual({type: 'snipe', skip: 'far'});
  expect(r.ui).toEqual({type: 'ready', gain: 1, pan: 0});
});

test('a burst of the same sound is capped, and the volume slider at zero mutes everything', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.look(20, 40);
    const log = __RH.sfxLog, n0 = log.length;
    for(let i = 0; i < 30; i++) __RH.sfx('shoot', 20, 40);
    const burst = log.slice(n0);
    __RH.settings.sfx = 0;
    __RH.sfx('explosion', 20, 40);
    const muted = log[log.length - 1];
    __RH.settings.sfx = 0.8;
    return {played: burst.filter(e => !e.skip).length, busy: burst.filter(e => e.skip === 'busy').length, muted};
  });
  expect(r.played).toBe(1);
  expect(r.busy).toBe(29);
  expect(r.muted).toEqual({type: 'explosion', skip: 'muted'});
});

test('game events make their own sounds: guns, deaths, a falling building, finishing construction', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(14, 34, 14, 12);
    __RH.look(20, 40);
    const log = __RH.sfxLog, heard = () => new Set(log.map(e => e.type));
    log.length = 0;
    __RH.spawn('ltank', 18, 40);
    const rifle = __RH.spawn('rifle', 22, 40, 1);
    for(let i = 0; i < 60 && !rifle.dead; i++) __RH.step(0.5);
    const fight = [...heard()];
    log.length = 0;
    const b = __RH.place('power', 22, 36, 1);
    __RH.applyDamage(b, 1e6, null, null);
    const fall = [...heard()];
    // a structure finishing in the sidebar queue
    __RH.place('conyard', 8, 49);
    log.length = 0;
    __RH.prodQ.structure.push({key: 'power', isUnit: false, progress: 0.999, spent: 0});
    __RH.step(0.2);
    const built = [...heard()];
    return {fight, fall, built};
  });
  expect(r.fight).toEqual(expect.arrayContaining(['cannon', 'death']));
  expect(r.fall).toContain('collapse');
  expect(r.built).toContain('built');
});
