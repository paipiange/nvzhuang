import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const previewPort = process.env.PLAYWRIGHT_PORT || '43217'
const previewBaseUrl = `http://127.0.0.1:${previewPort}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: previewBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec uni --host 127.0.0.1 --port ${previewPort}`,
    url: previewBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
