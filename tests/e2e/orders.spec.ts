import { expect, test, type Browser, type Page } from "@playwright/test";
import { demoOrgId, e2eEnabled, serviceClient, sessionFile, type DemoUser } from "./demo-users";

// Phase 1 end to end: create an order, raise a PO, move stages, and check
// what each role sees on the Orders screen.

const TEST_CUSTOMER = "[E2E customer]";

test.describe("orders", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    const page = await (await browser.newContext({ storageState: sessionFile(email) })).newPage();
    return page;
  }

  test.afterAll(async () => {
    const service = serviceClient();
    const orgId = await demoOrgId(service);
    const { data: cust } = await service.from("customers").select("id").eq("org_id", orgId).eq("name", TEST_CUSTOMER);
    const custIds = (cust ?? []).map((c) => c.id);
    if (!custIds.length) return;
    const { data: orders } = await service.from("sales_orders").select("id").in("customer_id", custIds);
    const orderIds = (orders ?? []).map((o) => o.id);
    if (orderIds.length) {
      const { data: lines } = await service.from("order_lines").select("id").in("sales_order_id", orderIds);
      const { data: pols } = await service.from("purchase_order_lines").select("purchase_order_id").in("order_line_id", (lines ?? []).map((l) => l.id));
      const poIds = [...new Set((pols ?? []).map((p) => p.purchase_order_id))];
      if (poIds.length) await service.from("purchase_orders").delete().in("id", poIds);
      await service.from("sales_orders").delete().in("id", orderIds);
    }
    await service.from("customers").delete().in("id", custIds);
  });

  test("the Orders screen matches the mockup's layout and shows the demo orders", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/orders?rep=all");
    await expect(page.getByRole("heading", { name: "Orders", level: 1 })).toBeVisible();
    for (const label of ["Open orders", "Awaiting supplier", "Need a purchase order", "At risk"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "SO-10421" })).toBeVisible();
    await expect(page.getByRole("row", { name: /SO-10421/ })).toContainText("Supplier confirmed");
    await page.getByRole("link", { name: "Delivered", exact: true }).click();
    await expect(page.getByRole("link", { name: "SO-10388" })).toBeVisible();
    await expect(page.getByRole("link", { name: "SO-10421" })).toHaveCount(0);
  });

  test("a sales rep opens on their own orders and can switch to all (E1)", async ({ browser }) => {
    const page = await as(browser, "sales@demo-a.coast.test");
    await page.goto("/app/orders");
    const select = page.getByRole("combobox", { name: /Showing/ });
    await expect(select).toHaveValue("mine");
    await expect(page.getByRole("link", { name: "SO-10421" })).toBeVisible(); // theirs
    await expect(page.getByRole("link", { name: "SO-10418" })).toHaveCount(0); // the other rep's
    await select.selectOption("all");
    await expect(page.getByRole("link", { name: "SO-10418" })).toBeVisible();
  });

  test("search finds orders by customer, reference and PO number", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/orders");
    const search = page.getByRole("searchbox", { name: "Search orders" });
    await search.fill("4500021");
    await search.press("Enter");
    await expect(page.getByRole("link", { name: "SO-10409" })).toBeVisible();
    await expect(page.getByRole("link", { name: "SO-10421" })).toHaveCount(0);
  });

  test("a view-only director gets no New order button or stage controls", async ({ browser }) => {
    const page = await as(browser, "director@demo-a.coast.test");
    await page.goto("/app/orders");
    await expect(page.getByRole("link", { name: "New order" })).toHaveCount(0);
    await page.getByRole("link", { name: "SO-10421" }).click();
    await page.getByRole("link", { name: "Open order" }).click();
    await expect(page.getByRole("heading", { name: "SO-10421", level: 1 })).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await page.goto("/app/orders/new");
    await expect(page).toHaveURL(/\/app\/orders$/);
  });

  test("procurement creates an order, raises a PO, and moves it along", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/orders/new");

    // A mistake first: the form keeps what was typed and says what's wrong.
    await page.getByLabel("Customer", { exact: true }).fill(TEST_CUSTOMER);
    await page.getByLabel("Line 1 description").fill("E2E test widget");
    await page.getByLabel("Line 1 quantity").fill("0");
    await page.getByRole("button", { name: "Create order" }).click();
    await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
    await expect(page.getByText("Line 1: enter a quantity above 0.")).toBeVisible();
    await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(TEST_CUSTOMER);

    await page.getByLabel("Customer's own reference (optional)").fill("E2E-REF-9");
    await page.getByLabel("Deliver to").fill("E2E Goods In");
    await page.getByLabel("Address line 1").fill("2 Test Road");
    await page.getByLabel("Town or city").fill("Newark");
    await page.getByLabel("Postcode").fill("ng241ab");
    await page.getByLabel("Line 1 quantity").fill("5");
    await page.getByLabel("Line 1 unit price").fill("19.99");
    await page.getByRole("button", { name: "Create order" }).click();

    await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SO-\d+$/);
    await expect(page.getByText("NG24 1AB")).toBeVisible();
    await expect(page.getByRole("region", { name: "Lines" }).getByRole("row", { name: /E2E test widget/ })).toContainText("Needs PO");
    await expect(page.getByText("Order created")).toBeVisible();

    // Raise a PO.
    await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "[Demo Supplier One]" });
    await page.getByLabel("Unit cost for line 1").fill("11.50");
    await page.getByRole("button", { name: "Create purchase order" }).click();
    await expect(page).toHaveURL(/\/app\/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^PO-\d+$/);
    await expect(page.getByText("● Draft")).toBeVisible();
    await expect(page.getByText("£57.50")).toBeVisible(); // 5 × £11.50

    // Manual status changes live in a fold-out (sending by email is the main route since Phase 2).
    const byHand = async () => {
      const details = page.locator("details").filter({ has: page.locator("summary", { hasText: "Change the status by hand" }) });
      if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
    };
    await byHand();
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText("● Sent")).toBeVisible();
    await byHand();
    await page.getByRole("button", { name: "Mark as confirmed by supplier" }).click();
    await expect(page.getByText("● Confirmed")).toBeVisible();

    // Back on the order: confirmed by the PO, then dispatched by hand.
    await page.getByRole("link", { name: /^SO-\d+$/ }).first().click();
    const stage = page.getByRole("combobox", { name: "Stage for line 1" });
    await expect(stage).toHaveValue("confirmed");
    await stage.selectOption("dispatched");
    await expect(page.getByRole("combobox", { name: "Stage for line 1" })).toHaveValue("dispatched");
    await expect(page.getByText("Line 1 → Dispatched")).toBeVisible();
    await expect(page.getByText(/Purchase order PO-\d+ raised for line 1/)).toBeVisible();
  });

  test("procurement edits the order: details, a line, and a new line", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/orders?view=all&q=E2E-REF-9");
    await page.getByRole("link", { name: /^SO-\d+$/ }).first().click();
    await page.getByRole("link", { name: "Open order" }).click();
    await page.getByRole("link", { name: "Edit order" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Edit SO-\d+$/);

    // Line 1 is dispatched with 5 on a PO: can't go below 5.
    await page.getByLabel("Line 1 quantity").fill("4");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/5 are already on a purchase order/)).toBeVisible();

    await page.getByLabel("Line 1 quantity").fill("5");
    await page.getByLabel("Line 1 description").fill("E2E test widget, blue");
    await page.getByLabel("Promised delivery date (optional)").fill("2026-11-20");
    await page.getByRole("button", { name: "Add a line" }).click();
    await page.getByLabel("Line 2 description").fill("E2E extra item");
    await page.getByLabel("Line 2 quantity").fill("2");
    await page.getByLabel("Line 2 fulfilled").selectOption("from_stock");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByText("Fri 20 Nov")).toBeVisible();
    await expect(page.getByRole("region", { name: "Lines" }).getByText("E2E test widget, blue")).toBeVisible();
    await expect(page.getByRole("region", { name: "Lines" }).getByRole("row", { name: /E2E extra item/ })).toContainText("To pick");
    await expect(page.getByText("Order details changed (promised date)")).toBeVisible();
    await expect(page.getByText("Line 1 changed (description)")).toBeVisible();
    await expect(page.getByText("Line 2 added")).toBeVisible();
  });

  test("the audit log in Settings shows the changes", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/settings");
    await page.locator("summary").filter({ hasText: "Audit log" }).click();
    await expect(page.getByRole("cell", { name: "Order line changed" }).first()).toBeVisible();
  });
});
