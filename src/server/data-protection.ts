import "server-only";
import { recordSecurityEvent } from "@/lib/data/credentials";
import { applyRetention, exportTableRows, getDataSettings, meterCounts, orgsEnforcingRetention, retentionReport } from "@/lib/data/data-protection";
import { zip } from "@/lib/export/zip";
import { EXPORT_TABLES, toCsv } from "@/lib/logic/data-protection";
import { monthLabel } from "@/lib/logic/metering";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStaffSession, type StaffContext } from "./session";

/** Data protection (readiness plan Task 6): the organisation's export, retention and the monthly order count. */

/** GET /api/export: every table of the signed-in admin's organisation, one CSV each, zipped. */
export async function exportOrganisation(now: Date = new Date()): Promise<Response> {
  const session = await getStaffSession();
  if (session.state !== "staff" || session.staff.role !== "admin") return new Response("Only an admin can export the organisation's data.", { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin) return new Response("Not available right now.", { status: 503 });
  const orgId = session.staff.orgId;

  const { data: org } = await admin.from("organisations").select("name").eq("id", orgId).maybeSingle<{ name: string }>();
  const ids = new Map<string, string[]>();
  const files: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  const counts: string[] = [];
  for (const { table, route } of EXPORT_TABLES) {
    const rows = await exportTableRows(admin, table, route, orgId, ids);
    // Children are found through their parents' ids (exported first).
    const keys = rows.map((r) => r.id).filter((v): v is string => typeof v === "string");
    if (keys.length) ids.set(table, keys);
    files.push({ name: `${table}.csv`, data: enc.encode(toCsv(rows)) });
    counts.push(`${table}.csv — ${rows.length} ${rows.length === 1 ? "row" : "rows"}`);
  }
  files.unshift({
    name: "README.txt",
    data: enc.encode(
      [
        `COAST data export for ${org?.name ?? orgId}`,
        `Made ${now.toISOString()} by ${session.staff.fullName}.`,
        "",
        "One CSV file per table, with a header row. Dates are UTC (ISO 8601).",
        "Not included: encrypted integration secrets, supplier link codes, and COAST's own records.",
        "",
        ...counts,
      ].join("\r\n"),
    ),
  });
  await recordSecurityEvent(admin, { orgId, kind: "data_exported", actorId: session.staff.id, detail: { tables: EXPORT_TABLES.length } });
  const body = zip(files, now);
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="coast-export-${now.toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

export interface DataProtectionView {
  canEdit: boolean;
  retentionMonths: number | null;
  retentionEnforced: boolean;
  /** What retention would clear now (the dry run), when a period is set. */
  report: Record<string, number> | null;
  meter: { month: string; label: string; orders: number }[];
}

export async function loadDataProtection(staff: StaffContext): Promise<DataProtectionView | null> {
  if (staff.role !== "admin") return null;
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return null;
  const [settings, meter] = await Promise.all([getDataSettings(supabase), meterCounts(supabase)]);
  const report = settings.retentionMonths ? await retentionReport(admin, staff.orgId, settings.retentionMonths) : null;
  return {
    canEdit: true,
    retentionMonths: settings.retentionMonths,
    retentionEnforced: settings.retentionEnforced,
    report,
    meter: meter.map((m) => ({ ...m, label: monthLabel(m.month) })),
  };
}

/** /api/cron/data-retention: once a day, for organisations that have switched it on. */
export async function scheduledRetention(): Promise<{ outcome: "ok" | "partial" | "error"; organisations?: number }> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { outcome: "error" };
  let done = 0;
  let failed = 0;
  for (const { orgId, months } of await orgsEnforcingRetention(admin)) {
    try {
      const cleared = await applyRetention(admin, orgId, months);
      if (Object.values(cleared).some((n) => Number(n) > 0)) await recordSecurityEvent(admin, { orgId, kind: "retention_applied", actorId: null, detail: { months, ...cleared } });
      done++;
    } catch (e) {
      failed++;
      console.warn("[retention] couldn't apply for an organisation", e instanceof Error ? e.message : e);
    }
  }
  return { outcome: failed === 0 ? "ok" : done > 0 ? "partial" : "error", organisations: done };
}
