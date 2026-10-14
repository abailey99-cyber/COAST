import { expect, test, type Browser, type Page } from "@playwright/test";
import { createTestOrder, deleteTestCustomer, demoOrgId, e2eEnabled, serviceClient, sessionFile, type DemoUser, type TestOrder } from "./demo-users";

// Phase 6 end to end, on a throwaway warehouse order: goods-in checks it in
// (short, then the rest); Chases shows the unsent PO; Updates shows a
// customer message as a problem; Metrics and Home load for each role.

const CUSTOMER = "[E2E insight customer]";

test.describe("home, updates, chases, metrics, goods-in", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let order: TestOrder;
  let poNumber: string;

  test.beforeAll(async () => {
    const service = serviceClient();
    await deleteTestCustomer(service, CUSTOMER);
    order = await createTestOrder(service, CUSTOMER, [{ description: "Insight-test pallet", quantity: 5, route: "via_warehouse" }]);
    const orgId = await demoOrgId(service);
    const supplier = (await service.from("suppliers").select("id").eq("org_id", orgId).eq("name", "[Demo Supplier Two]").single()).data!;
    const po = (await service.from("purchase_orders").insert({ org_id: orgId, supplier_id: supplier.id, currency: "GBP" }).select("id, po_number").single()).data!;
    poNumber = po.po_number;
    await service.from("purchase_order_lines").insert({ purchase_order_id: po.id, order_line_id: order.lineIds[0], quantity: 5 });
    await service.from("order_messages").insert({ org_id: orgId, sales_order_id: order.orderId, author_kind: "customer", body: "Is it on its way?" });
  });

  test.afterAll(async () => {
    await deleteTestCustomer(serviceClient(), CUSTOMER);
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  test("Chases shows the unsent PO and the waiting customer", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/chases");
    await expect(page.getByRole("link", { name: `${poNumber} hasn't been sent` })).toBeVisible();
    await page.getByRole("link", { name: /Customers waiting on us/ }).click();
    await expect(page.getByRole("link", { name: `${order.soNumber}: customer message` })).toBeVisible();
    await expect(page.getByRole("link", { name: `${poNumber} hasn't been sent` })).toHaveCount(0);
  });

  test("Updates lists everything, and the customer message under just the problems", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/updates?filter=problems");
    const row = page.getByRole("listitem").filter({ hasText: order.soNumber }).filter({ hasText: "Customer sent a message" });
    await expect(row.first()).toBeVisible();
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: order.soNumber }).first()).toBeVisible();
  });

  test("goods-in checks the delivery in: short first, then the rest", async ({ browser }) => {
    const page = await as(browser, "goodsin@demo-a.coast.test");
    await page.goto("/app/goods-in");
    const card = page.getByRole("article").filter({ hasText: "Insight-test pallet" });
    await expect(card).toBeVisible();
    await expect(card.getByText(new RegExp(`For ${order.soNumber} line 1`))).toBeVisible();
    await expect(card.getByText(new RegExp(poNumber))).toBeVisible();

    await card.getByLabel("Fewer than expected").check();
    await card.getByLabel("How many arrived").fill("2");
    await card.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByRole("status").filter({ hasText: /2 of 5 received so far/ })).toBeVisible({ timeout: 15_000 });

    await page.reload();
    const again = page.getByRole("article").filter({ hasText: "Insight-test pallet" });
    await expect(again.getByText("× 3 still to come (of 5)")).toBeVisible();
    await again.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByRole("status").filter({ hasText: /The line is now Received/ })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("article").filter({ hasText: "Insight-test pallet" })).toHaveCount(0);

    // Warehouse staff see Home with only their own tile.
    await page.goto("/app/home");
    await expect(page.getByText("Due into the warehouse")).toBeVisible();
    await expect(page.getByText("Orders at risk")).toHaveCount(0);
  });

  test("the order shows what goods-in recorded", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto(`/app/orders/${order.orderId}`);
    await expect(page.getByText("Line 1: 2 arrived (fewer than expected)")).toBeVisible();
    await expect(page.getByText("Line 1: 3 checked in")).toBeVisible();
    await expect(page.getByRole("row", { name: /Insight-test pallet/ }).getByRole("combobox")).toHaveValue("received");
  });

  test("Metrics and Home load, with supplier figures only for those who may see suppliers", async ({ browser }) => {
    const page = await as(browser, "director@demo-a.coast.test");
    await page.goto("/app/metrics");
    await expect(page.getByText("Delivered on time")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supplier reliability" })).toBeVisible();
    await page.goto("/app/home");
    await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();

    const service = serviceClient();
    const { data: rep } = await service.from("staff_users").select("id").eq("email", "sales2@demo-a.coast.test").single();
    await service.from("staff_permission_overrides").upsert({ user_id: rep!.id, permission: "supplier.identity.view", granted: false, set_by: null }, { onConflict: "user_id,permission" });
    try {
      const repPage = await as(browser, "sales2@demo-a.coast.test");
      await repPage.goto("/app/metrics");
      await expect(repPage.getByText(/Supplier figures are hidden/)).toBeVisible();
      await expect(repPage.getByRole("heading", { name: "Supplier reliability" })).toHaveCount(0);
    } finally {
      await service.from("staff_permission_overrides").delete().eq("user_id", rep!.id);
    }
  });
});
