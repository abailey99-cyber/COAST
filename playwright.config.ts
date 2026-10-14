import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Signed-in tests read the dev database settings and demo password from here.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Signs each demo user in once and saves the session (Supabase limits sign-ins).
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    // Signed-in tests run once, at desktop size.
    { name: "phone", use: { ...devices["Pixel 7"] }, testIgnore: /(roles|orders)\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
