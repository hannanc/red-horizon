// Voices never talk over each other: the announcer, the advisor and unit replies share one channel.
// A fake speech engine records when each line starts and ends (each "takes" 25 ms per character).
const { test, expect } = require('@playwright/test');
const { expectClean } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const spoken = window.__spoken = [];
    let playing = 0;
    const fake = {
      get speaking(){ return playing > 0; },
      speak(u){
        playing++;
        const rec = {text: u.text, start: performance.now(), end: null};
        spoken.push(rec);
        setTimeout(() => { playing--; rec.end = performance.now(); u.onend && u.onend(); }, 25 * u.text.length);
      },
      cancel(){ playing = 0; },
      getVoices(){ return [{name: 'Daniel', lang: 'en-GB', default: true}, {name: 'Fred', lang: 'en-US'}, {name: 'Samantha', lang: 'en-US'}]; },
    };
    Object.defineProperty(window, 'speechSynthesis', {value: fake, configurable: true});
  });
});

async function boot(page){
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  await page.evaluate(() => { __RH.start(); __RH.pause(true); });
  // let the start-up line ("Command link established") finish, so each test starts with a free channel
  await page.waitForFunction(() => !__RH.voice.cur && !__RH.voice.queue.length, null, {timeout: 10_000});
  await page.evaluate(() => { window.__spoken.length = 0; __RH.voice.log.length = 0; });
  return errors;
}

test('lines never overlap; urgent ones jump the queue; replies are skipped while busy', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const u = __RH.units.find(v => v.team === 0);
    __RH.announce('Unit ready', false, 'Unit ready');                       // starts at once
    __RH.ack('select', u);                                                  // busy: skipped
    __RH.showAdvisor('Nothing under construction. Consider a Power Plant.'); // waits (advisor)
    __RH.announce('Construction complete', false, 'Construction complete'); // waits (announcer)
    __RH.announce('Our base is under attack!', true, 'Our base is under attack'); // waits, but goes next
    __RH.announce('Unit ready', false, 'Unit ready');                       // duplicate of the one playing: dropped
  });
  await page.waitForFunction(() => window.__spoken.length >= 4 && window.__spoken.every(r => r.end), null, {timeout: 20_000});
  const r = await page.evaluate(() => window.__spoken.map(x => ({text: x.text, start: x.start, end: x.end})));
  for(let i = 1; i < r.length; i++) expect(r[i].start, `${r[i].text} started before ${r[i - 1].text} ended`).toBeGreaterThanOrEqual(r[i - 1].end);
  expect(r.map(x => x.text)).toEqual(['Unit ready', 'Our base is under attack',
                                      'Nothing under construction. Consider a Power Plant.', 'Construction complete']);
  expectClean(errors);
});

test('a unit reply is said when the channel is free; turning voices off stops everything', async ({ page }) => {
  const errors = await boot(page);
  const r = await page.evaluate(async () => {
    const u = __RH.units.find(v => v.team === 0 && !v.def.mcv && v.def.voice !== null);
    __RH.ack('select', u);
    const said = window.__spoken.length;
    __RH.announce('Unit ready', false, 'Unit ready');
    __RH.announce('Construction complete', false, 'Construction complete');
    document.getElementById('voiceBtn').click();                            // voices off
    await new Promise(res => setTimeout(res, 3000));
    return {said, total: window.__spoken.length, waiting: __RH.voice.queue.length};
  });
  expect(r.said).toBe(1);
  expect(r.total).toBe(1);          // nothing else got said after voices were switched off
  expect(r.waiting).toBe(0);
  expectClean(errors);
});

test('the advisor speaks in a different voice from the announcer', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => { __RH.showAdvisor('Enemy forces are massing.'); __RH.announce('Unit ready', false, 'Unit ready'); });
  await page.waitForFunction(() => __RH.voice.log.length >= 2 && !__RH.voice.cur, null, {timeout: 10_000});
  const log = await page.evaluate(() => __RH.voice.log.map(l => ({text: l.text, voice: l.voice, pitch: l.pitch})));
  const adv = log.find(l => l.text.startsWith('Enemy')), ann = log.find(l => l.text === 'Unit ready');
  expect(adv.voice).toBe('Samantha');        // another installed voice, not the default one
  expect(ann.voice).toBeNull();              // the announcer keeps the default voice
  expect(adv.pitch).not.toBe(ann.pitch);
  expectClean(errors);
});
