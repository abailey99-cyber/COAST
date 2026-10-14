import { expect, test, type Browser, type Page } from "@playwright/test";
import { createTestOrder, deleteTestCustomer, e2eEnabled, serviceClient, sessionFile, type DemoUser, type TestOrder } from "./demo-users";

// Phase 3 end to end, on a throwaway order and the test carrier: add a
// shipment, check it with the carrier, watch the order line move; set a
// status by hand and hand it back; who may do what; carrier connections.

const CUSTOMER = "[E2E shipments customer]";

test.describe("shipments", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let order: TestOrder;

  test.beforeAll(async () => {
    const service = serviceClient();
    await deleteTestCustomer(service, CUSTOMER);
    order = await createTestOrder(service, CUSTOMER, [
      { description: "Ship-test crate", quantity: 2, route: "from_stock" },
      { description: "Ship-test pallet", quantity: 1, route: "direct_ship" },
    ]);
  });

  test.afterAll(async () => {
    await deleteTestCustomer(serviceClient(), CUSTOMER);
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  async function addShipment(page: Page, leg: string, lineLabel: RegExp, tracking: string) {
    await page.goto(`/app/orders/${order.orderId}`);
    await page.getByRole("button", { name: "Add a shipment" }).click();
    await page.getByLabel("Going").selectOption({ label: leg });
    await page.getByRole("checkbox", { name: lineLabel }).check();
    await page.getByLabel("Tracking number").fill(tracking);
    // The carrier is filled in from the number's shape.
    await expect(page.getByLabel("Carrier", { exact: true })).toHaveValue("mock");
    await page.getByRole("button", { name: "Add shipment" }).click();
    await expect(page.getByText(/Shipment added/)).toBeVisible({ timeout: 15_000 });
  }

  test("add a shipment, check it with the carrier, and the line moves to delivered", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await addShipment(page, "To the customer", /Ship-test crate/, "mock-delivered-e2e1");
    await page.reload();
    const panel = page.getByRole("region", { name: "Shipments" });
    await expect(panel.getByRole("link", { name: "MOCK-DELIVERED-E2E1" })).toBeVisible();

    // The Shipments screen finds it by tracking number.
    await page.goto("/app/shipments?view=all&q=MOCK-DELIVERED-E2E1");
    await page.getByRole("link", { name: "MOCK-DELIVERED-E2E1" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("MOCK-DELIVERED-E2E1");
    await expect(page.getByText("Not known yet").first()).toBeVisible();

    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByText("Checked: there's news from the carrier.")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("● Delivered").first()).toBeVisible();
    await expect(page.getByText("Delivered — signed for").first()).toBeVisible();
    await expect(page.getByText(/checks stopped \(delivered\)/)).toBeVisible();

    // The order line moved on, and the order's history says why — without the tracking number.
    await page.goto(`/app/orders/${order.orderId}`);
    const crate = page.getByRole("row", { name: /Ship-test crate/ });
    await expect(crate.getByRole("cell", { name: "Delivered", exact: true })).toBeVisible();
    await expect(page.getByText("Shipment to the customer (Test carrier): delivered")).toBeVisible();
  });

  test("set a status by hand, which sticks until handed back", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await addShipment(page, "Direct from supplier", /Ship-test pallet/, "MOCK-TRANSIT-E2E2");
    await page.goto("/app/shipments?view=all&q=MOCK-TRANSIT-E2E2");
    await page.getByRole("link", { name: "MOCK-TRANSIT-E2E2" }).click();

    await page.getByLabel("Status", { exact: true }).selectOption({ label: "Problem reported" });
    await page.getByLabel("Note (optional)").fill("Driver reports a damaged corner");
    await page.getByRole("button", { name: "Set status" }).click();
    await expect(page.getByText(/won't overwrite this status/)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("● Problem reported · set by hand")).toBeVisible();

    // Checking with the carrier records its news but leaves the status alone.
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByText(/^Checked:/)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("● Problem reported · set by hand")).toBeVisible();
    await expect(page.getByText("Collected from sender").first()).toBeVisible();

    await page.getByRole("button", { name: "Hand the status back to the carrier" }).click();
    await expect(page.getByText(/from the next check/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByText(/^Checked:/)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("● In transit").first()).toBeVisible();
  });

  test("sales see shipments on the order but can't add them or open the Shipments screen", async ({ browser }) => {
    const page = await as(browser, "sales@demo-a.coast.test");
    await page.goto(`/app/orders/${order.orderId}`);
    const panel = page.getByRole("region", { name: "Shipments" });
    await expect(panel.getByText("MOCK-DELIVERED-E2E1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a shipment" })).toHaveCount(0);
    await page.goto("/app/shipments");
    await expect(page).toHaveURL(/\/app\/home$/);
  });

  test("a director sees shipments but can't change them", async ({ browser }) => {
    const page = await as(browser, "director@demo-a.coast.test");
    await page.goto("/app/shipments?view=all&q=MOCK-TRANSIT-E2E2");
    await page.getByRole("link", { name: "MOCK-TRANSIT-E2E2" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("MOCK-TRANSIT-E2E2");
    await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set status" })).toHaveCount(0);
  });

  test("carrier connections show each carrier honestly, and an admin can set a claim window", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/settings");
    await page.locator("summary", { hasText: "Carrier connections" }).click();
    const dhl = page.getByRole("row", { name: /DHL Express/ });
    await expect(dhl).toBeVisible();
    const dpd = page.getByRole("row", { name: /DPD/ });
    await expect(dpd.getByText("Beta")).toBeVisible();
    await page.getByLabel("Claim window for UPS, in days").fill("28");
    await page.getByRole("row", { name: /UPS/ }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("row", { name: /UPS/ }).getByText("✓ Saved")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Claim window for UPS, in days").fill("");
    await page.getByRole("row", { name: /UPS/ }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("row", { name: /UPS/ }).getByText("✓ Saved")).toBeVisible({ timeout: 15_000 });
  });

  test("the tracking job refuses callers without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/tracking-poll")).status()).toBe(401);
    expect((await request.get("/api/cron/tracking-poll", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  });
});
