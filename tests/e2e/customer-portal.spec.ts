import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createTestOrder, deleteTestCustomer, demoOrgId, e2eEnabled, serviceClient, sessionFile, type DemoUser, type TestOrder } from "./demo-users";

// Phase 5 end to end, on a throwaway order that has a real supplier and PO
// behind it: the customer tracks it by code and never sees either; they
// write in; a reply naming the supplier is blocked; a clean one arrives;
// they choose email updates; staff invite them to an account; they sign in.

const CUSTOMER = "[E2E portal customer]";
const SUPPLIER = "[Demo Supplier One]";
const EMAIL = `e2e-portal-${Date.now()}@customer.coast.test`;
const SELF_EMAIL = `e2e-self-${Date.now()}@customer.coast.test`;
const LEAD_EMAIL = `e2e-lead-${Date.now()}@prospect.coast.test`;

test.describe("customer portal", () => {
  test.skip(!e2eEnabled, "Dev database or DEMO_USER_PASSWORD not configured");
  test.describe.configure({ mode: "serial" });

  let order: TestOrder;
  let code: string;
  let poNumber: string;

  test.beforeAll(async () => {
    const service = serviceClient();
    // Every test run comes from the same address; start with fresh rate-limit counters.
    await service.from("rate_limit_hits").delete().neq("bucket", "");
    await deleteTestCustomer(service, CUSTOMER);
    order = await createTestOrder(service, CUSTOMER, [{ description: "Portal-test cabinet", quantity: 2, route: "direct_ship" }]);
    const orgId = await demoOrgId(service);
    const supplier = (await service.from("suppliers").select("id").eq("org_id", orgId).eq("name", SUPPLIER).single()).data!;
    const po = (await service.from("purchase_orders").insert({ org_id: orgId, supplier_id: supplier.id, currency: "GBP", status: "sent", notes: `Internal: ${SUPPLIER} margin` }).select("id, po_number").single()).data!;
    poNumber = po.po_number;
    await service.from("purchase_order_lines").insert({ purchase_order_id: po.id, order_line_id: order.lineIds[0], quantity: 2 });
    code = (await service.from("sales_orders").select("tracking_code").eq("id", order.orderId).single()).data!.tracking_code;
  });

  test.afterAll(async () => {
    const service = serviceClient();
    const { data } = await service.from("customer_accounts").select("user_id").in("email", [EMAIL, SELF_EMAIL]);
    for (const a of data ?? []) await service.auth.admin.deleteUser(a.user_id);
    await service.from("leads").delete().eq("email", LEAD_EMAIL);
    await deleteTestCustomer(service, CUSTOMER);
  });

  async function as(browser: Browser, email: DemoUser): Promise<Page> {
    return (await browser.newContext({ storageState: sessionFile(email) })).newPage();
  }

  test("a customer tracks the order by code and sees no supplier or PO", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/sign-in");
    await page.getByRole("tab", { name: "Track an order" }).click();
    await page.getByLabel("Tracking code").fill(code.toLowerCase().replace(/-/g, " "));
    await page.getByRole("button", { name: "Track my order" }).click();
    await expect(page).toHaveURL(new RegExp(`/track/${code}$`));
    await expect(page.getByText(`Order ${order.soNumber}`)).toBeVisible();
    await expect(page.getByRole("region", { name: "In this order" }).getByText("Portal-test cabinet")).toBeVisible();
    const html = await page.content();
    for (const secret of [SUPPLIER, "Demo Supplier", poNumber, "Internal:"]) expect(html, secret).not.toContain(secret);
  });

  test("a wrong code gets the same answer as a missing one", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/track");
    await page.getByLabel("Tracking code").fill("AAA-AAA-AAA");
    await page.getByRole("button", { name: "Track my order" }).click();
    await expect(page.getByText(/We couldn't find an order with that tracking code/)).toBeVisible();
    await page.goto("/track/ZZZ-ZZZ-ZZZ");
    await expect(page.getByRole("heading", { name: "We couldn't find that order" })).toBeVisible();
  });

  test("the customer writes in; a reply naming the supplier is blocked; a clean reply arrives", async ({ browser }) => {
    const customer = await (await browser.newContext()).newPage();
    await customer.goto(`/track/${code}`);
    await customer.getByLabel("Your message").fill("When will this arrive?");
    await customer.getByLabel("Your name (optional)").fill("Jo");
    await customer.getByRole("button", { name: "Send a message" }).click();
    await expect(customer.getByText(/Sent. We'll reply here/)).toBeVisible({ timeout: 15_000 });

    const staff = await as(browser, "sales@demo-a.coast.test");
    await staff.goto(`/app/orders/${order.orderId}`);
    const panel = staff.getByRole("region", { name: "Customer" });
    await expect(panel.getByText("● 1 new message")).toBeVisible();
    await expect(panel.getByText("When will this arrive?")).toBeVisible();

    await panel.getByLabel("Reply to the customer").fill(`It's coming from ${SUPPLIER} on ${poNumber}.`);
    await panel.getByRole("button", { name: "Send reply" }).click();
    await expect(panel.getByText(/wasn't sent/)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(new RegExp(poNumber))).toBeVisible();

    await panel.getByLabel("Reply to the customer").fill("It's due on Friday — we'll keep you posted.");
    await panel.getByRole("button", { name: "Send reply" }).click();
    await expect(panel.getByText(/^Sent\. The customer sees it/)).toBeVisible({ timeout: 15_000 });

    await customer.reload();
    await expect(customer.getByText("It's due on Friday — we'll keep you posted.")).toBeVisible();
    expect(await customer.content()).not.toContain(SUPPLIER);
  });

  test("the customer chooses email updates, and staff see who's told what", async ({ browser }) => {
    const customer = await (await browser.newContext()).newPage();
    await customer.goto(`/track/${code}#updates`);
    await customer.getByLabel("Email address").fill("jo@customer.coast.test");
    await customer.getByLabel("Every update").check();
    await customer.getByRole("button", { name: "Save email updates" }).click();
    await expect(customer.getByText(/Saved. Updates will go to that address./)).toBeVisible({ timeout: 15_000 });
    await customer.reload();
    await expect(customer.getByText("Updates go to j•••@customer.coast.test.")).toBeVisible();

    const staff = await as(browser, "sales@demo-a.coast.test");
    await staff.goto(`/app/orders/${order.orderId}`);
    await expect(staff.getByText("Email updates · jo@customer.coast.test")).toBeVisible();

    // A reply now reaches them by email (written and logged until email is connected).
    const panel = staff.getByRole("region", { name: "Customer" });
    await panel.getByLabel("Reply to the customer").fill("Booked for Friday.");
    await panel.getByRole("button", { name: "Send reply" }).click();
    await expect(panel.getByText(/^Sent\. The customer sees it/)).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        await staff.reload();
        return staff.getByRole("region", { name: "Customer" }).getByText("New reply: “Booked for Friday.”").count();
      }, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(staff.getByRole("region", { name: "Customer" }).getByText(/Written \(email not connected yet\) · to jo@customer.coast.test/)).toBeAttached();
  });

  test("staff invite (vouch for) the customer; their orders appear automatically, new ones too", async ({ browser }) => {
    const staff = await as(browser, "sales@demo-a.coast.test");
    await staff.goto(`/app/orders/${order.orderId}`);
    const panel = staff.getByRole("region", { name: "Customer" });
    await panel.getByText(/^COAST accounts/).click();
    await panel.getByLabel("Their name").fill("Jo Portal");
    await panel.getByLabel("Their email").fill(EMAIL);
    await panel.getByRole("button", { name: "Invite" }).click();
    const linkText = await panel.locator("code").filter({ hasText: "/auth/confirm" }).textContent({ timeout: 20_000 });
    const link = new URL(linkText!.trim());

    const customer = await (await browser.newContext()).newPage();
    await customer.goto(link.pathname + link.search);
    await expect(customer).toHaveURL(/\/auth\/set-password/);
    const pw = `${randomBytes(12).toString("base64url")}Aa1!`;
    await customer.getByLabel("New password").fill(pw);
    await customer.getByLabel("Type it again").fill(pw);
    await customer.getByRole("button", { name: "Save and continue" }).click();
    await expect(customer).toHaveURL(/\/portal$/, { timeout: 15_000 });
    // Grouped by supplier (the business), which adds their orders automatically.
    const group = customer.getByRole("region", { name: "[Demo Org A]" });
    await expect(group.getByRole("link", { name: order.soNumber })).toBeVisible();
    await expect(group.getByText("● Adds your orders automatically")).toBeVisible();

    // A brand-new order for the same customer turns up by itself.
    const service = serviceClient();
    const { data: cust } = await service.from("sales_orders").select("customer_id, org_id, sales_rep_id").eq("id", order.orderId).single();
    const { data: fresh } = await service
      .from("sales_orders")
      .insert({ org_id: cust!.org_id, customer_id: cust!.customer_id, sales_rep_id: cust!.sales_rep_id, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB" })
      .select("so_number")
      .single();
    await customer.reload();
    await expect(group.getByRole("link", { name: fresh!.so_number })).toBeVisible();

    // Their PO number, the order number or the supplier finds it.
    await customer.getByLabel("Find an order").fill(order.soNumber);
    await customer.keyboard.press("Enter");
    await expect(customer.getByRole("link", { name: order.soNumber })).toBeVisible();
    await expect(customer.getByRole("link", { name: fresh!.so_number })).toHaveCount(0);

    // A customer login can't get into the staff app.
    await customer.goto("/app/home");
    await expect(customer).toHaveURL(/\/sign-in/);

    // Sign out and back in on the customer sign-in page.
    await customer.goto("/portal");
    await customer.getByRole("button", { name: "Sign out" }).click();
    await expect(customer).toHaveURL(/\/portal\/sign-in/);
    await customer.getByLabel("Email").fill(EMAIL);
    await customer.getByLabel("Password").fill(pw);
    await customer.getByRole("button", { name: "Sign in" }).click();
    await expect(customer).toHaveURL(/\/portal$/, { timeout: 15_000 });

    // Staff can stop it.
    await staff.reload();
    await staff.getByRole("region", { name: "Customer" }).getByText(/^COAST accounts · 1/).click();
    staff.once("dialog", (d) => d.accept());
    await staff.getByRole("region", { name: "Customer" }).getByRole("button", { name: "Stop" }).click();
    await expect(staff.getByRole("region", { name: "Customer" }).getByText("Stopped.")).toBeVisible({ timeout: 15_000 });
  });

  test("a customer creates a free account from a tracking page, and adds orders with one click", async ({ browser }) => {
    test.setTimeout(60_000); // three journeys in one: sign up, one click, sign in and add
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/track/${code}`);
    await expect(page.getByRole("heading", { name: "Track all your deliveries in one place" })).toBeVisible();
    // The add button sits at the top of the page; signed out, it goes to sign in (with create-an-account there too).
    await expect(page.getByRole("banner").getByRole("link", { name: "Add to my COAST account" })).toHaveAttribute("href", `/portal/sign-in?add=${code}`);
    await expect(page.getByRole("link", { name: "Get COAST for your business" })).toBeVisible();
    await page.getByRole("link", { name: "Create a free account" }).click();
    await expect(page).toHaveURL(/\/portal\/sign-up\?add=/);
    await expect(page.getByLabel("Tracking code of an order to add (optional)")).toHaveValue(code);
    const pw = `${randomBytes(12).toString("base64url")}Aa1!`;
    // A staff address can't be used, and the message doesn't say why.
    await page.getByLabel("Your name").fill("Sam Self");
    await page.getByLabel("Email").fill("sales@demo-a.coast.test");
    await page.getByLabel("Choose a password").fill(pw);
    await page.getByLabel("Type it again").fill(pw);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/can't be used for a new account/)).toBeVisible({ timeout: 15_000 });
    // The real thing: straight back to the order, now in the account.
    await page.getByLabel("Tracking code of an order to add (optional)").fill(code);
    await page.getByLabel("Your name").fill("Sam Self");
    await page.getByLabel("Email").fill(SELF_EMAIL);
    await page.getByLabel("Choose a password").fill(pw);
    await page.getByLabel("Type it again").fill(pw);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(new RegExp(`/track/${code}\\?added=1$`), { timeout: 15_000 });
    await expect(page.getByText(/In your COAST account/)).toBeVisible();

    // A second order (any business) with one click on its tracking page.
    const service = serviceClient();
    const other = await createTestOrder(service, CUSTOMER, [{ description: "One-click item", quantity: 1, route: "from_stock" }]);
    const otherCode = (await service.from("sales_orders").select("tracking_code").eq("id", other.orderId).single()).data!.tracking_code;
    await page.goto(`/track/${otherCode}`);
    await page.getByRole("button", { name: "Add to my COAST account" }).click();
    await expect(page.getByText("✓ Added to your COAST account")).toBeVisible({ timeout: 15_000 });
    await page.goto("/portal");
    await expect(page.getByRole("link", { name: other.soNumber })).toBeVisible();
    await expect(page.getByText("Sam Self")).toBeVisible();
    // Self-made accounts aren't vouched for, so nothing is added automatically.
    await expect(page.getByText("● Adds your orders automatically")).toHaveCount(0);

    // Signed out, the top button signs them in and brings them back with the order added.
    await page.getByRole("button", { name: "Sign out" }).click();
    const third = await createTestOrder(service, CUSTOMER, [{ description: "Sign-in-and-add item", quantity: 1, route: "from_stock" }]);
    const thirdCode = (await service.from("sales_orders").select("tracking_code").eq("id", third.orderId).single()).data!.tracking_code;
    await page.goto(`/track/${thirdCode}`);
    await page.getByRole("banner").getByRole("link", { name: "Add to my COAST account" }).click();
    await expect(page).toHaveURL(/\/portal\/sign-in\?add=/);
    await page.getByLabel("Email").fill(SELF_EMAIL);
    await page.getByLabel("Password").fill(pw);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`/track/${thirdCode}\\?added=1$`), { timeout: 15_000 });
    await expect(page.getByRole("banner").getByText("✓ In your COAST account")).toBeVisible();
  });

  test("a business owner registers interest from a tracking page", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/track/${code}`);
    await page.getByRole("link", { name: "Get COAST for your business" }).click();
    await expect(page).toHaveURL(/\/get-coast\?ref=track/);
    await page.getByLabel("Your name").fill("Pat Prospect");
    await page.getByLabel("Company").fill("[Prospect Ltd]");
    await page.getByLabel("Work email").fill(LEAD_EMAIL);
    await page.getByLabel("How many people work there?").selectOption("11-50");
    await page.getByRole("button", { name: "Register interest" }).click();
    await expect(page.getByText(/got your details/)).toBeVisible({ timeout: 15_000 });
    const { data } = await serviceClient().from("leads").select("source, company_size, referrer_org").eq("email", LEAD_EMAIL).single();
    expect(data).toMatchObject({ source: "tracking_page", company_size: "11-50" });
    expect(data!.referrer_org).not.toBeNull();
  });

  test("a new tracking code stops the old one working", async ({ browser }) => {
    const staff = await as(browser, "sales@demo-a.coast.test");
    await staff.goto(`/app/orders/${order.orderId}`);
    staff.once("dialog", (d) => d.accept());
    await staff.getByRole("button", { name: "Make a new code" }).click();
    await expect(staff.getByText(/The old one no longer works/)).toBeVisible({ timeout: 15_000 });
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/track/${code}`);
    await expect(anon.getByRole("heading", { name: "We couldn't find that order" })).toBeVisible();
  });
});
