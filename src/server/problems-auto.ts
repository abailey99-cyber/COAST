import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DuplicateProblemError, insertProblem, openCarrierProblemFor } from "@/lib/data/problems";
import { getShipment } from "@/lib/data/shipments";
import { ukDateOf, ukToday } from "@/lib/logic/prediction";
import { categoryFromCarrier, categoryFromCheckIn, claimDeadline } from "@/lib/logic/problems";

/**
 * Problems COAST drafts by itself (spec §5.4): a carrier reports a problem,
 * or goods-in checks something in damaged, short or wrong. Drafted as "New"
 * for a person to triage. Service-role client; never throws (a failed draft
 * must not stop the poll or the check-in).
 */

async function claimWindowDays(admin: SupabaseClient, orgId: string, carrier: string): Promise<number | null> {
  const { data } = await admin.from("carrier_settings").select("claim_window_days").eq("org_id", orgId).eq("carrier", carrier).maybeSingle<{ claim_window_days: number | null }>();
  return data?.claim_window_days ?? null;
}

/** A carrier said "exception": one open carrier problem per shipment, however often it says so. */
export async function draftCarrierProblem(admin: SupabaseClient, shipmentId: string, now: Date = new Date()): Promise<string | null> {
  try {
    if (await openCarrierProblemFor(admin, shipmentId)) return null;
    const s = await getShipment(admin, shipmentId);
    if (!s) return null;
    const window = await claimWindowDays(admin, s.orgId, s.carrier);
    return await insertProblem(admin, {
      orgId: s.orgId,
      orderId: s.salesOrderId,
      shipmentId: s.id,
      raisedVia: "carrier",
      category: categoryFromCarrier(s.statusText),
      description: s.statusText ? `Carrier said: ${s.statusText}`.slice(0, 2000) : null,
      reporterName: null,
      claimDeadline: claimDeadline(window, s.deliveredAt ? ukDateOf(s.deliveredAt) : ukToday(now)),
      lines: s.lineIds.map((id) => ({ orderLineId: id, quantity: null })),
    });
  } catch (e) {
    if (!(e instanceof DuplicateProblemError)) console.warn("[problems] couldn't draft a carrier problem", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Goods-in found it damaged, short or wrong. */
export async function draftGoodsInProblem(
  admin: SupabaseClient,
  r: { orderLineId: string; condition: string; quantity: number; note: string | null; shipmentId: string | null; expected: number },
  now: Date = new Date(),
): Promise<string | null> {
  const category = categoryFromCheckIn(r.condition);
  if (!category) return null;
  try {
    const { data: line } = await admin.from("order_lines").select("sales_order_id, sales_orders(org_id)").eq("id", r.orderLineId).maybeSingle<{ sales_order_id: string; sales_orders: { org_id: string } | null }>();
    if (!line?.sales_orders) return null;
    let deadline: string | null = null;
    if (r.shipmentId) {
      const s = await getShipment(admin, r.shipmentId);
      if (s) deadline = claimDeadline(await claimWindowDays(admin, s.orgId, s.carrier), ukToday(now));
    }
    const what = category === "short" ? `${r.quantity} of ${r.expected} arrived.` : null;
    return await insertProblem(admin, {
      orgId: line.sales_orders.org_id,
      orderId: line.sales_order_id,
      shipmentId: r.shipmentId,
      raisedVia: "goods_in",
      category,
      description: [what, r.note].filter(Boolean).join(" ").slice(0, 2000) || null,
      reporterName: null,
      claimDeadline: deadline,
      lines: [{ orderLineId: r.orderLineId, quantity: category === "short" ? Math.max(r.expected - r.quantity, 0) || null : null }],
    });
  } catch (e) {
    console.warn("[problems] couldn't draft a goods-in problem", e instanceof Error ? e.message : e);
    return null;
  }
}
