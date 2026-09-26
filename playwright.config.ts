import { defineConfig, devices } from "@playwright/test";

const testPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const testURL = `http://127.0.0.1:${testPort}`;
const serverCommand = process.env.PLAYWRIGHT_USE_BUILD === "1"
  ? `npm run start -- --hostname 127.0.0.1 --port ${testPort}`
  : `npm run dev -- --hostname 127.0.0.1 --port ${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: testURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: {
    command: serverCommand,
    url: testURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
