import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["auth-flow.spec.ts", "translator.spec.ts"],
  testIgnore: "**/._*",
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3117",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/auth-e2e-server.mjs configured",
    url: "http://127.0.0.1:3117",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
