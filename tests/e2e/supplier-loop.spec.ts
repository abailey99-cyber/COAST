import { expect, test, type Browser, type Page } from "@playwright/test";
import { createTestOrder, deleteTestCustomer, e2eEnabled, openMenu, serviceClient, sessionFile, type DemoUser, type TestOrder } from "./demo-users";

// Phase 2 end to end, on throwaway orders: send a PO, the supplier confirms
// through the no-login link, the mismatch goes to review, procurement
// accepts it; a pasted clear reply applies itself; chasing both ways.

const CUSTOMER = "[E2E supplier-loop customer]";

test.describe("supplier loop", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let order: TestOrder;

  test.beforeAll(async () => {
    const service = serviceClient();
    await deleteTestCustomer(service, CUSTOMER);
    order = await createTestOrder(service, CUSTOMER, [
      { description: "Loop widget", quantity: 5, route: "direct_ship" },
      { description: "Loop gadget", quantity: 2, route: "via_warehouse" },
      { description: "Loop gizmo", quantity: 1, route: "direct_ship" },
    ]);
  });

  test.afterAll(async () => {
    await deleteTestCustomer(serviceClient(), CUSTOMER);
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  /** Raise a PO for one line of the test order and land on the PO page. */
  async function raisePo(page: Page, lineNo: number) {
    await page.goto(`/app/orders/${order.orderId}`);
    for (const box of await page.getByRole("checkbox", { name: /^Include line/ }).all()) await box.uncheck();
    await page.getByRole("checkbox", { name: `Include line ${lineNo}` }).check();
    await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "[Demo Supplier One]" });
    await page.getByRole("button", { name: "Create purchase order" }).click();
    await expect(page).toHaveURL(/\/app\/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  }

  test("send → supplier confirms by link with a different quantity → review → accept", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await raisePo(page, 1);
    await page.getByRole("button", { name: "Send to supplier" }).click();
    await expect(page.getByText(/Email written and logged/)).toBeVisible({ timeout: 15_000 });
    // The link is built from NEXT_PUBLIC_APP_URL; open its path on the test server.
    const link = new URL((await page.locator("code").filter({ hasText: "/confirm/" }).textContent())!.trim()).pathname;
    expect(link).toMatch(/\/confirm\/[A-Za-z0-9_-]{43}$/);
    await page.reload();
    await expect(page.getByText("● Sent")).toBeVisible();
    await expect(page.getByText("Logged — not sent (email isn't connected yet)").first()).toBeAttached();

    // The supplier: no login.
    const supplier = await (await browser.newContext()).newPage();
    await supplier.goto(link);
    await expect(supplier.getByRole("heading", { level: 1 })).toHaveText(/^PO-\d+$/);
    await expect(supplier.getByText("[Demo Org A]").first()).toBeVisible();
    await expect(supplier.getByText(/Deliver directly to/)).toBeVisible(); // direct ship
    await expect(supplier.getByText("£15.00")).toHaveCount(0); // the customer's price never appears
    await supplier.getByLabel("Quantity you can supply").fill("4");
    await supplier.getByLabel("Delivery date").fill("2026-11-04");
    await supplier.getByRole("button", { name: "Send confirmation" }).click();
    await expect(supplier.getByText(/someone will check it/)).toBeVisible({ timeout: 15_000 });

    // Back to procurement: the review queue.
    await page.goto("/app/review-queue");
    await openMenu(page);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Review queue/ })).toContainText(/\d/);
    await page.keyboard.press("Escape");
    const item = page.getByRole("region").filter({ hasText: "4 confirmed, 5 ordered" });
    await expect(item).toBeVisible();
    await item.getByRole("textbox", { name: /quantity/ }).fill("5");
    await item.getByRole("button", { name: "Accept and apply" }).click();
    // Accepted: it leaves the queue.
    await expect(item).toHaveCount(0, { timeout: 30_000 });

    await page.goto(`/app/orders/${order.orderId}`);
    await expect(page.getByRole("region", { name: "Lines" }).getByRole("row", { name: /Loop widget/ })).toContainText("Supplier confirmed");
    await expect(page.getByText(/confirmed for Wed 4 Nov/)).toBeVisible();
    await expect(page.getByText(/Supplier answered via the confirmation link — sent for review/)).toBeVisible();

    // The old link now says it's confirmed, but still accepts an update.
    await supplier.reload();
    await expect(supplier.getByText(/already confirmed/)).toBeVisible();
  });

  test("a clear pasted reply applies itself; a revoked link stops working", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await raisePo(page, 3);
    const poNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
    await page.getByRole("button", { name: "Make a new confirmation link" }).click();
    // The link is built from NEXT_PUBLIC_APP_URL; open its path on the test server.
    const link = new URL((await page.locator("code").filter({ hasText: "/confirm/" }).textContent())!.trim()).pathname;
    await page.reload();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Revoke" }).click();
    const anon = await (await browser.newContext()).newPage();
    await expect
      .poll(async () => {
        await anon.goto(link);
        return anon.getByRole("heading", { level: 1 }).textContent();
      }, { timeout: 15_000 })
      .toBe("This link has been replaced");

    await page.reload();
    await page.getByLabel("Supplier's email").fill(`Subject: RE: Purchase order ${poNumber}\n\nHi, confirmed — delivery Friday 6th November.\nUPS 1Z999AA10123456784\nThanks`);
    await page.getByRole("button", { name: "Read this email" }).click();
    await expect(page.getByText(/Read with high confidence and applied: confirmed for Fri 6 Nov\. Tracking added as a shipment\./)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("● Confirmed")).toBeVisible();
    // Phase 3: the tracking number became a direct shipment on the order, with the carrier recognised.
    await page.goto(`/app/orders/${order.orderId}`);
    const shipments = page.getByRole("region", { name: "Shipments" });
    await expect(shipments.getByRole("link", { name: "1Z999AA10123456784" })).toBeVisible();
    await expect(shipments.getByText("· UPS · Direct from supplier")).toBeVisible();
  });

  test("procurement chases a quiet supplier", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await raisePo(page, 2);
    await page.getByRole("button", { name: "Send to supplier" }).click();
    await expect(page.getByText(/Email written and logged/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Chase supplier" }).click();
    await expect(page.getByText(/Chase written and logged/)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Chased 1 time")).toBeVisible();
    await expect(page.getByText(/● (Waiting|Overdue|Very overdue|Needs attention) · waiting/).first()).toBeVisible();
  });

  test("sales asks procurement about a line; procurement answers", async ({ browser }) => {
    const sales = await as(browser, "sales@demo-a.coast.test");
    await sales.goto(`/app/orders/${order.orderId}`);
    await sales.getByLabel("Which line").selectOption({ label: "Line 2 · Loop gadget" });
    await sales.getByLabel("What do you need to know?").fill("Customer asking — any date yet?");
    await sales.getByRole("button", { name: "Ask procurement" }).click();
    await expect(sales.getByText("Procurement has been asked.")).toBeVisible({ timeout: 15_000 });
    await sales.reload();
    await expect(sales.getByText("“Customer asking — any date yet?”")).toBeVisible();

    const procurement = await as(browser, "procurement@demo-a.coast.test");
    await procurement.goto(`/app/orders/${order.orderId}`);
    await procurement.getByLabel("Reply", { exact: true }).fill("Chasing the supplier today");
    await procurement.getByRole("button", { name: "Answer and close" }).click();
    // Wait until it has saved (the panel shows it answered), then check it sticks.
    await expect(procurement.getByText("“Chasing the supplier today”")).toBeVisible({ timeout: 15_000 });
    await procurement.reload();
    await expect(procurement.getByText("“Chasing the supplier today”")).toBeVisible();
    await expect(procurement.getByText("Line 2: procurement answered")).toBeVisible();
  });
});
