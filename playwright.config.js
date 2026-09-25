// Headless browser tests: `npm test` (all three browsers), `npm run test:quick` (skips @slow),
// or one browser with `npx playwright test --project=chromium`.
// The game is served by tools/serve.py on its own port so a dev server on 8347 can keep running.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 120_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8399',
    viewport: {width: 1400, height: 900},
    screenshot: 'only-on-failure',
  },
  // every test runs in Chromium; Firefox and WebKit skip the long @slow simulations, which are plain game logic
  projects: [
    {name: 'chromium', use: {browserName: 'chromium'}},
    {name: 'firefox', use: {browserName: 'firefox'}, grepInvert: /@slow/},
    {name: 'webkit', use: {browserName: 'webkit'}, grepInvert: /@slow/},
  ],
  webServer: {
    command: 'python3 tools/serve.py 8399',
    url: 'http://127.0.0.1:8399/index.html',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
