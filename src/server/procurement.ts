import "server-only";
import { listAudit } from "@/lib/data/audit";
import { getPurchaseOrder, listPurchaseOrders, listSuppliers } from "@/lib/data/procurement";
import { listStaffInOrg } from "@/lib/data/staff";
import { formatDateTime, formatIsoDate, formatMoney, formatQuantity } from "@/lib/logic/format";
import { hasPermission } from "@/lib/logic/permissions";
import { PO_STATUS_LABELS, allowedPoStatusChanges, type PoStatus } from "@/lib/logic/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "./session";
import { getChaseSettings } from "@/lib/data/supplier-loop";
import { waitingFor } from "./supplier-loop";

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

export async function loadSuppliers() {
  const staff = await requireStaff({ section: "suppliers" });
  const canSee = hasPermission(staff.permissions, "supplier.identity.view");
  return {
    canSee,
    canCreate: canSee && hasPermission(staff.permissions, "procurement.manage"),
    suppliers: canSee ? await listSuppliers(await client()) : [],
  };
}

export async function loadPurchaseOrders() {
  const staff = await requireStaff({ section: "purchase-orders" });
  const canSee = hasPermission(staff.permissions, "supplier.identity.view");
  const supabase = await client();
  const [pos, settings] = canSee ? await Promise.all([listPurchaseOrders(supabase), getChaseSettings(supabase)]) : [[], null];
  const now = new Date();
  return {
    canSee,
    pos: pos.map((p) => ({
      ...p,
      statusLabel: PO_STATUS_LABELS[p.status],
      created: formatDateTime(new Date(p.createdAt)),
      waiting: p.status === "sent" && settings ? waitingFor(p.sentAt ?? p.createdAt, now, settings) : null,
    })),
  };
}

export async function loadPurchaseOrder(id: string) {
  const staff = await requireStaff({ section: "purchase-orders" });
  if (!hasPermission(staff.permissions, "supplier.identity.view") || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const po = await getPurchaseOrder(await client(), id);
  if (!po) return null;
  const canSeeCosts = hasPermission(staff.permissions, "costs.view");
  const canChange = hasPermission(staff.permissions, "procurement.manage");
  const total = po.lines.reduce<number | null>((sum, l) => (l.unitCostMinor === null || sum === null ? null : sum + Math.round(l.unitCostMinor * l.quantity)), 0);
  return {
    po,
    statusLabel: PO_STATUS_LABELS[po.status],
    created: formatDateTime(new Date(po.createdAt)),
    canSeeCosts,
    nextStatuses: canChange ? allowedPoStatusChanges(po.status).map((s: PoStatus) => ({ value: s, label: PO_STATUS_LABELS[s] })) : [],
    lines: po.lines.map((l) => ({
      ...l,
      quantityText: formatQuantity(l.quantity),
      requested: formatIsoDate(l.requestedDate),
      unitCost: canSeeCosts && l.unitCostMinor !== null ? formatMoney(l.unitCostMinor, po.currency) : null,
    })),
    total: canSeeCosts && total !== null && po.lines.length ? formatMoney(total, po.currency) : null,
  };
}

const TABLE_LABELS: Record<string, string> = {
  organisations: "Organisation",
  staff_users: "Team member",
  role_permissions: "Role permission",
  staff_permission_overrides: "Individual access",
  customers: "Customer",
  suppliers: "Supplier",
  sales_orders: "Order",
  order_lines: "Order line",
  purchase_orders: "Purchase order",
  purchase_order_lines: "PO line",
  purchase_order_line_costs: "PO line cost",
};

/** Audit log for Settings. Admins and audit.view only (RLS returns nothing to anyone else). */
export async function loadAudit() {
  const staff = await requireStaff({ section: "settings" });
  const canSee = staff.role === "admin" || hasPermission(staff.permissions, "audit.view");
  if (!canSee) return { canSee, entries: [] };
  const supabase = await client();
  const [entries, team] = await Promise.all([listAudit(supabase, 100), listStaffInOrg(supabase)]);
  const names = new Map(team.map((p) => [p.id, p.fullName]));
  return {
    canSee,
    entries: entries.map((e) => ({
      id: e.id,
      when: formatDateTime(new Date(e.createdAt)),
      who: e.actorId ? (names.get(e.actorId) ?? "Someone") : "COAST (system)",
      what: `${TABLE_LABELS[e.tableName] ?? e.tableName} ${e.action === "insert" ? "added" : e.action === "update" ? "changed" : "removed"}`,
      fields: e.action === "update" ? Object.keys(e.changes).join(", ") : "",
    })),
  };
}
