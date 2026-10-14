import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFulfilmentRoute, isLineStage, type FulfilmentRoute, type LineStage } from "@/lib/logic/orders";
import { DEFAULT_PREDICTION_SETTINGS, type AvailabilityRow, type Confidence, type LinePrediction, type PredictionSettings, type PredictionSource } from "@/lib/logic/prediction";
import { isShipmentLeg, isShipmentStatus, type ShipmentLeg, type ShipmentStatus } from "@/lib/logic/shipments";

/**
 * Predictions, the things they're worked out from, hand-set dates and lead
 * times, availability and prediction settings. Reads and writes only.
 * Recalculation passes the service-role client (it's COAST's own work);
 * staff changes pass the signed-in client (RLS applies).
 */

// ── What a prediction is worked out from ────────────────────────────────────
export interface PredictionInputLine {
  id: string;
  lineNo: number;
  route: FulfilmentRoute;
  stage: LineStage;
  sku: string | null;
  leadTimeOverrideDays: number | null;
  /** Live (not cancelled) POs for the line. */
  pos: { confirmedDate: string | null; sentAt: string | null; supplierLeadTimeDays: number | null }[];
  shipments: { leg: ShipmentLeg; status: ShipmentStatus; etaFrom: string | null; etaTo: string | null; deliveredAt: string | null }[];
}

export interface PredictionInput {
  orderId: string;
  orgId: string;
  promisedDate: string | null;
  override: { from: string; to: string | null; note: string | null } | null;
  lines: PredictionInputLine[];
}

interface RawInput {
  id: string;
  org_id: string;
  promised_date: string | null;
  predicted_override_from: string | null;
  predicted_override_to: string | null;
  predicted_override_note: string | null;
  order_lines: {
    id: string;
    line_no: number;
    route: string;
    stage: string;
    sku: string | null;
    lead_time_override_days: number | null;
    purchase_order_lines: { confirmed_date: string | null; purchase_orders: { status: string; sent_at: string | null; suppliers: { typical_lead_time_days: number | null } | null } | null }[] | null;
    shipment_lines: { shipments: { leg: string; status: string; estimated_from: string | null; estimated_to: string | null; delivered_at: string | null } | null }[] | null;
  }[] | null;
}

export async function loadPredictionInput(admin: SupabaseClient, orderId: string): Promise<PredictionInput | null> {
  const { data, error } = await admin
    .from("sales_orders")
    .select(
      `id, org_id, promised_date, predicted_override_from, predicted_override_to, predicted_override_note,
       order_lines(id, line_no, route, stage, sku, lead_time_override_days,
         purchase_order_lines(confirmed_date, purchase_orders(status, sent_at, suppliers(typical_lead_time_days))),
         shipment_lines(shipments(leg, status, estimated_from, estimated_to, delivered_at)))`,
    )
    .eq("id", orderId)
    .maybeSingle<RawInput>();
  if (error) throw new Error(`Couldn't load the order for prediction: ${error.message}`);
  if (!data) return null;
  return {
    orderId: data.id,
    orgId: data.org_id,
    promisedDate: data.promised_date,
    override: data.predicted_override_from ? { from: data.predicted_override_from, to: data.predicted_override_to, note: data.predicted_override_note } : null,
    lines: (data.order_lines ?? [])
      .filter((l) => isFulfilmentRoute(l.route) && isLineStage(l.stage))
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        route: l.route as FulfilmentRoute,
        stage: l.stage as LineStage,
        sku: l.sku,
        leadTimeOverrideDays: l.lead_time_override_days,
        pos: (l.purchase_order_lines ?? [])
          .filter((pl) => pl.purchase_orders && pl.purchase_orders.status !== "cancelled")
          .map((pl) => ({ confirmedDate: pl.confirmed_date, sentAt: pl.purchase_orders!.sent_at, supplierLeadTimeDays: pl.purchase_orders!.suppliers?.typical_lead_time_days ?? null })),
        shipments: (l.shipment_lines ?? []).flatMap((sl) => {
          const s = sl.shipments;
          return s && isShipmentLeg(s.leg) && isShipmentStatus(s.status)
            ? [{ leg: s.leg, status: s.status, etaFrom: s.estimated_from, etaTo: s.estimated_to, deliveredAt: s.delivered_at }]
            : [];
        }),
      })),
  };
}

// ── Stored predictions ──────────────────────────────────────────────────────
export interface StoredPrediction {
  from: string | null;
  to: string | null;
  source: PredictionSource;
  confidence: Confidence;
  atRisk: boolean | null;
  reason: string;
  lines: LinePrediction[];
  computedAt: string;
}

interface RawPrediction {
  predicted_from: string | null;
  predicted_to: string | null;
  source: PredictionSource;
  confidence: Confidence;
  at_risk: boolean | null;
  reason: string;
  lines: LinePrediction[];
  computed_at: string;
}

const toStored = (r: RawPrediction): StoredPrediction => ({
  from: r.predicted_from,
  to: r.predicted_to,
  source: r.source,
  confidence: r.confidence,
  atRisk: r.at_risk,
  reason: r.reason,
  lines: Array.isArray(r.lines) ? r.lines : [],
  computedAt: r.computed_at,
});

export async function getPrediction(client: SupabaseClient, orderId: string): Promise<StoredPrediction | null> {
  const { data, error } = await client
    .from("order_predictions")
    .select("predicted_from, predicted_to, source, confidence, at_risk, reason, lines, computed_at")
    .eq("sales_order_id", orderId)
    .maybeSingle<RawPrediction>();
  if (error) throw new Error(`Couldn't load prediction: ${error.message}`);
  return data ? toStored(data) : null;
}

export async function savePrediction(admin: SupabaseClient, orderId: string, p: Omit<StoredPrediction, "computedAt">): Promise<void> {
  const { error } = await admin.from("order_predictions").upsert(
    {
      sales_order_id: orderId,
      predicted_from: p.from,
      predicted_to: p.to,
      source: p.source,
      confidence: p.confidence,
      at_risk: p.atRisk,
      reason: p.reason.slice(0, 500),
      lines: p.lines,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "sales_order_id" },
  );
  if (error) throw new Error(`Couldn't save prediction: ${error.message}`);
}

/** Orders whose prediction is missing, or older than `staleBefore` and not finished. Newest orders first. */
export async function listOrdersToRefresh(admin: SupabaseClient, staleBefore: Date, limit: number, orgId?: string): Promise<string[]> {
  let q = admin.from("sales_orders").select("id, order_predictions(computed_at, source)").order("created_at", { ascending: false }).limit(5000);
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q.returns<{ id: string; order_predictions: { computed_at: string; source: string } | { computed_at: string; source: string }[] | null }[]>();
  if (error) throw new Error(`Couldn't list orders to refresh: ${error.message}`);
  const cutoff = staleBefore.toISOString();
  return (data ?? [])
    .filter((o) => {
      const p = Array.isArray(o.order_predictions) ? o.order_predictions[0] : o.order_predictions;
      if (!p) return true;
      return p.source !== "delivered" && p.computed_at < cutoff;
    })
    .slice(0, limit)
    .map((o) => o.id);
}

/** Orders with a line for any of these product codes. */
export async function listOrdersWithSkus(admin: SupabaseClient, orgId: string, skus: readonly string[]): Promise<string[]> {
  if (skus.length === 0) return [];
  const ids = new Set<string>();
  for (let i = 0; i < skus.length; i += 200) {
    const { data, error } = await admin
      .from("order_lines")
      .select("sales_order_id, sales_orders!inner(org_id)")
      .eq("sales_orders.org_id", orgId)
      .in("sku", skus.slice(i, i + 200))
      .returns<{ sales_order_id: string }[]>();
    if (error) throw new Error(`Couldn't find orders for those product codes: ${error.message}`);
    for (const r of data ?? []) ids.add(r.sales_order_id);
  }
  return [...ids];
}

// ── Settings ────────────────────────────────────────────────────────────────
export async function getPredictionSettings(client: SupabaseClient, orgId?: string): Promise<PredictionSettings> {
  let q = client.from("prediction_settings").select("handling_days, delivery_days, spread_days");
  if (orgId) q = q.eq("org_id", orgId);
  const { data } = await q.limit(1).maybeSingle<{ handling_days: number; delivery_days: number; spread_days: number }>();
  if (!data) return DEFAULT_PREDICTION_SETTINGS;
  return { handlingDays: data.handling_days, deliveryDays: data.delivery_days, spreadDays: data.spread_days };
}

export async function updatePredictionSettings(client: SupabaseClient, orgId: string, userId: string, s: PredictionSettings): Promise<void> {
  const { data, error } = await client
    .from("prediction_settings")
    .update({ handling_days: s.handlingDays, delivery_days: s.deliveryDays, spread_days: s.spreadDays, updated_by: userId })
    .eq("org_id", orgId)
    .select("org_id");
  if (error) throw new Error(`Couldn't save prediction settings: ${error.message}`);
  if ((data?.length ?? 0) === 0) throw new Error("Couldn't save prediction settings.");
}

// ── Availability ────────────────────────────────────────────────────────────
export async function availabilityFor(client: SupabaseClient, orgId: string, skus: readonly string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(skus.map((s) => s.toUpperCase()))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await client.from("product_availability").select("sku, available_in_days").eq("org_id", orgId).in("sku", wanted).returns<{ sku: string; available_in_days: number }[]>();
  if (error) throw new Error(`Couldn't load availability: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.sku, r.available_in_days]));
}

export interface AvailabilityEntry {
  sku: string;
  days: number;
  source: "manual" | "csv";
  updatedAt: string;
}

export async function listAvailability(client: SupabaseClient, limit = 1000): Promise<{ rows: AvailabilityEntry[]; total: number }> {
  const { data, error, count } = await client
    .from("product_availability")
    .select("sku, available_in_days, source, updated_at", { count: "exact" })
    .order("sku")
    .limit(limit)
    .returns<{ sku: string; available_in_days: number; source: "manual" | "csv"; updated_at: string }[]>();
  if (error) throw new Error(`Couldn't load availability: ${error.message}`);
  return { rows: (data ?? []).map((r) => ({ sku: r.sku, days: r.available_in_days, source: r.source, updatedAt: r.updated_at })), total: count ?? 0 };
}

/** Replaces the figures for these product codes. */
export async function saveAvailability(client: SupabaseClient, orgId: string, rows: readonly AvailabilityRow[], source: "manual" | "csv"): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const del = await client.from("product_availability").delete().eq("org_id", orgId).in("sku", chunk.map((r) => r.sku));
    if (del.error) throw new Error(`Couldn't save availability: ${del.error.message}`);
    const ins = await client.from("product_availability").insert(chunk.map((r) => ({ org_id: orgId, sku: r.sku, available_in_days: r.days, source })));
    if (ins.error) throw new Error(`Couldn't save availability: ${ins.error.message}`);
  }
}

export async function deleteAvailability(client: SupabaseClient, orgId: string, sku: string): Promise<boolean> {
  const { data, error } = await client.from("product_availability").delete().eq("org_id", orgId).eq("sku", sku).select("sku");
  if (error) throw new Error(`Couldn't remove availability: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// ── Hand-set values (staff) ─────────────────────────────────────────────────
export async function setPredictionOverride(client: SupabaseClient, orderId: string, userId: string, o: { from: string; to: string | null; note: string | null } | null): Promise<boolean> {
  const patch = o
    ? { predicted_override_from: o.from, predicted_override_to: o.to, predicted_override_note: o.note, predicted_override_by: userId, predicted_override_at: new Date().toISOString() }
    : { predicted_override_from: null, predicted_override_to: null, predicted_override_note: null, predicted_override_by: userId, predicted_override_at: new Date().toISOString() };
  const { data, error } = await client.from("sales_orders").update(patch).eq("id", orderId).select("id");
  if (error) throw new Error(`Couldn't save the delivery date: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function setLineLeadTime(client: SupabaseClient, lineId: string, userId: string, days: number | null): Promise<string | null> {
  const { data, error } = await client
    .from("order_lines")
    .update({ lead_time_override_days: days, lead_time_override_by: userId, lead_time_override_at: new Date().toISOString() })
    .eq("id", lineId)
    .select("sales_order_id")
    .returns<{ sales_order_id: string }[]>();
  if (error) throw new Error(`Couldn't save the lead time: ${error.message}`);
  return data?.[0]?.sales_order_id ?? null;
}
