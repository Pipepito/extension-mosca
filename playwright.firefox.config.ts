import { defineConfig } from '@playwright/test';
const live = process.env.MOSCAS_FIREFOX_LIVE === '1';
export default defineConfig({
  testDir: './tests/firefox', fullyParallel: false, workers: 1, retries: 0,
  forbidOnly: Boolean(process.env.CI), timeout: live ? 300_000 : 90_000,
  expect: { timeout: 15_000 }, reporter: 'list', outputDir: 'test-results/firefox',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: live ? 'firefox-live' : 'firefox', testMatch: live ? '**/*.live.spec.ts' : '**/*.smoke.spec.ts' }],
});
