import "server-only";
import { listAccountOrderIds, listAccountOrderSummaries } from "@/lib/data/customer-portal";
import { formatDateTime, formatMoney, isCurrency, type Currency } from "@/lib/logic/format";
import { CUSTOMER_STAGES, orderCustomerStage } from "@/lib/logic/masking";
import { isFulfilmentRoute, isLineStage, type FulfilmentRoute, type LineStage } from "@/lib/logic/orders";
import { formatRange } from "@/lib/logic/prediction";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCustomer } from "./customer-session";

/**
 * The customer's "all my orders" page (spec §5.5). Only the orders the
 * account added by tracking code (E4); only customer-safe fields are even
 * selected (no supplier, PO or cost columns).
 */

export interface PortalOrder {
  soNumber: string;
  reference: string | null;
  placed: string;
  stage: string;
  expected: string;
  trackingCode: string;
}

export interface PortalView {
  name: string;
  q: string;
  orders: PortalOrder[];
  total: number;
  spend: { currency: Currency; total: string }[];
}

export async function loadPortal(params: { q?: string }): Promise<PortalView> {
  const account = await requireCustomer();
  const admin = createSupabaseAdminClient()!;
  const rows = await listAccountOrderSummaries(admin, await listAccountOrderIds(admin, account.userId));
  const q = (params.q ?? "").trim().slice(0, 100);
  const needle = q.toUpperCase().replace(/\s+/g, "");
  const spend = new Map<Currency, number>();

  const orders = rows
    .map((r) => {
      const lines = (r.order_lines ?? []).filter((l) => isFulfilmentRoute(l.route) && isLineStage(l.stage)) as { stage: LineStage; route: FulfilmentRoute; quantity: number | string; unit_price_minor: number | null }[];
      if (isCurrency(r.currency)) {
        const sum = lines.filter((l) => l.stage !== "cancelled").reduce((n, l) => n + Math.round(Number(l.quantity) * (l.unit_price_minor ?? 0)), 0);
        spend.set(r.currency, (spend.get(r.currency) ?? 0) + sum);
      }
      const stage = orderCustomerStage(lines);
      const p = Array.isArray(r.order_predictions) ? r.order_predictions[0] : r.order_predictions;
      return {
        soNumber: r.so_number,
        reference: r.customer_reference,
        placedAt: r.created_at,
        placed: formatDateTime(new Date(r.created_at)).split(",")[0]!,
        stage: stage === null ? "Cancelled" : CUSTOMER_STAGES[stage],
        expected: stage === 4 ? "Delivered" : (formatRange(p?.predicted_from ?? null, p?.predicted_to ?? null) ?? "To follow"),
        trackingCode: r.tracking_code,
      };
    })
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt));

  const matching = needle ? orders.filter((o) => o.soNumber.toUpperCase().includes(needle) || (o.reference ?? "").toUpperCase().replace(/\s+/g, "").includes(needle)) : orders;
  return {
    name: account.fullName,
    q,
    orders: matching.map(({ placedAt: _p, ...o }) => (void _p, o)),
    total: orders.length,
    spend: [...spend.entries()].map(([currency, minor]) => ({ currency, total: formatMoney(minor, currency) })),
  };
}
