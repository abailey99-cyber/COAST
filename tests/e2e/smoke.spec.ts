import { expect, test } from "@playwright/test";

// Phase 0 critical paths that don't need a signed-in user.

test("home page shows the promise and a way in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Know where every order is, before your customer asks.");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test("sign-in page has both tabs and a labelled team form", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Welcome to COAST" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "My team" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  await page.getByRole("tab", { name: "Track an order" }).click();
  await expect(page.getByRole("tab", { name: "Track an order" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Tracking code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Track my order" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to your customer account" })).toBeVisible();
});

test("the staff app sends signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/app/orders");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("no page scrolls sideways on a phone", async ({ page }) => {
  for (const path of ["/", "/sign-in", "/sign-in/forgotten", "/track", "/integrations", "/pricing"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("the website only calls something Live once it's verified, and keeps prices hidden", async ({ page }) => {
  for (const path of ["/integrations", "/pricing"]) {
    await page.goto(path);
    for (const pill of await page.locator("[data-status]").all()) {
      const status = await pill.getAttribute("data-status");
      if (status === "live" || status === "beta") expect(await pill.getAttribute("data-verified"), await pill.textContent() ?? "").toBe("true");
    }
    await expect(page.getByText(/audit trail/i)).toHaveCount(0);
  }
  await page.goto("/integrations");
  await expect(page.getByRole("listitem").filter({ hasText: "DHL Express" }).getByText("● In development")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Supplier email reading" }).getByText("● Live (paste-in)")).toBeVisible();
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Help us set COAST up for businesses like yours." })).toBeVisible();
  await expect(page.getByText("[£ PRICE]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Supplier details are masked everywhere in COAST" })).toBeVisible();
});

test("cron endpoints refuse requests without the secret", async ({ request }) => {
  const res = await request.get("/api/cron/ping");
  expect(res.status()).toBe(401);
});

test("health endpoint answers without exposing values", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.app).toBe("ok");
  expect(JSON.stringify(body)).not.toMatch(/eyJ|sb_|key/i);
});
