import { expect, test, type Browser, type Page } from "@playwright/test";
import { demoOrgId, e2eEnabled, serviceClient, sessionFile, type DemoUser } from "./demo-users";

// Readiness Task 2: an admin connects their own carrier account in Settings →
// Integrations; the secret is never shown again; non-admins can't change it.

test.describe("Settings → Integrations", () => {
  test.skip(!e2eEnabled || !process.env.COAST_CREDENTIAL_KEYS, "Dev database, DEMO_USER_PASSWORD or COAST_CREDENTIAL_KEYS not configured");
  test.describe.configure({ mode: "serial" });

  // Made up for the test.
  const KEY = `test-value-${Date.now()}-abcd`;

  test.beforeAll(async () => {
    const service = serviceClient();
    await service.from("integration_credentials").delete().eq("org_id", await demoOrgId(service)).eq("provider", "dhl");
  });
  test.afterAll(async () => {
    const service = serviceClient();
    await service.from("integration_credentials").delete().eq("org_id", await demoOrgId(service)).eq("provider", "dhl");
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  test("an admin connects DHL; the key is stored but never shown back", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/settings#integrations");
    await page.getByRole("heading", { name: "Integrations" }).click();
    const dhl = page.locator("[data-provider=dhl]");
    await expect(dhl.getByText("● Not connected")).toBeVisible();
    await dhl.getByRole("button", { name: "Connect" }).click();
    await dhl.getByLabel("API key").fill(KEY);
    await dhl.getByRole("button", { name: "Connect" }).click();
    await expect(dhl.getByRole("status").filter({ hasText: "DHL Express connected." })).toBeVisible();
    await page.reload();
    await page.getByRole("heading", { name: "Integrations" }).click();
    await expect(page.locator("[data-provider=dhl]").getByText(/key ending abcd/)).toBeVisible();
    await expect(page.getByText(KEY)).toHaveCount(0);
    expect(await page.content()).not.toContain(KEY);

    // UPS asks for written consent first.
    const ups = page.locator("[data-provider=ups]");
    await ups.getByRole("button", { name: "Connect" }).click();
    await expect(ups.getByText(/written consent/)).toBeVisible();
    await ups.getByRole("button", { name: "Cancel" }).click();
  });

  test("a non-admin sees the connection but can't change it", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/settings#integrations");
    await page.getByRole("heading", { name: "Integrations" }).click();
    const dhl = page.locator("[data-provider=dhl]");
    await expect(dhl.getByText(/Connected/)).toBeVisible();
    await expect(dhl.getByRole("button")).toHaveCount(0);
  });

  test("the admin disconnects it, and the secret is deleted", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/settings#integrations");
    await page.getByRole("heading", { name: "Integrations" }).click();
    page.once("dialog", (d) => d.accept());
    await page.locator("[data-provider=dhl]").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("status").filter({ hasText: /disconnected/ })).toBeVisible();
    const service = serviceClient();
    expect((await service.from("integration_credentials").select("id").eq("org_id", await demoOrgId(service)).eq("provider", "dhl")).data).toEqual([]);
  });
});

// Readiness Task 3: forwarding address, and sorting out emails COAST couldn't match.
test.describe("Supplier replies by email", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let hadAddress = false;
  const messageId = `<e2e-${Date.now()}@supplier.test>`;

  test.beforeAll(async () => {
    const service = serviceClient();
    const orgId = await demoOrgId(service);
    hadAddress = Boolean((await service.from("inbound_addresses").select("org_id").eq("org_id", orgId).maybeSingle()).data);
    await service.from("inbound_messages").insert({ org_id: orgId, channel: "forward", message_id: messageId, from_address: "someone@elsewhere.test", subject: "Quote for your enquiry", body: "Please see attached.", status: "quarantined", reason: "Not forwarded from yourco.test, so it's held back." });
  });
  test.afterAll(async () => {
    const service = serviceClient();
    const orgId = await demoOrgId(service);
    await service.from("inbound_messages").delete().eq("org_id", orgId).eq("message_id", messageId);
    if (!hadAddress) await service.from("inbound_addresses").delete().eq("org_id", orgId);
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  test("an admin sets up the forwarding address", async ({ browser }) => {
    const page = await as(browser, "admin@demo-a.coast.test");
    await page.goto("/app/settings#supplier-replies");
    await page.getByRole("heading", { name: "Supplier replies by email" }).click();
    await page.getByLabel("Your mailbox's domain(s)").fill("yourco.test");
    await page.getByRole("button", { name: /Make my address|Save/ }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /forwarding address is ready|Saved/ })).toBeVisible();
    await page.reload();
    await page.getByRole("heading", { name: "Supplier replies by email" }).click();
    await expect(page.locator("code").filter({ hasText: /^r-[0-9a-f]{30}/ })).toBeVisible();
  });

  test("procurement sees a held-back email and dismisses it", async ({ browser }) => {
    const page = await as(browser, "procurement@demo-a.coast.test");
    await page.goto("/app/review-queue");
    const item = page.getByRole("listitem").filter({ hasText: "Quote for your enquiry" });
    await expect(item.getByText("● Held back")).toBeVisible();
    await item.getByRole("button", { name: "Dismiss" }).click();
    await expect(item.getByRole("status").filter({ hasText: "Dismissed." })).toBeVisible();
  });
});
