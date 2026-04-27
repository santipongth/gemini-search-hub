import { test, expect, type Request, type Response } from "@playwright/test";

/**
 * Logs in as an admin, loads /admin/analytics and /admin/vector-metrics,
 * and asserts:
 *   1. Every server-function call (`/_serverFn/...`) returns 2xx.
 *   2. The analytics page renders its dashboard (no "Failed" toast).
 *   3. The vector-metrics page renders its stat cards + latency chart.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(
  !ADMIN_EMAIL || !ADMIN_PASSWORD,
  "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run admin integration tests.",
);

type ServerFnCall = { url: string; status: number; ok: boolean };

function trackServerFn(page: import("@playwright/test").Page) {
  const calls: ServerFnCall[] = [];
  const onResponse = (res: Response) => {
    const url = res.url();
    if (url.includes("/_serverFn/")) {
      calls.push({ url, status: res.status(), ok: res.ok() });
    }
  };
  const onRequestFailed = (req: Request) => {
    const url = req.url();
    if (url.includes("/_serverFn/")) {
      calls.push({ url, status: 0, ok: false });
    }
  };
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  return calls;
}

test.describe("Admin analytics + vector metrics", () => {
  test("logs in and renders metrics with successful server-fn calls", async ({ page }) => {
    const calls = trackServerFn(page);

    // 1. Sign in
    await page.goto("/auth");
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for navigation away from /auth
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });

    // 2. /admin/analytics
    await page.goto("/admin/analytics");
    // Either a known stat label or the page heading should render.
    await expect(
      page.getByText(/total searches|searches by day|modality breakdown/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // No error toast
    await expect(page.getByText(/forbidden|failed to load|unauthor/i)).toHaveCount(0);

    // 3. /admin/vector-metrics
    await page.goto("/admin/vector-metrics");
    await expect(page.getByRole("heading", { name: /vector search monitoring/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/total searches/i).first()).toBeVisible();
    await expect(page.getByText(/avg latency/i).first()).toBeVisible();
    await expect(page.getByText(/avg latency per day/i)).toBeVisible();
    // Recharts renders an SVG inside the chart container
    await expect(page.locator(".recharts-responsive-container svg").first()).toBeVisible();

    // 4. All server-fn calls succeeded
    expect(calls.length, "Expected at least one /_serverFn/ call").toBeGreaterThan(0);
    const failed = calls.filter((c) => !c.ok);
    expect(
      failed,
      `Failed server-fn calls:\n${failed.map((f) => `  ${f.status} ${f.url}`).join("\n")}`,
    ).toEqual([]);
  });
});
