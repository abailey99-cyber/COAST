import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregator, aggregatorByKey, costPerShipmentMinor, type AggregatorProvider } from "@/lib/carriers/aggregator";
import {
  aggregatorEventsFor,
  dueRegistrations,
  hasConnection,
  insertRegistration,
  markAlerted,
  monthUsage,
  planPrice,
  recordTrackingCost,
  registrationsFor,
  storeAggregatorEvents,
  unregisteredShipments,
  updateRegistration,
  type Registration,
} from "@/lib/data/aggregator";
import { emailChannel } from "@/lib/email/channel";
import { costLevel, newEvents, nextAggregatorCheck, shouldAlert, snapshotFromEvents, trackingRoute, type AggregatorEvent } from "@/lib/logic/aggregator";
import { directAllowed, getCarrier, isCarrierKey } from "@/lib/logic/carriers";
import { formatMoney } from "@/lib/logic/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { foldSnapshot } from "./tracking-poll";

/**
 * Aggregator tracking (readiness plan Task 4). Each shipment is registered
 * once; updates arrive by signed webhook, or by adaptive checks as a safety
 * net. Every update is applied only to the shipment it was registered for
 * (which carries its own organisation). Tracking costs are counted per
 * organisation per month against a 5% cap: near it, checks slow down and
 * the founder hears — tracking never stops silently.
 */

async function costNow(admin: SupabaseClient, orgId: string, now: Date) {
  const [usage, price] = await Promise.all([monthUsage(admin, orgId, now), planPrice(admin, orgId)]);
  return { ...costLevel(usage.costMinor, price), spentMinor: usage.costMinor, alerted: usage.alertedLevel };
}

/** Tell the founder an organisation is near or over its tracking budget (or has no plan price set). Once per level per month. */
async function alertFounderIfNeeded(admin: SupabaseClient, orgId: string, now: Date): Promise<void> {
  const c = await costNow(admin, orgId, now);
  if (!shouldAlert(c.level, c.alerted) || c.level === "ok") return;
  await markAlerted(admin, orgId, now, c.level);
  const to = process.env.FOUNDER_ALERT_EMAIL?.trim();
  const { data: org } = await admin.from("organisations").select("name").eq("id", orgId).maybeSingle<{ name: string }>();
  const what =
    c.level === "no_plan"
      ? `has no plan price set, so its tracking has no cost cap (spent ${formatMoney(c.spentMinor, "GBP")} this month).`
      : `has used ${c.percentUsed}% of its tracking budget this month (${formatMoney(c.spentMinor, "GBP")} of ${formatMoney(c.capMinor ?? 0, "GBP")}). Checks are slowed down; tracking continues.`;
  console.warn(`[aggregator] ${org?.name ?? orgId} ${what}`);
  if (to) await emailChannel().send({ to, subject: `COAST tracking budget: ${org?.name ?? "an organisation"}`, text: `${org?.name ?? orgId} ${what}`, html: `<p>${org?.name ?? orgId} ${what}</p>` });
}

/**
 * Register shipments that should go through the aggregator: live, with a
 * tracking number, on a real carrier, and not tracked with the
 * organisation's own carrier account.
 */
export async function registerNewShipments(admin: SupabaseClient, provider: AggregatorProvider, now: Date, limit = 100, onlyIds?: readonly string[]): Promise<number> {
  let registered = 0;
  for (const s of await unregisteredShipments(admin, limit, onlyIds)) {
    if (!isCarrierKey(s.carrier)) continue;
    const def = getCarrier(s.carrier);
    const ownAccount = def.provider ? await hasConnection(admin, s.orgId, def.provider) : false;
    const route = trackingRoute({ carrier: s.carrier, hasTrackingNumber: true, ownAccount, directAllowed: directAllowed(s.carrier, process.env), aggregatorReady: true });
    if (route !== "aggregator") continue;
    const r = await provider.register(s.trackingNumber, s.carrier === "unknown" ? null : s.carrier);
    if (!r.ok) {
      console.warn(`[aggregator] couldn't register a shipment: ${r.error}`);
      continue;
    }
    const cost = await costNow(admin, s.orgId, now);
    const inserted = await insertRegistration(admin, {
      shipmentId: s.id,
      orgId: s.orgId,
      provider: provider.key,
      providerRef: r.ref,
      trackingNumber: s.trackingNumber,
      nextCheckAt: provider.webhooks ? nextAggregatorCheck({ status: "unknown", now, predictedDate: null, lastEventAt: null, webhooks: true, cost: cost.level }) : now,
    });
    if (!inserted) continue;
    await recordTrackingCost(admin, s.orgId, costPerShipmentMinor());
    await alertFounderIfNeeded(admin, s.orgId, now);
    registered++;
  }
  return registered;
}

/** New events for one registered shipment: store the new ones, rebuild its state in time order, fold it in. */
export async function applyAggregatorEvents(admin: SupabaseClient, provider: AggregatorProvider, reg: Registration, incoming: readonly AggregatorEvent[], now: Date): Promise<boolean> {
  const known = await aggregatorEventsFor(admin, reg.shipmentId);
  const fresh = newEvents(incoming, new Set(known.map((e) => e.eventId)));
  const stored = await storeAggregatorEvents(admin, reg.shipmentId, fresh);
  const all = [...known, ...fresh];
  const snapshot = snapshotFromEvents(all, provider.mapping);
  const folded = stored > 0 ? await foldSnapshot(admin, reg.shipmentId, snapshot, now) : null;
  const cost = await costNow(admin, reg.orgId, now);
  const lastEventAt = all.map((e) => e.occurredAt).sort().at(-1) ?? reg.lastEventAt;
  const { data: pred } = await admin.from("shipments").select("estimated_to, status").eq("id", reg.shipmentId).maybeSingle<{ estimated_to: string | null; status: string }>();
  await updateRegistration(admin, reg.shipmentId, {
    nextCheckAt: nextAggregatorCheck({ status: (folded?.finalStatus ?? pred?.status ?? "unknown") as Parameters<typeof nextAggregatorCheck>[0]["status"], now, predictedDate: pred?.estimated_to ?? null, lastEventAt, webhooks: provider.webhooks, cost: cost.level }),
    lastEventAt,
    error: null,
  });
  return Boolean(folded?.changed);
}

/** Safety-net checks (or the main way, for a provider without webhooks). */
export async function checkDueRegistrations(admin: SupabaseClient, provider: AggregatorProvider, now: Date, budgetMs = 20_000): Promise<{ checked: number; updated: number; failed: number }> {
  const started = Date.now();
  const out = { checked: 0, updated: 0, failed: 0 };
  for (const reg of await dueRegistrations(admin, now)) {
    if (reg.provider !== provider.key) continue;
    if (Date.now() - started > budgetMs) break;
    out.checked++;
    const r = await provider.check(reg.providerRef, reg.trackingNumber, new Date(reg.registeredAt), now);
    if (!r.ok) {
      out.failed++;
      await updateRegistration(admin, reg.shipmentId, { nextCheckAt: new Date(now.getTime() + 6 * 3_600_000), error: r.error });
      continue;
    }
    if (await applyAggregatorEvents(admin, provider, reg, r.events, now)) out.updated++;
  }
  return out;
}

/** Part of the scheduled tracking run. */
export async function runAggregator(admin: SupabaseClient, now: Date = new Date()): Promise<{ registered: number; checked: number; updated: number; failed: number } | null> {
  const provider = aggregator();
  if (!provider) return null;
  const registered = await registerNewShipments(admin, provider, now);
  return { registered, ...(await checkDueRegistrations(admin, provider, now)) };
}

/**
 * POST /api/tracking/webhook/<provider>. Unsigned requests are refused.
 * Each event updates only the shipments registered for that parcel.
 */
export async function receiveAggregatorWebhook(request: Request, providerKey: string, now: Date = new Date()): Promise<Response> {
  const provider = aggregatorByKey(providerKey);
  if (!provider) return new Response("Not set up.", { status: 404 });
  const raw = await request.text();
  if (raw.length > 2_000_000) return new Response("Too large.", { status: 413 });
  if (!provider.verifyWebhook(raw, request.headers)) return new Response("Not signed.", { status: 401 });
  const admin = createSupabaseAdminClient();
  if (!admin) return new Response("Try again later.", { status: 503 });

  const byNumber = new Map<string, AggregatorEvent[]>();
  for (const e of provider.parseWebhook(raw)) byNumber.set(e.trackingNumber, [...(byNumber.get(e.trackingNumber) ?? []), e]);
  let updated = 0;
  try {
    for (const [trackingNumber, events] of byNumber) {
      for (const reg of await registrationsFor(admin, provider.key, { trackingNumber })) {
        if (await applyAggregatorEvents(admin, provider, reg, events, now)) updated++;
      }
    }
  } catch (e) {
    console.warn("[aggregator] couldn't apply a webhook", e instanceof Error ? e.message : e);
    return new Response("Try again later.", { status: 503 });
  }
  return Response.json({ ok: true, updated });
}
