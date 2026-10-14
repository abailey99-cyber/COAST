import { expect, test, type Browser, type Page } from "@playwright/test";
import { openMenu, sessionFile, type DemoUser } from "./demo-users";

// Signs in as each demo role and checks the sidebar matches the default permissions (decisions B9, E1–E3).
// Needs the dev database and demo users (npm run db:seed-demo); skipped otherwise.
// Sessions come from auth.setup.ts, so each user signs in once per run.

const enabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DEMO_USER_PASSWORD) && process.env.COAST_ENV !== "production";

const ROLES: { email: DemoUser; label: string; nav: string[] }[] = [
  { email: "admin@demo-a.coast.test", label: "Admin", nav: ["Home", "Orders", "Purchase orders", "Review queue", "Chases", "Shipments", "Suppliers", "Goods-in", "Updates", "Metrics", "Settings"] },
  { email: "procurement@demo-a.coast.test", label: "Procurement", nav: ["Home", "Orders", "Purchase orders", "Review queue", "Chases", "Shipments", "Suppliers", "Goods-in", "Updates", "Metrics", "Settings"] },
  { email: "salesmanager@demo-a.coast.test", label: "Sales manager", nav: ["Home", "Orders", "Chases", "Updates", "Metrics", "Settings"] },
  { email: "sales@demo-a.coast.test", label: "Sales", nav: ["Home", "Orders", "Chases", "Updates", "Metrics", "Settings"] },
  { email: "director@demo-a.coast.test", label: "Director", nav: ["Home", "Orders", "Purchase orders", "Review queue", "Chases", "Shipments", "Suppliers", "Goods-in", "Updates", "Metrics", "Settings"] },
  { email: "goodsin@demo-a.coast.test", label: "Goods-in", nav: ["Home", "Goods-in", "Settings"] },
];

test.describe("signed-in roles", () => {
  test.skip(!enabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });


  /** A page already signed in as a demo user (saved session from auth.setup.ts). */
  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    const context = await browser.newContext({ storageState: sessionFile(email) });
    const page = await context.newPage();
    await page.goto("/app/home");
    await expect(page).toHaveURL(/\/app\/home/);
    return page;
  }

  /** Opens a collapsible section by its visible summary text. */
  async function openFold(page: import("@playwright/test").Page, name: string | RegExp, within?: import("@playwright/test").Locator) {
    const scope = within ?? page;
    const summary = scope.locator("summary").filter({ hasText: name }).first();
    const details = summary.locator("xpath=..");
    if ((await details.getAttribute("open")) === null) await summary.click();
    return details;
  }

  for (const role of ROLES) {
    test(`${role.label} sees exactly their sections`, async ({ browser }) => {
      const page = await as(browser, role.email);
      await openMenu(page);
      await expect(page.getByText(`${role.label} · [Demo Org A]`)).toBeVisible();
      const items = page.getByRole("navigation", { name: "Main" }).getByRole("list").getByRole("link");
      await expect(items).toHaveText(role.nav);
    });
  }

  test("a role can't open a section by typing its address", async ({ browser }) => {
    const page = await as(browser, "goodsin@demo-a.coast.test");
    await page.goto("/app/suppliers");
    await expect(page).toHaveURL(/\/app\/home/);
  });

  test("organisation B's admin only sees organisation B's team", async ({ browser }) => {
    const page = await as(browser, "admin@demo-b.coast.test");
    await page.goto("/app/settings");
    const team = await openFold(page, "Team and individual access");
    await expect(team.getByText("[Admin B]")).toBeVisible();
    await expect(team.getByText("demo-a.coast.test")).toHaveCount(0);
  });

  test("an admin's switch in Who sees what changes a sales rep's screens", async ({ browser }) => {
    const adminPage = await as(browser, "admin@demo-a.coast.test");
    await adminPage.goto("/app/settings");
    await openFold(adminPage, "Who sees what");
    await openFold(adminPage, "Screens");
    const box = adminPage.getByRole("checkbox", { name: "Suppliers for Sales", exact: true });
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(box).toBeChecked();
    await expect(adminPage.getByText("✓ Saved")).toBeVisible();

    const salesPage = await as(browser, "sales@demo-a.coast.test");
    const nav = salesPage.getByRole("navigation", { name: "Main" });
    await openMenu(salesPage);
    await expect(nav.getByRole("link", { name: "Suppliers" })).toBeVisible();

    // Put it back.
    await adminPage.reload();
    await openFold(adminPage, "Who sees what");
    await openFold(adminPage, "Screens");
    await adminPage.getByRole("checkbox", { name: "Suppliers for Sales", exact: true }).uncheck();
    await expect(adminPage.getByRole("checkbox", { name: "Suppliers for Sales", exact: true })).not.toBeChecked();
    await expect(adminPage.getByText("✓ Saved")).toBeVisible();
    await salesPage.reload();
    await openMenu(salesPage);
    await expect(nav.getByRole("link", { name: "Suppliers" })).toHaveCount(0);
  });

  test("non-admins see Who sees what but can't change it", async ({ browser }) => {
    const page = await as(browser, "director@demo-a.coast.test");
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Who sees what" })).toBeVisible();
    await openFold(page, "Who sees what");
    await openFold(page, "Screens");
    await expect(page.getByText("● Yes").first()).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("a sales manager can change one rep, and no one else", async ({ browser }) => {
    const managerPage = await as(browser, "salesmanager@demo-a.coast.test");
    await managerPage.goto("/app/settings");
    await expect(managerPage.getByText(/you can change access for 2/)).toBeVisible();
    const team = await openFold(managerPage, "Team and individual access");

    // Block Chases for rep A2 only.
    const rep2 = await openFold(managerPage, "[Sales rep A2]", team);
    await openFold(managerPage, "Screens", rep2);
    const chases = rep2.getByRole("combobox", { name: "Chases for [Sales rep A2]" });
    await chases.selectOption("block");
    const rep2Summary = managerPage.locator("summary").filter({ hasText: "[Sales rep A2]" });
    await expect(rep2Summary.getByText("1 individual change")).toBeVisible();
    await expect(rep2.getByText("✓ Saved")).toBeVisible();
    await expect(managerPage.locator(".notice-error")).toHaveCount(0);
    // Saved, not just shown: still there after a reload.
    await managerPage.reload();
    await openFold(managerPage, "Team and individual access");
    await expect(rep2Summary.getByText("1 individual change")).toBeVisible();
    await openFold(managerPage, "[Sales rep A2]", team);
    await openFold(managerPage, "Screens", rep2);

    const repPage = await as(browser, "sales2@demo-a.coast.test");
    const nav = repPage.getByRole("navigation", { name: "Main" });
    await openMenu(repPage);
    await expect(nav.getByRole("link", { name: "Chases" })).toHaveCount(0);

    // Things the manager doesn't have can't be handed out.
    await openFold(managerPage, "Actions", rep2);
    await expect(rep2.getByRole("combobox", { name: "Create and edit orders for [Sales rep A2]" })).toHaveCount(0);

    // Other roles aren't editable by a sales manager.
    const procurement = await openFold(managerPage, "[Procurement A]", team);
    await openFold(managerPage, "Screens", procurement);
    await expect(procurement.getByRole("combobox")).toHaveCount(0);

    // Put it back.
    await openFold(managerPage, "Screens", rep2);
    await chases.selectOption("default");
    await expect(rep2.getByText("✓ Saved")).toBeVisible();
    await expect(rep2Summary.getByText("1 individual change")).toHaveCount(0);
    await repPage.reload();
    await openMenu(repPage);
    await expect(nav.getByRole("link", { name: "Chases" })).toBeVisible();
  });

  test("the theme switch in Settings changes the theme and is remembered", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/settings");
    const shell = page.locator("[data-app-theme]");
    await expect(shell).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Light" }).click();
    await expect(shell).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("[data-app-theme]")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Dark" }).click();
    await page.screenshot({ path: "test-results/screens/home-dark.png", fullPage: true });
  });

  test("the COAST logo opens and closes the menu", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    const nav = page.getByRole("navigation", { name: "Main" });
    const button = page.getByRole("button", { name: "Open menu" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "Orders", exact: true })).toBeHidden();
    await button.click();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    // Choosing a page closes it.
    await button.click();
    await nav.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/orders/);
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    // The theme switch lives in Settings now, not on every page.
    await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);
  });

  test("signing out ends the session", async ({ browser }) => {
    const page = await as(browser, "sales@demo-a.coast.test");
    await openMenu(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/app/home");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
