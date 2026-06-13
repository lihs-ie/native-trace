import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  // progress spec は sentinel learner を全テストで共有するため、
  // DB 干渉を防ぐためにテスト全体を直列実行する。
  // dismissal spec は beforeAll で seeded data を参照するため fullyParallel: false でも動作する。
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/progress.spec.ts"],
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 15"] },
      testIgnore: ["**/progress.spec.ts"],
    },
    // progress spec は sentinel learner を共有するため single-worker で直列実行する
    {
      name: "progress-chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["**/progress.spec.ts"],
    },
  ],
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
