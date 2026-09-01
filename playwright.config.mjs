import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:10001";

export default defineConfig({
  testDir: "test/browser",
  testMatch: "**/*.spec.mjs",
  timeout: 180_000,
  expect: {
    timeout: 5_000,
  },
  globalSetup: "./test/browser/global-setup.mjs",
  outputDir: "results/playwright",
  reporter: [["html", { outputFolder: "results/playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx --no-install http-server build -p 10001 -c-1 --silent",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});