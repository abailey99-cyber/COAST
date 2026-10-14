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
  // Screens talk to the hosted database; allow for a slow round trip under load.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Signs each demo user in once and saves the session (Supabase limits sign-ins).
    // One retry: a sign-in occasionally takes longer than usual on the hosted dev project.
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] }, retries: 1 },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    // Signed-in tests run once, at desktop size.
    { name: "phone", use: { ...devices["Pixel 7"] }, testIgnore: /(roles|orders|supplier-loop|shipments|predictions|customer-portal)\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
