import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the local Worker (vite dev + local D1), signed in through the
 * localhost-only dev login. Requires a .dev.vars file (CI copies .dev.vars.example).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"] }, testIgnore: /passkey/ },
    // WebAuthn virtual authenticators exist only in Chromium (via CDP).
    { name: "passkey", use: { ...devices["Pixel 7"] }, testMatch: /passkey/ },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
