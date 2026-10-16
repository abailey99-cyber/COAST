/**
 * Branches (Phase 7b), against the dev database, as real users.
 * Step 1: every organisation has exactly one default branch, every order and
 * sales rep is in a branch of their own organisation, and nothing can point
 * across organisations.
 * Step 2: a rep in one branch can't read another branch's orders or anything
 * hanging off them; grants, assignment, the switch and "See every branch"
 * all work as src/lib/logic/branches.ts says.
 */

import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canSeeOrder } from "@/lib/logic/branches";
import { resolvePermissions } from "@/lib/logic/permissions";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(url && anonKey && serviceKey && password) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const CUSTOMER = "[RLS branches customer]";

describe.skipIf(!enabled)("branches", { timeout: 60_000 }, () => {
  let service: SupabaseClient;
  let adminA: SupabaseClient, salesA: SupabaseClient, adminB: SupabaseClient;
  let orgA: string, orgB: string, customerA: string, defaultA: string, defaultB: string, salesAId: string;
  const branchIds: string[] = [];
  const orderIds: string[] = [];

  const signIn = async (email: string) => {
    const c = createClient(url!, anonKey!, opts);
    const { error } = await c.auth.signInWithPassword({ email, password: password! });
    if (error) throw new Error(`Sign in ${email}: ${error.message} (run npm run db:seed-demo)`);
    return c;
  };
  const newOrder = async (extra: Record<string, unknown>) => {
    const { data, error } = await service
      .from("sales_orders")
      .insert({ org_id: orgA, customer_id: customerA, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB", ...extra })
      .select("id, branch_id")
      .single();
    if (error) throw new Error(error.message);
    orderIds.push(data.id);
    return data as { id: string; branch_id: string };
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    orgA = (await service.from("organisations").select("id").eq("slug", "demo-org-a").single()).data!.id;
    orgB = (await service.from("organisations").select("id").eq("slug", "demo-org-b").single()).data!.id;
    defaultA = (await service.from("branches").select("id").eq("org_id", orgA).eq("is_default", true).single()).data!.id;
    defaultB = (await service.from("branches").select("id").eq("org_id", orgB).eq("is_default", true).single()).data!.id;
    customerA = (await service.from("customers").insert({ org_id: orgA, name: CUSTOMER }).select("id").single()).data!.id;
    salesAId = (await service.from("staff_users").select("id").eq("email", "sales@demo-a.coast.test").single()).data!.id;
    [adminA, salesA, adminB] = await Promise.all([signIn("admin@demo-a.coast.test"), signIn("sales@demo-a.coast.test"), signIn("admin@demo-b.coast.test")]);
  }, 60_000);

  afterAll(async () => {
    await service.from("staff_users").update({ home_branch_id: defaultA }).eq("id", salesAId);
    for (const id of orderIds) await service.from("sales_orders").delete().eq("id", id);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    for (const id of branchIds) await service.from("branches").delete().eq("id", id);
  });

  it("gives every organisation exactly one default branch, active", async () => {
    const { data: orgs } = await service.from("organisations").select("id");
    const { data: defaults } = await service.from("branches").select("org_id, is_active").eq("is_default", true);
    expect(defaults!.length).toBe(orgs!.length);
    expect(new Set(defaults!.map((d) => d.org_id)).size).toBe(orgs!.length);
    expect(defaults!.every((d) => d.is_active)).toBe(true);
  });

  it("puts every order in a branch, and every sales rep in a home branch", async () => {
    expect((await service.from("sales_orders").select("id", { count: "exact", head: true }).is("branch_id", null)).count).toBe(0);
    const { count } = await service.from("staff_users").select("id", { count: "exact", head: true }).in("role", ["sales", "sales_manager"]).is("home_branch_id", null);
    expect(count).toBe(0);
  });

  it("starts a new organisation with its own default branch", async () => {
    const slug = `branch-test-${Date.now()}`;
    const { data: org } = await service.from("organisations").insert({ name: "[Branch test org]", slug }).select("id").single();
    try {
      const { data } = await service.from("branches").select("name, code, is_default").eq("org_id", org!.id);
      expect(data).toEqual([{ name: "Main branch", code: "MAIN", is_default: true }]);
    } finally {
      await service.from("organisations").delete().eq("id", org!.id);
    }
  });

  it("refuses a second default, and refuses to switch the default off", async () => {
    const { data: extra, error } = await service.from("branches").insert({ org_id: orgA, name: "[Test branch]", code: "TST1" }).select("id").single();
    expect(error).toBeNull();
    branchIds.push(extra!.id);
    expect((await service.from("branches").update({ is_default: true }).eq("id", extra!.id)).error).not.toBeNull();
    expect((await service.from("branches").update({ is_default: false }).eq("id", defaultA)).error).not.toBeNull();
    expect((await service.from("branches").update({ is_active: false }).eq("id", defaultA)).error).not.toBeNull();
  });

  it("puts a new order in its creator's home branch, else the default; a chosen branch is kept", async () => {
    const other = branchIds[0]!;
    await service.from("staff_users").update({ home_branch_id: other }).eq("id", salesAId);
    expect((await newOrder({ created_by: salesAId })).branch_id).toBe(other);
    expect((await newOrder({})).branch_id).toBe(defaultA);
    expect((await newOrder({ created_by: salesAId, branch_id: defaultA })).branch_id).toBe(defaultA);
    // An inactive home branch isn't used.
    await service.from("branches").update({ is_active: false }).eq("id", other);
    expect((await newOrder({ created_by: salesAId })).branch_id).toBe(defaultA);
    await service.from("branches").update({ is_active: true }).eq("id", other);
  });

  it("can't point an order, a home branch or a grant at another organisation's branch", async () => {
    expect((await newOrder({ branch_id: defaultA })).branch_id).toBe(defaultA);
    const crossOrder = await service.from("sales_orders").update({ branch_id: defaultB }).eq("id", orderIds.at(-1)!);
    expect(crossOrder.error).not.toBeNull();
    expect((await service.from("staff_users").update({ home_branch_id: defaultB }).eq("id", salesAId)).error).not.toBeNull();
    expect((await service.from("user_branch_access").insert({ org_id: orgA, staff_id: salesAId, branch_id: defaultB })).error).not.toBeNull();
    expect((await service.from("user_branch_access").insert({ org_id: orgB, staff_id: salesAId, branch_id: defaultB })).error).not.toBeNull();
  });

  it("lets only an admin add a branch, and each organisation sees only its own", async () => {
    expect((await salesA.from("branches").insert({ org_id: orgA, name: "[Rep branch]", code: "REP1" }).select()).error).not.toBeNull();
    const { data, error } = await adminA.from("branches").insert({ org_id: orgA, name: "[Admin branch]", code: "ADM1" }).select("id").single();
    expect(error).toBeNull();
    branchIds.push(data!.id);
    expect((await adminB.from("branches").insert({ org_id: orgA, name: "[Wrong org]", code: "BAD1" }).select()).error).not.toBeNull();
    const seenByB = (await adminB.from("branches").select("org_id")).data!;
    expect(seenByB.length).toBeGreaterThan(0);
    expect(seenByB.every((b) => b.org_id === orgB)).toBe(true);
    expect((await salesA.from("branches").select("id")).data!.map((b) => b.id)).toContain(defaultA);
  });

  it("lets a person see their own extra branches but not other people's; only admins grant", async () => {
    const other = branchIds[0]!;
    expect((await salesA.from("user_branch_access").insert({ org_id: orgA, staff_id: salesAId, branch_id: other, granted_by: salesAId })).error).not.toBeNull();
    const adminId = (await service.from("staff_users").select("id").eq("email", "admin@demo-a.coast.test").single()).data!.id;
    expect((await adminA.from("user_branch_access").insert({ org_id: orgA, staff_id: salesAId, branch_id: other, granted_by: adminId })).error).toBeNull();
    expect((await salesA.from("user_branch_access").select("branch_id")).data).toEqual([{ branch_id: other }]);
    expect((await adminB.from("user_branch_access").select("branch_id").eq("staff_id", salesAId)).data).toEqual([]);
    expect((await adminA.from("user_branch_access").delete().eq("staff_id", salesAId).eq("branch_id", other).select()).data).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("branch security rules", { timeout: 90_000 }, () => {
  let service: SupabaseClient;
  const users: Record<string, SupabaseClient> = {};
  const userIds: Record<string, string> = {};
  let orgA: string, mainA: string, south: string, customerA: string, supplierA: string;
  // Orders: one in the main branch, one in the south branch, one in south assigned to the rep.
  let oMain: string, oSouth: string, oAssigned: string, poSouth: string, shipmentSouth: string;
  const orderIds: string[] = [];

  const signIn = async (email: string) => {
    const c = createClient(url!, anonKey!, opts);
    const { error } = await c.auth.signInWithPassword({ email, password: password! });
    if (error) throw new Error(`Sign in ${email}: ${error.message} (run npm run db:seed-demo)`);
    return c;
  };
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await service.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id as string;
  };
  const order = async (branch: string, rep: string | null) => {
    const id = await insert("sales_orders", { org_id: orgA, customer_id: customerA, branch_id: branch, sales_rep_id: rep, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB" });
    orderIds.push(id);
    return id;
  };
  const sees = async (who: string, id: string) => ((await users[who]!.from("sales_orders").select("id").eq("id", id)).data ?? []).length === 1;
  const setOrg = (restrict: boolean) => service.from("organisations").update({ restrict_sales_to_branch: restrict }).eq("id", orgA);

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    orgA = (await service.from("organisations").select("id").eq("slug", "demo-org-a").single()).data!.id;
    mainA = (await service.from("branches").select("id").eq("org_id", orgA).eq("is_default", true).single()).data!.id;
    // Tidy up after a run that was cut short.
    const { data: leftover } = await service.from("customers").select("id").eq("org_id", orgA).eq("name", `${CUSTOMER} 2`).maybeSingle();
    if (leftover) {
      const { data: old } = await service.from("sales_orders").select("id").eq("customer_id", leftover.id);
      const oldIds = (old ?? []).map((o) => o.id as string);
      const { data: oldLines } = await service.from("order_lines").select("id").in("sales_order_id", oldIds);
      const { data: oldPos } = await service.from("purchase_order_lines").select("purchase_order_id").in("order_line_id", (oldLines ?? []).map((l) => l.id as string));
      await service.from("purchase_orders").delete().in("id", (oldPos ?? []).map((p) => p.purchase_order_id as string));
      await service.from("sales_orders").delete().in("id", oldIds);
      await service.from("customers").delete().eq("id", leftover.id);
    }
    await service.from("branches").delete().eq("org_id", orgA).eq("code", "STH");
    south = await insert("branches", { org_id: orgA, name: "[Test south branch]", code: "STH" });
    customerA = await insert("customers", { org_id: orgA, name: `${CUSTOMER} 2` });
    supplierA = (await service.from("suppliers").select("id").eq("org_id", orgA).limit(1).single()).data!.id;
    for (const role of ["sales", "salesmanager", "procurement", "director", "admin"]) {
      const email = `${role}@demo-a.coast.test`;
      users[role] = await signIn(email);
      userIds[role] = (await service.from("staff_users").select("id").eq("email", email).single()).data!.id;
    }
    await service.from("staff_users").update({ home_branch_id: mainA }).eq("id", userIds.sales!);

    oMain = await order(mainA, null);
    oSouth = await order(south, null);
    oAssigned = await order(south, userIds.sales!);
    // Everything that hangs off the south order.
    const line = await insert("order_lines", { sales_order_id: oSouth, line_no: 1, description: "Thing", quantity: 1, unit_price_minor: 100, route: "direct_ship", stage: "ordered" });
    poSouth = await insert("purchase_orders", { org_id: orgA, supplier_id: supplierA, currency: "GBP", status: "sent" });
    await insert("purchase_order_lines", { purchase_order_id: poSouth, order_line_id: line, quantity: 1 });
    await insert("outbound_emails", { org_id: orgA, kind: "po", purchase_order_id: poSouth, to_address: "s@example.test", subject: "PO", body_text: "x", body_html: "x", channel: "log", status: "logged" });
    await insert("supplier_responses", { org_id: orgA, purchase_order_id: poSouth, source: "paste", confidence: "low", status: "needs_review" });
    await insert("chases", { org_id: orgA, kind: "supplier", purchase_order_id: poSouth });
    await insert("chases", { org_id: orgA, kind: "internal", sales_order_id: oSouth, order_line_id: line, opened_by: userIds.procurement });
    shipmentSouth = await insert("shipments", { org_id: orgA, sales_order_id: oSouth, leg: "outbound", carrier: "dhl", tracking_number: `BR${Date.now()}`, status: "in_transit" });
    await service.from("tracking_events").insert({ shipment_id: shipmentSouth, event_key: "branch-test", occurred_at: new Date().toISOString(), status: "in_transit", description: "Moving", source: "manual" });
    await insert("order_messages", { org_id: orgA, sales_order_id: oSouth, author_kind: "customer", customer_name: "C", body: "Where is it?" });
    await insert("delivery_exceptions", { org_id: orgA, sales_order_id: oSouth, raised_via: "staff", category: "damaged", description: "Box crushed" });
  }, 60_000);

  afterAll(async () => {
    await setOrg(true);
    await service.from("staff_users").update({ home_branch_id: mainA }).eq("id", userIds.sales!);
    await service.from("user_branch_access").delete().eq("branch_id", south);
    await service.from("purchase_orders").delete().eq("id", poSouth);
    for (const id of orderIds) await service.from("sales_orders").delete().eq("id", id);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", `${CUSTOMER} 2`);
    await service.from("branches").delete().eq("id", south);
  });

  /** Everything on or under the south order, as the given person sees it. */
  async function southTrail(who: string) {
    const c = users[who]!;
    const count = async (table: string, col: string, val: string) => ((await c.from(table).select("*").eq(col, val)).data ?? []).length;
    return {
      order: await count("sales_orders", "id", oSouth),
      lines: await count("order_lines", "sales_order_id", oSouth),
      history: await count("order_events", "sales_order_id", oSouth),
      po: await count("purchase_orders", "id", poSouth),
      poLines: await count("purchase_order_lines", "purchase_order_id", poSouth),
      poEmails: await count("outbound_emails", "purchase_order_id", poSouth),
      supplierAnswers: await count("supplier_responses", "purchase_order_id", poSouth),
      supplierChases: await count("chases", "purchase_order_id", poSouth),
      internalChases: await count("chases", "sales_order_id", oSouth),
      shipments: await count("shipments", "sales_order_id", oSouth),
      tracking: await count("tracking_events", "shipment_id", shipmentSouth),
      messages: await count("order_messages", "sales_order_id", oSouth),
      problems: await count("delivery_exceptions", "sales_order_id", oSouth),
    };
  }
  const visible = (t: Record<string, number>) => Object.entries(t).filter(([, n]) => n > 0).map(([k]) => k);
  const hidden = (t: Record<string, number>) => Object.entries(t).filter(([, n]) => n === 0).map(([k]) => k);

  it("hides another branch's order, and everything on it, from a restricted rep", async () => {
    expect(await sees("sales", oMain)).toBe(true);
    expect(visible(await southTrail("sales")), "visible to a main-branch rep").toEqual([]);
  });

  it("always shows an order assigned to them, whatever its branch", async () => {
    expect(await sees("sales", oAssigned)).toBe(true);
  });

  it("shows a granted branch at once, and hides it again the moment it's revoked", async () => {
    expect((await users.admin!.from("user_branch_access").insert({ org_id: orgA, staff_id: userIds.sales, branch_id: south, granted_by: userIds.admin })).error).toBeNull();
    expect(hidden(await southTrail("sales")), "hidden from a granted rep").toEqual([]);
    await users.admin!.from("user_branch_access").delete().eq("staff_id", userIds.sales!).eq("branch_id", south);
    expect(await sees("sales", oSouth)).toBe(false);
  });

  it("with the restriction off, shows reps every branch — still read-only", async () => {
    await setOrg(false);
    try {
      expect(await sees("sales", oSouth)).toBe(true);
      expect((await users.sales!.from("sales_orders").update({ customer_reference: "nope" }).eq("id", oSouth).select()).data ?? []).toEqual([]);
    } finally {
      await setOrg(true);
    }
  });

  it("shows admin, procurement, director and sales manager every branch; the director still can't change anything", async () => {
    for (const who of ["admin", "procurement", "director", "salesmanager"]) expect(hidden(await southTrail(who)), who).toEqual([]);
    expect((await users.director!.from("sales_orders").update({ customer_reference: "nope" }).eq("id", oSouth).select()).data ?? []).toEqual([]);
  });

  it("shows a rep with no branch only the orders assigned to them", async () => {
    await service.from("staff_users").update({ home_branch_id: null }).eq("id", userIds.sales!);
    try {
      expect(await sees("sales", oMain)).toBe(false);
      expect(await sees("sales", oAssigned)).toBe(true);
    } finally {
      await service.from("staff_users").update({ home_branch_id: mainA }).eq("id", userIds.sales!);
    }
  });

  it("agrees with the app's own rule for every order", async () => {
    const grants = ((await service.from("role_permissions").select("permission").eq("org_id", orgA).eq("role", "sales")).data ?? []).map((r) => r.permission as string);
    const overrides = ((await service.from("staff_permission_overrides").select("permission, granted").eq("user_id", userIds.sales!)).data ?? []) as { permission: string; granted: boolean }[];
    const v = { userId: userIds.sales!, permissions: resolvePermissions("sales", grants, overrides), homeBranchId: mainA, grantedBranchIds: [], restrictSalesToBranch: true };
    for (const [id, branchId, rep] of [[oMain, mainA, null], [oSouth, south, null], [oAssigned, south, userIds.sales!]] as const) {
      const expected = canSeeOrder(v, { branchId, salesRepId: rep });
      expect(await sees("sales", id), id).toBe(expected);
      expect((await users.sales!.rpc("current_user_can_see_order", { p_order: id })).data, id).toBe(expected);
    }
  });

  it("lets procurement move an order to another branch, logged; not a sales manager, and never into a switched-off branch", async () => {
    // A sales manager can't edit orders at all, so the move simply finds nothing to change.
    expect((await users.salesmanager!.from("sales_orders").update({ branch_id: mainA }).eq("id", oSouth).select()).data ?? []).toEqual([]);
    // Someone who edits orders but doesn't see every branch is refused outright.
    await service.from("staff_permission_overrides").upsert({ user_id: userIds.salesmanager, permission: "orders.edit", granted: true }, { onConflict: "user_id,permission" });
    await service.from("staff_permission_overrides").upsert({ user_id: userIds.salesmanager, permission: "branches.view_all", granted: false }, { onConflict: "user_id,permission" });
    await service.from("user_branch_access").insert({ org_id: orgA, staff_id: userIds.salesmanager, branch_id: south });
    try {
      expect((await users.salesmanager!.from("sales_orders").update({ branch_id: mainA }).eq("id", oSouth).select()).error).not.toBeNull();
    } finally {
      await service.from("staff_permission_overrides").delete().eq("user_id", userIds.salesmanager!).in("permission", ["orders.edit", "branches.view_all"]);
      await service.from("user_branch_access").delete().eq("staff_id", userIds.salesmanager!).eq("branch_id", south);
    }
    expect((await service.from("sales_orders").select("branch_id").eq("id", oSouth).single()).data!.branch_id).toBe(south);
    const moved = await users.procurement!.from("sales_orders").update({ branch_id: mainA }).eq("id", oSouth).select("branch_id");
    expect(moved.error).toBeNull();
    expect(moved.data).toEqual([{ branch_id: mainA }]);
    const { data: ev } = await service.from("order_events").select("detail").eq("sales_order_id", oSouth).eq("kind", "order_updated").order("created_at", { ascending: false }).limit(1).single();
    expect(ev!.detail).toEqual({ fields: ["branch"] });
    await service.from("branches").update({ is_active: false }).eq("id", south);
    try {
      expect((await users.procurement!.from("sales_orders").update({ branch_id: south }).eq("id", oSouth).select()).error).not.toBeNull();
    } finally {
      await service.from("branches").update({ is_active: true }).eq("id", south);
      await service.from("sales_orders").update({ branch_id: south }).eq("id", oSouth);
    }
  });

  it("won't let a restricted rep create an order in another branch", async () => {
    // Sales reps can't create orders by default; give this one the right for the test.
    await service.from("staff_permission_overrides").upsert({ user_id: userIds.sales, permission: "orders.edit", granted: true }, { onConflict: "user_id,permission" });
    try {
      const row = { org_id: orgA, customer_id: customerA, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB" };
      expect((await users.sales!.from("sales_orders").insert({ ...row, branch_id: south }).select("id")).error).not.toBeNull();
      const own = await users.sales!.from("sales_orders").insert(row).select("id, branch_id").single();
      expect(own.error).toBeNull();
      orderIds.push(own.data!.id);
      expect(own.data!.branch_id).toBe(mainA);
    } finally {
      await service.from("staff_permission_overrides").delete().eq("user_id", userIds.sales!).eq("permission", "orders.edit");
    }
  });
});
