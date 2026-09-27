// The AI builds its own base from a construction hub, rebuilds what it loses, keeps its
// factory yard open, and the difficulty levels play out in the right order.
const { test, expect } = require('@playwright/test');
const { expectClean } = require('./helpers');

async function load(page, difficulty){
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(d => localStorage.setItem('rh-difficulty', d), difficulty);
  await page.goto('/');
  await page.waitForFunction(() => window.__RH && window.__RH.ready, null, {timeout: 60_000});
  await page.evaluate(() => { __RH.start(); __RH.pause(true); });
  return errors;
}

// a far-away player base that can't be destroyed (or captured: AI engineers are removed), so the AI builds in peace
const QUIET = () => {
  __RH.place('conyard', 8, 49);
  for(const b of __RH.buildings) if(b.team === 0) b.hp = b.maxHp = 1e7;
  const step = __RH.step.bind(__RH);
  __RH.step = s => { step(s); for(const u of __RH.units) if(u.team === 1 && u.def.engineer) u.dead = true; };
};

// Normal and Hard build a Research Lab before their towers (Easy after), which costs Normal about 20 s
for(const [level, limit] of [['easy', 660], ['normal', 360], ['hard', 240]]){
  test(`from a bare hub the AI builds a full base on ${level} @slow`, async ({ page }) => {
    const errors = await load(page, level);
    const r = await page.evaluate(([limit, quiet]) => {
      eval(quiet)();
      const start = __RH.buildings.filter(b => b.team === 1).map(b => b.def.key);
      const need = ['power', 'refinery', 'barracks', 'factory', 'radar', 'arctower'];
      // towers stay by the hub instead of creeping towards the player
      const farTowers = () => {
        const hub = __RH.buildings.find(b => b.team === 1 && b.def.key === 'conyard');
        return __RH.buildings.filter(b => b.team === 1 && !b.dead && b.def.weapon && Math.hypot(b.x - hub.x, b.y - hub.y) > 10.5 * 32).length;
      };
      for(let t = 1; t <= limit; t++){
        __RH.step(1);
        const have = __RH.buildings.filter(b => b.team === 1 && !b.dead && b.buildUp >= 1).map(b => b.def.key);
        if(need.every(k => have.includes(k)) && have.filter(k => k === 'arctower').length >= 2)
          return {start, done: t, power: __RH.powerOf(1), far: farTowers()};
      }
      return {start, done: null, have: __RH.buildings.filter(b => b.team === 1).map(b => b.def.key)};
    }, [limit, QUIET.toString()]);
    expect(r.start).toEqual(['conyard']);
    expect(r.done, JSON.stringify(r)).not.toBeNull();
    expect(r.power.prod).toBeGreaterThanOrEqual(r.power.used);      // power stays positive
    expect(r.far).toBe(0);
    expectClean(errors);
  });
}

test('the AI rebuilds a destroyed factory and keeps every door open @slow', async ({ page }) => {
  const errors = await load(page, 'hard');
  const r = await page.evaluate(quiet => {
    eval(quiet)();
    const factory = () => __RH.buildings.find(b => b.team === 1 && !b.dead && b.def.key === 'factory' && b.buildUp >= 1);
    let t = 0;
    while(!factory() && t < 300){ __RH.step(1); t++; }
    const first = factory();
    __RH.applyDamage(first, 1e6, null, null);
    let rebuilt = null;
    for(let i = 1; i <= 90 && !rebuilt; i++){ __RH.step(1); if(factory()) rebuilt = i; }
    // let the base fill out, then check that every door can reach the middle of the map
    for(let i = 0; i < 360; i++) __RH.step(1);
    const doors = __RH.buildings.filter(b => b.team === 1 && !b.dead && ['factory', 'barracks', 'refinery'].includes(b.def.key)).map(b => {
      const x = b.tx + Math.floor(b.w / 2), y = b.ty + b.h;
      return {key: b.def.key, open: __RH.passable(x, y) && __RH.pathOK(x, y, 32, 32)};
    });
    return {first: !!first, rebuilt, doors, count: __RH.buildings.filter(b => b.team === 1).length};
  }, QUIET.toString());
  expect(r.first).toBe(true);
  expect(r.rebuilt).not.toBeNull();
  expect(r.count).toBeGreaterThan(10);
  expect(r.doors.length).toBeGreaterThan(2);
  expect(r.doors.every(d => d.open), JSON.stringify(r.doors)).toBe(true);
  expectClean(errors);
});

test('an idle defended base falls later on Easy than on Normal, and later on Normal than on Hard @slow', async ({ browser }) => {
  test.setTimeout(300_000);
  const fall = async level => {
    const page = await browser.newPage();
    const errors = await load(page, level);
    const t = await page.evaluate(() => {
      for(const u of __RH.units) if(u.team === 0) u.dead = true;      // no army, just the base
      __RH.place('conyard', 8, 49); __RH.place('power', 12, 49); __RH.place('power', 12, 52); __RH.place('power', 5, 53);
      __RH.place('pillbox', 15, 46); __RH.place('pillbox', 16, 50); __RH.place('beamtower', 14, 53);
      for(let t = 1; t <= 1500; t++){ __RH.step(1); if(__RH.state.over) return t; }
      return 1e9;
    });
    expectClean(errors);
    await page.close();
    return t;
  };
  const [easy, normal, hard] = await Promise.all(['easy', 'normal', 'hard'].map(fall));
  expect(hard).toBeLessThan(normal);
  expect(normal).toBeLessThan(easy);
});
