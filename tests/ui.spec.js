// Tests that go through the real input path: mouse clicks on the canvas and the sidebar.
const { test, expect } = require('@playwright/test');
const { boot, expectClean } = require('./helpers');

let errors;
test.beforeEach(async ({ page }) => { errors = await boot(page); });
test.afterEach(() => expectClean(errors));

test('sidebar lists only Allied units', async ({ page }) => {
  await page.click('#tabs .tab[data-tab="infantry"]');
  const infantry = await page.locator('#buildGrid .cameo .nm').allTextContents();
  expect(infantry).toEqual(expect.arrayContaining(['Rifleman', 'Engineer', 'Hound', 'Marksman']));
  expect(infantry).not.toContain('Arc Trooper');
  await page.click('#tabs .tab[data-tab="vehicle"]');
  const vehicles = await page.locator('#buildGrid .cameo .nm').allTextContents();
  expect(vehicles).toEqual(expect.arrayContaining(['Ranger IFV', 'Lancer Tank']));
  expect(vehicles).not.toContain('Leech Drone');
  expect(vehicles).not.toContain('Bulwark Halftrack');
});

test('click to select, right-click a transport to board, click it again to unload', async ({ page }) => {
  const pos = await page.evaluate(() => {
    __RH.clear(32, 48, 16, 16);
    const ifv = __RH.spawn('ifv', 40, 55);
    const rifle = __RH.spawn('rifle', 37, 55);
    window.__t = {ifv, rifle};
    __RH.look(38.5, 55.5);
    __RH.step(0.05);
    return {ifv: __RH.toScreen(ifv), rifle: __RH.toScreen(rifle)};
  });
  // select the rifleman, then right-click the IFV
  await page.mouse.click(pos.rifle.x, pos.rifle.y - 8);
  expect(await page.evaluate(() => __RH.selection.includes(__t.rifle))).toBe(true);
  await page.mouse.move(pos.ifv.x, pos.ifv.y - 6);
  await page.mouse.down({button: 'right'}); await page.mouse.up({button: 'right'});
  const boarded = await page.evaluate(() => { __RH.step(3); return __t.rifle.inside === __t.ifv; });
  expect(boarded).toBe(true);
  // select the IFV and click it again to unload
  await page.mouse.click(pos.ifv.x, pos.ifv.y - 6);
  await page.mouse.click(pos.ifv.x, pos.ifv.y - 6);
  const out = await page.evaluate(() => { __RH.step(0.2); return !__t.rifle.inside && __t.ifv.cargo.length === 0; });
  expect(out).toBe(true);
});

test('right-clicking an enemy building with an Engineer captures it', async ({ page }) => {
  const pos = await page.evaluate(() => {
    __RH.clear(32, 48, 16, 16);
    const b = __RH.place('power', 40, 54, 1);
    const eng = __RH.spawn('engineer', 37, 55);
    window.__t = {b, eng};
    __RH.look(39, 55);
    __RH.step(0.05);
    __RH.select([eng]);
    return __RH.toScreen(b);
  });
  await page.mouse.move(pos.x, pos.y - 10);
  await page.mouse.down({button: 'right'}); await page.mouse.up({button: 'right'});
  const team = await page.evaluate(() => { __RH.step(5); return __t.b.team; });
  expect(team).toBe(0);
});

test('a mixed group ordered to attack a tank all engage: dug-in riflemen get up, anti-infantry units come along', async ({ page }) => {
  const r = await page.evaluate(() => {
    __RH.clear(30, 46, 20, 18);
    const tank = __RH.spawn('ltank', 44, 55, 1);
    tank.order = {type: 'move'};
    const rifle = __RH.spawn('rifle', 34, 55), rocket = __RH.spawn('rocket', 34, 56), dog = __RH.spawn('dog', 34, 57);
    const dug = __RH.spawn('rifle', 33, 54); dug.deployed = true;
    window.__t = {tank, rifle, rocket, dog, dug};
    __RH.look(39, 55); __RH.step(0.05);
    __RH.select([rifle, rocket, dog, dug]);
    return __RH.toScreen(tank);
  });
  await page.mouse.move(r.x, r.y - 8);
  await page.mouse.down({button: 'right'}); await page.mouse.up({button: 'right'});
  const o = await page.evaluate(() => {
    const {tank, rifle, rocket, dog, dug} = __t;
    const start = {dog: dog.x, dug: dug.x};
    __RH.step(3);
    return {rifle: rifle.order.type, rocket: rocket.order.type, dog: dog.order.type, dug: dug.order.type,
            dugUp: !dug.deployed, dogMoved: dog.x - start.dog, dugMoved: dug.x - start.dug};
  });
  expect(o.rifle).toBe('attack');
  expect(o.rocket).toBe('attack');
  expect(o.dug).toBe('attack');
  expect(o.dugUp).toBe(true);
  expect(o.dugMoved).toBeGreaterThan(20);        // actually going after it
  expect(o.dog).toBe('attackmove');              // can't bite a tank, but comes along
  expect(o.dogMoved).toBeGreaterThan(20);
});
