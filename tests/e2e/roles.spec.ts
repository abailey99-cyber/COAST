import { expect, test } from "@playwright/test";

// Signs in as each demo role and checks the sidebar matches the default permissions (decisions B9, E1–E3).
// Needs the dev database and demo users (npm run db:seed-demo); skipped otherwise.

const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && password) && process.env.COAST_ENV !== "production";

const ROLES = [
  { email: "admin@demo-a.coast.test", label: "Admin", nav: ["Home", "Orders", "Purchase orders", "Review queue", "Chases", "Shipments", "Suppliers", "Goods-in", "Updates", "Metrics", "Settings"] },
  { email: "procurement@demo-a.coast.test", label: "Procurement", nav: ["Home", "Orders", "Purchase orders", "Review queue", "Chases", "Shipments", "Suppliers", "Goods-in", "Updates", "Metrics", "Settings"] },
  { email: "sales@demo-a.coast.test", label: "Sales", nav: ["Home", "Orders", "Chases", "Updates", "Metrics", "Settings"] },
  { email: "director@demo-a.coast.test", label: "Director", nav: ["Home", "Orders", "Purchase orders", "Review queue", "Chases", "Shipments", "Suppliers", "Goods-in", "Updates", "Metrics", "Settings"] },
  { email: "goodsin@demo-a.coast.test", label: "Goods-in", nav: ["Home", "Goods-in", "Settings"] },
];

test.describe("signed-in roles", () => {
  test.skip(!enabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  async function signIn(page: import("@playwright/test").Page, email: string) {
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in to the app" }).click();
    await expect(page).toHaveURL(/\/app\/home/, { timeout: 15_000 });
  }

  for (const role of ROLES) {
    test(`${role.label} sees exactly their sections`, async ({ page }) => {
      await signIn(page, role.email);
      await expect(page.getByText(`${role.label} · [Demo Org A]`)).toBeVisible();
      const items = page.getByRole("navigation", { name: "Main" }).getByRole("list").getByRole("link");
      await expect(items).toHaveText(role.nav);
    });
  }

  test("a role can't open a section by typing its address", async ({ page }) => {
    await signIn(page, "goodsin@demo-a.coast.test");
    await page.goto("/app/suppliers");
    await expect(page).toHaveURL(/\/app\/home/);
  });

  test("organisation B's admin only sees organisation B's team", async ({ page }) => {
    await signIn(page, "admin@demo-b.coast.test");
    await page.goto("/app/settings");
    const team = page.getByRole("region", { name: "Team" });
    await expect(team.getByRole("cell", { name: "[Admin B]" })).toBeVisible();
    await expect(team.getByText("demo-a.coast.test")).toHaveCount(0);
  });

  test("an admin's switch in Who sees what changes a sales rep's screens", async ({ browser }) => {
    const adminPage = await (await browser.newContext()).newPage();
    await signIn(adminPage, "admin@demo-a.coast.test");
    await adminPage.goto("/app/settings");
    const box = adminPage.getByRole("checkbox", { name: "Suppliers for Sales" });
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(box).toBeChecked();

    const salesPage = await (await browser.newContext()).newPage();
    await signIn(salesPage, "sales@demo-a.coast.test");
    const nav = salesPage.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Suppliers" })).toBeVisible();

    // Put it back.
    await adminPage.reload();
    await adminPage.getByRole("checkbox", { name: "Suppliers for Sales" }).uncheck();
    await expect(adminPage.getByRole("checkbox", { name: "Suppliers for Sales" })).not.toBeChecked();
    await salesPage.reload();
    await expect(nav.getByRole("link", { name: "Suppliers" })).toHaveCount(0);
  });

  test("non-admins see Who sees what but can't change it", async ({ page }) => {
    await signIn(page, "director@demo-a.coast.test");
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Who sees what" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("the theme toggle switches and is remembered", async ({ page }) => {
    await signIn(page, "admin@demo-a.coast.test");
    const shell = page.locator("[data-app-theme]");
    await expect(shell).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Light" }).click();
    await expect(shell).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("[data-app-theme]")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Dark" }).click();
    await page.screenshot({ path: "test-results/screens/home-dark.png", fullPage: true });
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "sales@demo-a.coast.test");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/app/home");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
