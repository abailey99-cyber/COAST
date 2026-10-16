import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AggregatorEvent } from "@/lib/logic/aggregator";

/**
 * Aggregator tracking (readiness Task 4). Reads and writes only, service
 * role, always keyed by a shipment (which carries its organisation) or an
 * explicit organisation id.
 */

export interface Registration {
  shipmentId: string;
  orgId: string;
  provider: string;
  providerRef: string;
  trackingNumber: string;
  registeredAt: string;
  nextCheckAt: string | null;
  lastEventAt: string | null;
}

interface RawRegistration {
  shipment_id: string;
  org_id: string;
  provider: string;
  provider_ref: string;
  tracking_number: string;
  registered_at: string;
  next_check_at: string | null;
  last_event_at: string | null;
}
const toReg = (r: RawRegistration): Registration => ({
  shipmentId: r.shipment_id,
  orgId: r.org_id,
  provider: r.provider,
  providerRef: r.provider_ref,
  trackingNumber: r.tracking_number,
  registeredAt: r.registered_at,
  nextCheckAt: r.next_check_at,
  lastEventAt: r.last_event_at,
});
const REG = "shipment_id, org_id, provider, provider_ref, tracking_number, registered_at, next_check_at, last_event_at";

/** Shipments that should be registered but aren't: live, with a tracking number, on a real carrier. */
export async function unregisteredShipments(admin: SupabaseClient, limit = 100, onlyIds?: readonly string[]): Promise<{ id: string; orgId: string; carrier: string; trackingNumber: string }[]> {
  let q = admin
    .from("shipments")
    .select("id, org_id, carrier, tracking_number, tracking_registrations(shipment_id)")
    .not("tracking_number", "is", null)
    .not("status", "eq", "delivered")
    .not("carrier", "in", "(other,mock)")
    .order("created_at", { ascending: false })
    .limit(limit * 3);
  if (onlyIds) q = q.in("id", [...onlyIds]);
  const { data, error } = await q.returns<{ id: string; org_id: string; carrier: string; tracking_number: string; tracking_registrations: { shipment_id: string } | { shipment_id: string }[] | null }[]>();
  if (error) throw new Error(`Couldn't list shipments to register: ${error.message}`);
  return (data ?? [])
    .filter((s) => !s.tracking_registrations || (Array.isArray(s.tracking_registrations) && s.tracking_registrations.length === 0))
    .slice(0, limit)
    .map((s) => ({ id: s.id, orgId: s.org_id, carrier: s.carrier, trackingNumber: s.tracking_number }));
}

export async function insertRegistration(admin: SupabaseClient, r: { shipmentId: string; orgId: string; provider: string; providerRef: string; trackingNumber: string; nextCheckAt: Date | null }): Promise<boolean> {
  const { error } = await admin
    .from("tracking_registrations")
    .insert({ shipment_id: r.shipmentId, org_id: r.orgId, provider: r.provider, provider_ref: r.providerRef, tracking_number: r.trackingNumber, next_check_at: r.nextCheckAt?.toISOString() ?? null });
  if (error?.code === "23505") return false;
  if (error) throw new Error(`Couldn't record the registration: ${error.message}`);
  // Tracked by the aggregator now: the direct poll job leaves it alone.
  await admin.from("shipment_poll_state").update({ next_poll_at: null }).eq("shipment_id", r.shipmentId);
  return true;
}

/** Every registration for a parcel (more than one organisation may track the same parcel; each gets its own update). */
export async function registrationsFor(admin: SupabaseClient, provider: string, key: { ref?: string; trackingNumber?: string }): Promise<Registration[]> {
  let q = admin.from("tracking_registrations").select(REG).eq("provider", provider);
  if (key.ref) q = q.eq("provider_ref", key.ref);
  else if (key.trackingNumber) q = q.eq("tracking_number", key.trackingNumber);
  else return [];
  const { data } = await q.limit(50).returns<RawRegistration[]>();
  return (data ?? []).map(toReg);
}

export async function dueRegistrations(admin: SupabaseClient, now: Date, limit = 200): Promise<Registration[]> {
  const { data } = await admin.from("tracking_registrations").select(REG).lte("next_check_at", now.toISOString()).order("next_check_at").limit(limit).returns<RawRegistration[]>();
  return (data ?? []).map(toReg);
}

export async function updateRegistration(admin: SupabaseClient, shipmentId: string, p: { nextCheckAt: Date | null; lastEventAt?: string | null; error?: string | null }): Promise<void> {
  const row: Record<string, unknown> = { next_check_at: p.nextCheckAt?.toISOString() ?? null };
  if (p.lastEventAt !== undefined) row.last_event_at = p.lastEventAt;
  if (p.error !== undefined) row.last_error = p.error?.slice(0, 300) ?? null;
  await admin.from("tracking_registrations").update(row).eq("shipment_id", shipmentId);
}

/** Store events not seen before for this shipment; returns how many were new. */
export async function storeAggregatorEvents(admin: SupabaseClient, shipmentId: string, events: readonly AggregatorEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const { data, error } = await admin
    .from("aggregator_events")
    .upsert(events.map((e) => ({ shipment_id: shipmentId, event_id: e.eventId.slice(0, 300), event: e })), { onConflict: "shipment_id,event_id", ignoreDuplicates: true })
    .select("event_id");
  if (error) throw new Error(`Couldn't store tracking events: ${error.message}`);
  return data?.length ?? 0;
}

export async function aggregatorEventsFor(admin: SupabaseClient, shipmentId: string): Promise<AggregatorEvent[]> {
  const { data } = await admin.from("aggregator_events").select("event").eq("shipment_id", shipmentId).limit(1000).returns<{ event: AggregatorEvent }[]>();
  return (data ?? []).map((r) => r.event);
}

// ── Cost ────────────────────────────────────────────────────────────────────
export async function monthUsage(admin: SupabaseClient, orgId: string, now: Date): Promise<{ costMinor: number; alertedLevel: "no_plan" | "near" | "over" | null }> {
  const month = `${now.toISOString().slice(0, 7)}-01`;
  const { data } = await admin.from("tracking_usage").select("cost_minor, alerted_level").eq("org_id", orgId).eq("month", month).maybeSingle<{ cost_minor: number; alerted_level: "no_plan" | "near" | "over" | null }>();
  return { costMinor: Number(data?.cost_minor ?? 0), alertedLevel: data?.alerted_level ?? null };
}

export async function recordTrackingCost(admin: SupabaseClient, orgId: string, costMinor: number): Promise<number> {
  const { data, error } = await admin.rpc("record_tracking_cost", { p_org: orgId, p_cost: costMinor });
  if (error) throw new Error(`Couldn't record tracking cost: ${error.message}`);
  return Number(data) || 0;
}

export async function markAlerted(admin: SupabaseClient, orgId: string, now: Date, level: "no_plan" | "near" | "over"): Promise<void> {
  await admin.from("tracking_usage").update({ alerted_level: level }).eq("org_id", orgId).eq("month", `${now.toISOString().slice(0, 7)}-01`);
}

export async function planPrice(admin: SupabaseClient, orgId: string): Promise<number | null> {
  const { data } = await admin.from("org_plans").select("plan_price_minor").eq("org_id", orgId).maybeSingle<{ plan_price_minor: number | null }>();
  return data?.plan_price_minor === undefined || data?.plan_price_minor === null ? null : Number(data.plan_price_minor);
}

export async function hasConnection(admin: SupabaseClient, orgId: string, provider: string): Promise<boolean> {
  const { data } = await admin.from("integration_credentials").select("id").eq("org_id", orgId).eq("provider", provider).eq("status", "active").maybeSingle();
  return Boolean(data);
}
