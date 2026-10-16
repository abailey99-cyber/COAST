/**
 * The cross-tenant harness (readiness plan Task 5A). For EVERY table in the
 * database, a signed-in user of every role in one organisation tries to
 * read, change and delete the other organisation's rows — both ways round.
 *
 * - The table list comes from the database itself, so a new table that
 *   isn't covered here fails the run ("every new table must join it").
 * - Each table's organisation is worked out from its own `org_id`, or by
 *   following its foreign keys up to one that has it.
 * - Updates set a column to the value it already has, so even a failure
 *   changes nothing. Deletes are only tried on throwaway rows made here.
 *
 * Needs the demo users from `npm run db:seed-demo` (every role in both
 * organisations) and the dev database. Runs against the Supabase project in
 * .env.local; skipped in CI until CI has a database (KNOWN-GAPS.md).
 */

import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(url && anonKey && serviceKey && password) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

const ROLES = ["admin", "procurement", "salesmanager", "sales", "director", "goodsin"] as const;
const ORGS = ["a", "b"] as const;

/** Shared reference data every organisation reads (and nobody signed in can change). */
const SHARED_REFERENCE = new Set(["currencies", "permissions", "permission_defaults"]);
/**
 * Platform-wide, not organisation data: per-carrier call counts for the
 * shared carrier allowance. UNVERIFIED as tenant-safe by design only; it goes
 * per organisation with aggregator tracking (Task 4).
 */
const PLATFORM_WIDE = new Set(["carrier_activity"]);
/** People rather than organisation rows: checked by their own rule below. */
const PEOPLE = new Set(["customer_accounts"]);
/** Must show up in both organisations, or the harness proves nothing for them. */
const MUST_HAVE_ROWS = ["organisations", "staff_users", "role_permissions", "customers", "suppliers", "sales_orders", "order_lines", "purchase_orders", "purchase_order_lines", "order_messages", "chase_settings", "customer_page_settings", "customs_settings", "prediction_settings"];

interface TableInfo {
  name: string;
  columns: string[];
  pk: string[];
  fks: { column: string; table: string; target: string }[];
}
type OrgPath = { kind: "direct" } | { kind: "self" } | { kind: "via"; column: string; table: string; target: string };

async function loadSchema(): Promise<Map<string, TableInfo>> {
  const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } });
  const doc = (await res.json()) as { definitions: Record<string, { properties?: Record<string, { description?: string }> }> };
  const out = new Map<string, TableInfo>();
  for (const [name, def] of Object.entries(doc.definitions)) {
    const props = def.properties ?? {};
    out.set(name, {
      name,
      columns: Object.keys(props),
      pk: Object.entries(props).filter(([, p]) => /Primary Key/.test(p.description ?? "")).map(([c]) => c),
      fks: Object.entries(props).flatMap(([c, p]) => {
        const m = (p.description ?? "").match(/Foreign Key to `([a-z_]+)\.([a-z_]+)`/);
        return m ? [{ column: c, table: m[1]!, target: m[2]! }] : [];
      }),
    });
  }
  return out;
}

describe.skipIf(!enabled)("cross-tenant harness: every table, every role, both ways", () => {
  let service: SupabaseClient;
  let schema: Map<string, TableInfo>;
  let report: { table_name: string; rls_enabled: boolean; authenticated_privileges: string[]; anon_privileges: string[] }[];
  let updatable: Map<string, string[]>;
  const orgId: Record<string, string> = {};
  const users: Record<string, SupabaseClient> = {};
  const paths = new Map<string, OrgPath | null>();
  const fixtures: { table: string; match: Record<string, string> }[] = [];

  function orgPath(table: string, seen = new Set<string>()): OrgPath | null {
    if (paths.has(table)) return paths.get(table)!;
    const t = schema.get(table);
    let p: OrgPath | null = null;
    if (!t || seen.has(table)) return null;
    if (table === "organisations") p = { kind: "self" };
    else if (t.columns.includes("org_id")) p = { kind: "direct" };
    else {
      for (const fk of t.fks) {
        if (orgPath(fk.table, new Set([...seen, table]))) {
          p = { kind: "via", column: fk.column, table: fk.table, target: fk.target };
          break;
        }
      }
    }
    paths.set(table, p);
    return p;
  }

  /** Values of `column` on up to `limit` of an organisation's rows in `table` (service role). */
  async function valuesOfOrg(table: string, column: string, org: string, limit: number): Promise<string[]> {
    const rows = await rowsOfOrg(table, org, limit, column);
    return rows.map((r) => String(r[column]));
  }

  async function rowsOfOrg(table: string, org: string, limit: number, columns = "*"): Promise<Record<string, unknown>[]> {
    const p = orgPath(table);
    if (!p) return [];
    let q = service.from(table).select(columns).limit(limit);
    if (p.kind === "self") q = q.eq("id", org);
    else if (p.kind === "direct") q = q.eq("org_id", org);
    else {
      const parents = await valuesOfOrg(p.table, p.target, org, 100);
      if (parents.length === 0) return [];
      q = q.in(p.column, parents);
    }
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as unknown as Record<string, unknown>[];
  }

  const matchRow = (t: TableInfo, row: Record<string, unknown>) => Object.fromEntries(t.pk.map((c) => [c, String(row[c])]));

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    schema = await loadSchema();
    const r1 = await service.rpc("security_table_report");
    const r2 = await service.rpc("security_update_columns");
    if (r1.error || r2.error) throw new Error(`Security reports unavailable: ${(r1.error ?? r2.error)!.message}`);
    report = r1.data;
    updatable = new Map();
    for (const r of r2.data as { table_name: string; column_name: string }[]) updatable.set(r.table_name, [...(updatable.get(r.table_name) ?? []), r.column_name]);

    for (const o of ORGS) orgId[o] = (await service.from("organisations").select("id").eq("slug", `demo-org-${o}`).single()).data!.id;
    for (const o of ORGS)
      for (const role of ROLES) {
        const c = createClient(url!, anonKey!, opts);
        const { error } = await c.auth.signInWithPassword({ email: `${role}@demo-${o}.coast.test`, password: password! });
        if (error) throw new Error(`Sign in ${role}@demo-${o} failed (run npm run db:seed-demo): ${error.message}`);
        users[`${role}@${o}`] = c;
      }

    // Throwaway rows in both organisations for every table signed-in users may delete from.
    for (const o of ORGS) {
      const { data: someone } = await service.from("staff_users").select("id").eq("org_id", orgId[o]!).eq("role", "sales").limit(1).single();
      const sku = `HARNESS-${o.toUpperCase()}-${Date.now()}`;
      await service.from("product_availability").insert({ org_id: orgId[o], sku, available_in_days: 3, source: "manual" });
      fixtures.push({ table: "product_availability", match: { org_id: orgId[o]!, sku } });
      await service.from("role_permissions").delete().eq("org_id", orgId[o]!).eq("role", "goods_in").eq("permission", "section.metrics");
      await service.from("role_permissions").insert({ org_id: orgId[o], role: "goods_in", permission: "section.metrics" });
      fixtures.push({ table: "role_permissions", match: { org_id: orgId[o]!, role: "goods_in", permission: "section.metrics" } });
      await service.from("staff_permission_overrides").upsert({ user_id: someone!.id, permission: "section.goods-in", granted: false, set_by: null }, { onConflict: "user_id,permission" });
      fixtures.push({ table: "staff_permission_overrides", match: { user_id: someone!.id, permission: "section.goods-in" } });
    }
  }, 120_000);

  afterAll(async () => {
    for (const f of fixtures) {
      let q = service.from(f.table).delete();
      for (const [k, v] of Object.entries(f.match)) q = q.eq(k, v);
      await q;
    }
  });

  it("has row-level security on every table, and nothing for signed-out visitors", () => {
    expect(report.length).toBeGreaterThan(40);
    expect(report.filter((t) => !t.rls_enabled).map((t) => t.table_name)).toEqual([]);
    expect(report.filter((t) => t.anon_privileges.length > 0).map((t) => t.table_name)).toEqual([]);
  });

  it("knows how every table belongs to an organisation — a new table must be covered", () => {
    const uncovered = report
      .filter((t) => t.authenticated_privileges.length > 0)
      .map((t) => t.table_name)
      .filter((t) => !SHARED_REFERENCE.has(t) && !PLATFORM_WIDE.has(t) && !PEOPLE.has(t) && !orgPath(t));
    expect(uncovered, "tables with no route to an organisation: add them to the harness").toEqual([]);
  });

  it("has a throwaway row for every table staff can delete from", () => {
    const deletable = report.filter((t) => t.authenticated_privileges.includes("DELETE")).map((t) => t.table_name).sort();
    expect([...new Set(fixtures.map((f) => f.table))].sort()).toEqual(deletable);
  });

  it("has data on both sides for the core tables", async () => {
    for (const t of MUST_HAVE_ROWS) for (const o of ORGS) expect((await rowsOfOrg(t, orgId[o]!, 1)).length, `${t} in org ${o}`).toBeGreaterThan(0);
  });

  it("(control) the same read check does find rows in a user's own organisation, so a pass means something", async () => {
    for (const o of ORGS)
      for (const table of ["sales_orders", "order_lines", "purchase_order_lines", "order_messages", "customs_settings"]) {
        const t = schema.get(table)!;
        const [row] = await rowsOfOrg(table, orgId[o]!, 1);
        let read = users[`admin@${o}`]!.from(table).select(t.pk.join(","));
        for (const [k, v] of Object.entries(matchRow(t, row!))) read = read.eq(k, v);
        expect((await read).data?.length, `${table} in org ${o}`).toBe(1);
      }
  });

  for (const [mine, theirs] of [["b", "a"], ["a", "b"]] as const) {
    it(`never lets organisation ${mine.toUpperCase()} read or change organisation ${theirs.toUpperCase()}'s rows`, async () => {
      const leaks: string[] = [];
      const tables = report.filter((t) => t.authenticated_privileges.length > 0 && orgPath(t.table_name) && !SHARED_REFERENCE.has(t.table_name) && !PLATFORM_WIDE.has(t.table_name));
      for (const { table_name: table } of tables) {
        const t = schema.get(table)!;
        if (t.pk.length === 0) continue;
        const rows = await rowsOfOrg(table, orgId[theirs]!, 3);
        const col = (updatable.get(table) ?? []).find((c) => !t.pk.includes(c));
        await Promise.all(
          ROLES.map(async (role) => {
            const db = users[`${role}@${mine}`]!;
            for (const row of rows) {
              const match = matchRow(t, row);
              let read = db.from(table).select(t.pk.join(","));
              for (const [k, v] of Object.entries(match)) read = read.eq(k, v);
              const r = await read;
              if (!r.error && (r.data?.length ?? 0) > 0) leaks.push(`${role}@${mine} can READ ${table} ${JSON.stringify(match)}`);
              if (col) {
                // Set it to the value it already has: harmless even if it got through.
                let upd = db.from(table).update({ [col]: row[col] }).select(t.pk[0]!);
                for (const [k, v] of Object.entries(match)) upd = upd.eq(k, v);
                const u = await upd;
                if (!u.error && (u.data?.length ?? 0) > 0) leaks.push(`${role}@${mine} can UPDATE ${table}.${col} ${JSON.stringify(match)}`);
              }
            }
          }),
        );
      }
      expect(leaks).toEqual([]);
    }, 300_000);

    it(`never lets organisation ${mine.toUpperCase()} delete organisation ${theirs.toUpperCase()}'s rows`, async () => {
      const leaks: string[] = [];
      for (const f of fixtures.filter((x) => Object.values(x.match).includes(orgId[theirs]!) || x.table === "staff_permission_overrides")) {
        const owner = f.table === "staff_permission_overrides" ? (await service.from("staff_users").select("org_id").eq("id", f.match.user_id!).single()).data!.org_id : f.match.org_id;
        if (owner !== orgId[theirs]) continue;
        for (const role of ROLES) {
          let del = users[`${role}@${mine}`]!.from(f.table).delete().select();
          for (const [k, v] of Object.entries(f.match)) del = del.eq(k, v);
          const d = await del;
          if (!d.error && (d.data?.length ?? 0) > 0) leaks.push(`${role}@${mine} can DELETE ${f.table} ${JSON.stringify(f.match)}`);
        }
      }
      expect(leaks).toEqual([]);
    }, 120_000);
  }

  it("only shows staff the customer accounts linked to their own organisation", async () => {
    const leaks: string[] = [];
    for (const o of ORGS)
      for (const role of ROLES) {
        const { data } = await users[`${role}@${o}`]!.from("customer_accounts").select("user_id");
        for (const a of data ?? []) {
          const { data: links } = await service.from("customer_account_links").select("org_id").eq("user_id", a.user_id);
          if (!(links ?? []).some((l) => l.org_id === orgId[o])) leaks.push(`${role}@${o} sees customer account ${a.user_id}`);
        }
      }
    expect(leaks).toEqual([]);
  });
});
