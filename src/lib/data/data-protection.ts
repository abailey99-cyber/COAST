import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_DROP_COLUMNS, type OrgRoute } from "@/lib/logic/data-protection";

/**
 * Data protection (readiness Task 6). Reads and writes only. The export,
 * person and retention functions use the service role with an explicit
 * organisation id; settings and counts use the admin's own client (RLS).
 */

const PAGE = 1000;

/** Every row of one table that belongs to the organisation (service role). Secrets and link codes are dropped. */
export async function exportTableRows(admin: SupabaseClient, table: string, route: OrgRoute, orgId: string, parentIds: ReadonlyMap<string, string[]>): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const drop = EXPORT_DROP_COLUMNS[table] ?? [];
  const pull = async (apply: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => typeof q) => {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await apply(admin.from(table).select("*")).range(from, from + PAGE - 1);
      if (error) throw new Error(`Couldn't export ${table}: ${error.message}`);
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        for (const c of drop) delete r[c];
        rows.push(r);
      }
      if ((data?.length ?? 0) < PAGE) break;
    }
  };
  if (route.kind === "self") await pull((q) => q.eq("id", orgId));
  else if (route.kind === "org") await pull((q) => q.eq("org_id", orgId));
  else {
    const ids = parentIds.get(route.parent) ?? [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      await pull((q) => q.in(route.column, chunk));
    }
  }
  return rows;
}

export async function findPerson(admin: SupabaseClient, orgId: string, email: string, name: string | null): Promise<Record<string, unknown[]>> {
  const { data, error } = await admin.rpc("find_person", { p_org: orgId, p_email: email, p_name: name });
  if (error) throw new Error(`Couldn't look the person up: ${error.message}`);
  return (data ?? {}) as Record<string, unknown[]>;
}

export async function forgetPerson(admin: SupabaseClient, orgId: string, email: string, name: string | null): Promise<Record<string, number>> {
  const { data, error } = await admin.rpc("forget_person", { p_org: orgId, p_email: email, p_name: name });
  if (error) throw new Error(`Couldn't remove the person's details: ${error.message}`);
  return (data ?? {}) as Record<string, number>;
}

export interface DataSettings {
  retentionMonths: number | null;
  retentionEnforced: boolean;
}

export async function getDataSettings(client: SupabaseClient): Promise<DataSettings> {
  const { data } = await client.from("data_settings").select("retention_months, retention_enforced").maybeSingle<{ retention_months: number | null; retention_enforced: boolean }>();
  return { retentionMonths: data?.retention_months ?? null, retentionEnforced: data?.retention_enforced ?? false };
}

export async function saveDataSettings(client: SupabaseClient, orgId: string, userId: string, s: DataSettings): Promise<void> {
  const { data, error } = await client.from("data_settings").update({ retention_months: s.retentionMonths, retention_enforced: s.retentionEnforced, updated_by: userId }).eq("org_id", orgId).select("org_id");
  if (error) throw new Error(`Couldn't save: ${error.message}`);
  if ((data?.length ?? 0) === 0) throw new Error("not-allowed");
}

export async function retentionReport(admin: SupabaseClient, orgId: string, months: number): Promise<Record<string, number>> {
  const { data, error } = await admin.rpc("retention_report", { p_org: orgId, p_months: months });
  if (error) throw new Error(`Couldn't work out the retention report: ${error.message}`);
  return (data ?? {}) as Record<string, number>;
}

export async function applyRetention(admin: SupabaseClient, orgId: string, months: number): Promise<Record<string, number>> {
  const { data, error } = await admin.rpc("apply_retention", { p_org: orgId, p_months: months });
  if (error) throw new Error(`Couldn't apply retention: ${error.message}`);
  return (data ?? {}) as Record<string, number>;
}

/** Organisations that have switched retention on (scheduled job). */
export async function orgsEnforcingRetention(admin: SupabaseClient): Promise<{ orgId: string; months: number }[]> {
  const { data } = await admin.from("data_settings").select("org_id, retention_months").eq("retention_enforced", true).not("retention_months", "is", null).returns<{ org_id: string; retention_months: number }[]>();
  return (data ?? []).map((r) => ({ orgId: r.org_id, months: r.retention_months }));
}

/** Orders counted per month, newest first (the admin's own client). */
export async function meterCounts(client: SupabaseClient, months = 12): Promise<{ month: string; orders: number }[]> {
  const { data } = await client.from("order_meter").select("month").order("month", { ascending: false }).limit(50000).returns<{ month: string }[]>();
  const by = new Map<string, number>();
  for (const r of data ?? []) by.set(r.month, (by.get(r.month) ?? 0) + 1);
  return [...by].sort((a, b) => b[0].localeCompare(a[0])).slice(0, months).map(([month, orders]) => ({ month, orders }));
}
