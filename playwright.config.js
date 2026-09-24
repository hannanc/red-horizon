// Headless browser tests: `npm test` (everything) or `npm run test:quick` (skips @slow).
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
    browserName: 'chromium',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 tools/serve.py 8399',
    url: 'http://127.0.0.1:8399/index.html',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
