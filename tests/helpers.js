// Shared setup: load the game, press start, and stop the real-time clock so each
// test advances the simulation itself with __RH.step(seconds).
const { expect } = require('@playwright/test');

async function boot(page){
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  await page.evaluate(() => { __RH.start(); __RH.pause(true); });
  return errors;
}

// no console errors or uncaught exceptions during the test
function expectClean(errors){
  expect(errors, errors.join('\n')).toEqual([]);
}

module.exports = { boot, expectClean };
