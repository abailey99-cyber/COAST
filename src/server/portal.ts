import "server-only";
import { businessBranding, listAccountLinks, listAccountOrderIds, listAccountOrderSummaries } from "@/lib/data/customer-portal";
import { formatDateTime, formatMoney, isCurrency, type Currency } from "@/lib/logic/format";
import { CUSTOMER_STAGES, orderCustomerStage } from "@/lib/logic/masking";
import { isFulfilmentRoute, isLineStage, type FulfilmentRoute, type LineStage } from "@/lib/logic/orders";
import { arrivingSoon, dueLabel, groupBySupplier } from "@/lib/logic/portal";
import { formatRange, ukToday } from "@/lib/logic/prediction";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCustomer } from "./customer-session";

/**
 * The customer's COAST portal: every order they've added, from every
 * business that uses COAST, grouped by supplier (the business), earliest
 * delivery first. Only customer-safe fields are even selected.
 */

export interface PortalOrder {
  key: string;
  businessId: string;
  business: string;
  soNumber: string;
  reference: string | null;
  placed: string;
  placedAt: string;
  stage: number | null;
  stageLabel: string;
  expected: string;
  expectedFrom: string | null;
  expectedTo: string | null;
  due: string | null;
  trackingCode: string;
}

export interface PortalGroup {
  businessId: string;
  name: string;
  logoUrl: string | null;
  open: PortalOrder[];
  done: PortalOrder[];
  next: string | null;
  /** This business adds your orders automatically (it vouched for you). */
  automatic: boolean;
}

export interface PortalView {
  name: string;
  q: string;
  soon: PortalOrder[];
  groups: PortalGroup[];
  total: number;
  spend: { currency: Currency; total: string }[];
}

export async function loadPortal(params: { q?: string }): Promise<PortalView> {
  const account = await requireCustomer();
  const admin = createSupabaseAdminClient()!;
  const [rows, links] = await Promise.all([listAccountOrderSummaries(admin, await listAccountOrderIds(admin, account.userId)), listAccountLinks(admin, account.userId)]);
  const branding = await businessBranding(admin, [...rows.map((r) => r.org_id), ...links.map((l) => l.orgId)]);
  const today = ukToday(new Date());
  const q = (params.q ?? "").trim().slice(0, 100);
  const needle = q.toUpperCase().replace(/\s+/g, "");
  const spend = new Map<Currency, number>();

  const orders: PortalOrder[] = rows.map((r) => {
    const lines = (r.order_lines ?? []).filter((l) => isFulfilmentRoute(l.route) && isLineStage(l.stage)) as { stage: LineStage; route: FulfilmentRoute; quantity: number | string; unit_price_minor: number | null }[];
    if (isCurrency(r.currency)) {
      const sum = lines.filter((l) => l.stage !== "cancelled").reduce((n, l) => n + Math.round(Number(l.quantity) * (l.unit_price_minor ?? 0)), 0);
      spend.set(r.currency, (spend.get(r.currency) ?? 0) + sum);
    }
    // An order with no lines yet is just placed, not cancelled.
    const stage = lines.length === 0 ? 0 : orderCustomerStage(lines);
    const p = Array.isArray(r.order_predictions) ? r.order_predictions[0] : r.order_predictions;
    const from = stage === 4 ? null : (p?.predicted_from ?? null);
    const to = stage === 4 ? null : (p?.predicted_to ?? null);
    return {
      key: r.id,
      businessId: r.org_id,
      business: branding.get(r.org_id)?.name ?? "",
      soNumber: r.so_number,
      reference: r.customer_reference,
      placed: formatDateTime(new Date(r.created_at)).split(",")[0]!,
      placedAt: r.created_at,
      stage,
      stageLabel: stage === null ? "Cancelled" : CUSTOMER_STAGES[stage]!,
      expected: stage === 4 ? "Delivered" : stage === null ? "—" : (formatRange(from, to) ?? "To follow"),
      expectedFrom: from,
      expectedTo: to,
      due: stage === null || stage === 4 ? null : dueLabel(from, to, today),
      trackingCode: r.tracking_code,
    };
  });

  const matching = needle
    ? orders.filter((o) => o.soNumber.toUpperCase().includes(needle) || (o.reference ?? "").toUpperCase().replace(/\s+/g, "").includes(needle) || o.business.toUpperCase().replace(/\s+/g, "").includes(needle))
    : orders;
  const automatic = new Set(links.map((l) => l.orgId));
  const groups = groupBySupplier(matching).map((g) => ({
    businessId: g.businessId,
    name: branding.get(g.businessId)?.name ?? "",
    logoUrl: branding.get(g.businessId)?.logoUrl ?? null,
    open: g.open,
    done: g.done,
    next: g.nextExpected,
    automatic: automatic.has(g.businessId),
  }));
  // A business that adds orders automatically shows even before its first order arrives.
  for (const l of links) {
    if (!groups.some((g) => g.businessId === l.orgId) && !needle) {
      groups.push({ businessId: l.orgId, name: branding.get(l.orgId)?.name ?? "", logoUrl: branding.get(l.orgId)?.logoUrl ?? null, open: [], done: [], next: null, automatic: true });
    }
  }

  return {
    name: account.fullName,
    q,
    // With one supplier, its own section already shows everything soonest first.
    soon: needle || groups.length < 2 ? [] : arrivingSoon(orders, today),
    groups,
    total: orders.length,
    spend: [...spend.entries()].map(([currency, minor]) => ({ currency, total: formatMoney(minor, currency) })),
  };
}
