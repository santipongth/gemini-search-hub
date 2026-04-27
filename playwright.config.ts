import { defineConfig, devices } from "@playwright/test";

/**
 * Integration tests for the admin analytics + vector metrics pages.
 *
 * Required env vars (set before running):
 *   E2E_BASE_URL          – e.g. http://localhost:8080  or your preview URL
 *   E2E_ADMIN_EMAIL       – an existing user with the `admin` role
 *   E2E_ADMIN_PASSWORD    – that user's password
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
