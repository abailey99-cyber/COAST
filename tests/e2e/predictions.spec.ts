import { expect, test, type Browser, type Page } from "@playwright/test";
import { createTestOrder, deleteTestCustomer, e2eEnabled, serviceClient, sessionFile, type DemoUser, type TestOrder } from "./demo-users";

// Phase 4 end to end, on a throwaway order: "not known yet" until there's a
// lead time; a lead time gives an estimate; a passed promised date makes it
// at risk; a date set by hand sticks until handed back; settings and
// availability.

const CUSTOMER = "[E2E predictions customer]";

test.describe("delivery-date prediction", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let order: TestOrder;

  test.beforeAll(async () => {
    const service = serviceClient();
    await deleteTestCustomer(service, CUSTOMER);
    order = await createTestOrder(service, CUSTOMER, [{ description: "Predict-test unit", quantity: 1, route: "direct_ship" }]);
    await service.from("sales_orders").update({ promised_date: "2099-12-31" }).eq("id", order.orderId);
  });

  test.afterAll(async () => {
    const service = serviceClient();
    await service.from("product_availability").delete().like("sku", "E2E-PRED-%");
    await deleteTestCustomer(service, CUSTOMER);
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  const predicted = (page: Page) => page.getByRole("definition").filter({ has: page.getByText(/estimate|Not known yet|set by hand/) }).first();

  test("not known until there's a lead time, then an estimate that's on track", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto(`/app/orders/${order.orderId}`);
    await expect(page.getByText(/Not known yet: line 1 has no confirmed date or lead time/)).toBeVisible();

    await page.getByLabel("Lead time for line 1, in working days (blank for automatic)").fill("3");
    await page.getByRole("button", { name: "Set days" }).click();
    await expect(page.getByText("✓ Saved")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("3 working days (set by hand)")).toBeVisible();
    await expect(page.getByText(/Worked out from the lead time/)).toBeVisible();
    await expect(page.getByText("● On track")).toBeVisible();
    await expect(predicted(page)).toContainText("estimate");
  });

  test("a promised date that has passed makes it at risk, on the order and in the list", async ({ browser }) => {
    await serviceClient().from("sales_orders").update({ promised_date: "2026-01-05" }).eq("id", order.orderId);
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto(`/app/orders/${order.orderId}`);
    await expect(page.getByText("● At risk").first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "History" }).getByText(/^At risk: predicted delivery/)).toBeVisible();

    await page.goto(`/app/orders?view=at_risk&rep=all&q=${order.soNumber}`);
    const row = page.getByRole("row", { name: new RegExp(order.soNumber) });
    await expect(row.getByText("● At risk")).toBeVisible();
  });

  test("a date set by hand wins and sticks until handed back", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto(`/app/orders/${order.orderId}`);
    await page.getByRole("button", { name: "Set the date by hand" }).click();
    await page.getByLabel("Delivery date").fill("2026-12-01");
    await page.getByLabel("Why (optional)").fill("Customer agreed a later date");
    await page.getByRole("button", { name: "Save date" }).click();
    await expect(page.getByText(/won't change this date until you hand it back/)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Tue 1 Dec", { exact: true })).toBeVisible();
    await expect(page.getByText(/Set by hand — “Customer agreed a later date”/)).toBeVisible();

    await page.getByRole("button", { name: "Let COAST work it out again" }).click();
    await expect(page.getByText("COAST will work the date out again.")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText(/Worked out from the lead time/)).toBeVisible();
  });

  test("sales see the prediction but can't change it", async ({ browser }) => {
    const page = await as(browser, "sales@demo-a.coast.test");
    await page.goto(`/app/orders/${order.orderId}`);
    await expect(page.getByText(/Worked out from the lead time/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Set the date by hand" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set days" })).toHaveCount(0);
  });

  test("availability by product code can be pasted in, with unreadable rows listed", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/suppliers");
    await page.getByLabel("Paste one product code and number of working days per line").fill("E2E-PRED-1, 4\nE2E-PRED-2, in stock\nE2E-PRED-3, soon");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("Saved 2 product codes. 1 row was left out.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Row 3: "soon" isn't a number of days/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("row", { name: /E2E-PRED-1/ }).getByText("4 working days")).toBeVisible();
    await expect(page.getByRole("row", { name: /E2E-PRED-2/ }).getByText("In stock")).toBeVisible();
    await page.getByRole("button", { name: "Remove E2E-PRED-2" }).click();
    await expect(page.getByRole("row", { name: /E2E-PRED-2/ })).toHaveCount(0, { timeout: 15_000 });
  });

  test("an admin can change the delivery-date settings", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/settings");
    await page.locator("summary", { hasText: "Delivery dates" }).click();
    await page.getByLabel("Your own delivery").fill("3");
    await page.getByRole("button", { name: "Save delivery-date settings" }).click();
    await expect(page.getByText(/✓ Saved. Open orders have been worked out again./)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Your own delivery").fill("2");
    await page.getByRole("button", { name: "Save delivery-date settings" }).click();
    await expect(page.getByText(/✓ Saved. Open orders have been worked out again./)).toBeVisible({ timeout: 30_000 });
  });
});
