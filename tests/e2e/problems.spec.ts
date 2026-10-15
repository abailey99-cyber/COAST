import { expect, test, type Browser, type Page } from "@playwright/test";
import { createTestOrder, deleteTestCustomer, demoOrgId, e2eEnabled, serviceClient, sessionFile, type DemoUser, type TestOrder } from "./demo-users";

// Phase 7 end to end: a customer reports a damaged delivery with a photo from
// the tracking page; procurement works it through to a replacement; the
// customer sees only customer-safe wording. Then customs on a delivery to
// Northern Ireland: a person confirms it applies and ticks off a document.

const CUSTOMER = "[E2E problems customer]";
// The smallest file that starts like a JPEG: enough for COAST's real-type check.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

test.describe("delivery problems and customs", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let order: TestOrder;
  let code: string;
  let shipmentId: string;

  test.beforeAll(async () => {
    const service = serviceClient();
    await deleteTestCustomer(service, CUSTOMER);
    // Every test visitor shares one address, so earlier specs can use up the tracking-page limits.
    await service.from("rate_limit_hits").delete().neq("bucket", "");
    order = await createTestOrder(service, CUSTOMER, [{ description: "Problem-test cabinet", quantity: 2, route: "direct_ship" }]);
    code = (await service.from("sales_orders").select("tracking_code").eq("id", order.orderId).single()).data!.tracking_code;
    // A delivery to Northern Ireland, on its way.
    await service.from("sales_orders").update({ delivery_postcode: "BT1 5GS" }).eq("id", order.orderId);
    const orgId = await demoOrgId(service);
    const { data: s } = await service
      .from("shipments")
      .insert({ org_id: orgId, sales_order_id: order.orderId, leg: "direct", carrier: "other", tracking_number: "E2E-PROB-1", status: "in_transit", is_international: false, customs_status: "not_required" })
      .select("id")
      .single();
    shipmentId = s!.id;
    await service.from("shipment_lines").insert({ shipment_id: shipmentId, order_line_id: order.lineIds[0] });
  });

  test.afterAll(async () => {
    const service = serviceClient();
    const { data } = await service.from("attachments").select("storage_path").like("storage_path", "%/delivery_exception/%").eq("file_name", "e2e-damage.jpg");
    if (data?.length) await service.storage.from("attachments").remove(data.map((a) => a.storage_path));
    await deleteTestCustomer(service, CUSTOMER);
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  test("a customer reports a damaged delivery with a photo", async ({ page }) => {
    await page.goto(`/track/${code}`);
    await page.getByText("Report a problem").click();
    await page.getByLabel("What's wrong?").selectOption({ label: "Damaged" });
    await expect(page.getByLabel("Problem-test cabinet")).toBeChecked();
    await page.getByLabel("Tell us what happened").fill("The cabinet door is dented.");
    await page.getByLabel("Photos (optional, up to 5)").setInputFiles({ name: "e2e-damage.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByRole("status").filter({ hasText: /we've got your report/ })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    const reports = page.getByRole("list", { name: "Your reports" });
    await expect(reports.getByText("Damaged")).toBeVisible();
    await expect(reports.getByText("We're looking into it")).toBeVisible();
  });

  test("procurement works it through to a replacement", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/problems");
    const row = page.getByRole("row").filter({ hasText: order.soNumber });
    await expect(row.getByRole("cell", { name: /^Customer / })).toBeVisible();
    await row.getByRole("link", { name: "Damaged" }).click();

    await expect(page.getByText("The cabinet door is dented.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Photo: e2e-damage.jpg" })).toBeVisible();
    await expect(page.getByText("“We're looking into it”")).toBeVisible();

    await page.getByLabel("Owner").selectOption({ index: 1 });
    await expect(page.getByRole("status").filter({ hasText: "Assigned." })).toBeVisible();

    await page.getByLabel("Move it on").selectOption({ label: "Waiting on the supplier" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Now: Waiting on the supplier." })).toBeVisible();

    await page.getByLabel("Move it on").selectOption({ label: "Resolved" });
    await page.getByLabel("How was it resolved?").selectOption({ label: "Replacement" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /Replacement added to the order as line 2/ })).toBeVisible();

    await page.getByRole("link", { name: "Open order" }).click();
    await expect(page.getByRole("row", { name: /Replacement: Problem-test cabinet/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Delivery problems" })).toBeVisible();
  });

  test("the customer sees it sorted, and nothing internal", async ({ page }) => {
    await page.goto(`/track/${code}`);
    const reports = page.getByRole("list", { name: "Your reports" });
    await expect(reports.getByText("Sorted")).toBeVisible();
    // The replacement is honestly on the order; the report never says who it waited on (the business advert below may mention suppliers).
    await expect(page.getByRole("region", { name: "In this order" }).getByText("Replacement: Problem-test cabinet")).toBeVisible();
    await expect(reports.getByText(/supplier|carrier|credit|replacement/i)).toHaveCount(0);
  });

  test("customs to Northern Ireland: a person confirms, then ticks off documents", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto(`/app/shipments/${shipmentId}`);
    const card = page.getByRole("region", { name: "Customs" });
    await expect(card.getByText(/a person needs to confirm it/)).toBeVisible();
    await card.getByRole("button", { name: "Customs applies" }).click();
    await expect(card.getByRole("status").filter({ hasText: /Customs applies to this shipment/ })).toBeVisible();
    await expect(card.getByRole("cell", { name: "Commercial invoice", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Mark commercial invoice received" }).click();
    await expect(card.getByRole("status").filter({ hasText: "Commercial invoice: received." })).toBeVisible();
    await expect(card.getByRole("row", { name: /^Commercial invoice/ }).getByText("● Received")).toBeVisible();
  });
});
