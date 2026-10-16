import { expect, test } from "@playwright/test";
import { freshTotp, nextWindow } from "../helpers/totp";
import { e2eEnabled, serviceClient } from "./demo-users";

// Readiness Task 5B: a staff member in an organisation that requires two-step
// sign-in sets up an authenticator app at first sign-in, then needs its code.
// [Demo Org C] requires it (scripts/seed-demo.ts).

const EMAIL = "admin@demo-c.coast.test";

test.describe("two-step sign-in", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let userId: string;
  const clearFactors = async () => {
    const service = serviceClient();
    const { data } = await service.auth.admin.mfa.listFactors({ userId });
    for (const f of data?.factors ?? []) await service.auth.admin.mfa.deleteFactor({ userId, id: f.id });
  };

  test.beforeAll(async () => {
    const service = serviceClient();
    const staff = (await service.from("staff_users").select("id").eq("email", EMAIL).maybeSingle()).data;
    test.skip(!staff, "Run npm run db:seed-demo to add [Demo Org C]");
    userId = staff!.id;
    await clearFactors();
  });
  test.afterAll(async () => {
    await clearFactors();
  });

  const signIn = async (page: import("@playwright/test").Page) => {
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(EMAIL);
    await page.getByLabel("Password").fill(process.env.DEMO_USER_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
  };

  test("sets up an authenticator app at first sign-in, then asks for its code every time", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await expect(page).toHaveURL(/\/sign-in\/two-step/);
    await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
    // Nothing in the app is reachable yet.
    await page.goto("/app/orders");
    await expect(page).toHaveURL(/\/sign-in\/two-step/);

    await page.getByRole("button", { name: "Show my QR code" }).click();
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
    await page.getByLabel("6-digit code from your app").fill("000000");
    await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That code didn't work" })).toBeVisible();
    await page.getByLabel("6-digit code from your app").fill(await freshTotp(secret));
    await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
    await expect(page).toHaveURL(/\/app\/home/);

    // Next time: password, then the code.
    await page.context().clearCookies();
    await nextWindow();
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible();
    await page.getByLabel("6-digit code from your app").fill(await freshTotp(secret));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/app\/home/);
  });
});
