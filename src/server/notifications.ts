import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import {
  getCustomerPageSettings,
  getPrefs,
  lastRoutineSentAt,
  listHeld,
  markFolded,
  recordNotification,
} from "@/lib/data/customer-portal";
import { emailChannel } from "@/lib/email/channel";
import { findLeaks } from "@/lib/logic/masking";
import { TOPIC_KIND, buildCustomerEmail, decide, heldReadyToSend, topicSummary, type Topic } from "@/lib/logic/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { customerViewFor, trackingUrl } from "./customer-view";

/**
 * The one dispatch function for customer notifications (spec §9.3). Every
 * trigger — a date change, a shipment milestone, a staff reply — calls
 * `notifyCustomer`; it decides (pure logic), builds the email from the
 * masked view only, scans it once more, then hands it to the email channel
 * (logged until Microsoft 365 is connected). Never throws.
 */

export async function notifyCustomer(orderId: string, topic: Topic, options: { replyText?: string; now?: Date } = {}): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  try {
    await dispatch(admin, orderId, topic, options.replyText, options.now ?? new Date());
  } catch (e) {
    console.warn("[notifications] couldn't notify a customer", e instanceof Error ? e.message : e);
  }
}

/** The same, after the response has gone back. */
export function notifyCustomerLater(orderId: string, topic: Topic, options: { replyText?: string } = {}): void {
  after(() => notifyCustomer(orderId, topic, options));
}

async function dispatch(admin: SupabaseClient, orderId: string, topic: Topic, replyText: string | undefined, now: Date): Promise<void> {
  const built = await customerViewFor(admin, orderId, now);
  if (!built) return;
  const { orgId, view } = built;
  const [prefs, settings, lastSent] = await Promise.all([getPrefs(admin, orderId), getCustomerPageSettings(admin, orgId), lastRoutineSentAt(admin, orderId)]);
  const summary = topicSummary(topic, view, replyText);
  const decision = decide(topic, prefs, lastSent, now, { minGapHours: settings.minGapHours, dateShiftDays: settings.dateShiftDays });
  const kind = TOPIC_KIND[topic];

  if (decision.action !== "send") {
    await recordNotification(admin, { orgId, orderId, kind, topic, summary, status: decision.action === "hold" ? "held" : "skipped", reason: decision.reason });
    return;
  }
  const held = await listHeld(admin, orderId);
  await send(admin, { orgId, orderId, kind, topic, summaries: [summary, ...held.map((h) => h.summary)], foldIds: held.map((h) => h.id), to: prefs!.email! });
}

async function send(
  admin: SupabaseClient,
  n: { orgId: string; orderId: string; kind: (typeof TOPIC_KIND)[Topic] | "digest"; topic: Topic | "digest"; summaries: string[]; foldIds: string[]; to: string },
): Promise<void> {
  const built = await customerViewFor(admin, n.orderId);
  if (!built) return;
  const code = await trackingCodeOf(admin, n.orderId);
  const track = trackingUrl(code);
  const email = buildCustomerEmail(built.view, n.summaries, { track, preferences: `${track}#updates` });

  // One last check on the finished email, against every supplier and PO in the organisation.
  const secrets = await allSecrets(admin, n.orgId);
  const leaks = findLeaks(`${email.subject}\n${email.text}\n${email.html}`, secrets);
  if (leaks.length > 0) {
    await recordNotification(admin, { orgId: n.orgId, orderId: n.orderId, kind: n.kind, topic: n.topic, summary: n.summaries[0]!, status: "failed", reason: "Blocked: it would have shown supplier details." });
    return;
  }

  const channel = emailChannel();
  const result = await channel.send({ to: n.to, subject: email.subject, text: email.text, html: email.html });
  await recordNotification(admin, {
    orgId: n.orgId,
    orderId: n.orderId,
    kind: n.kind,
    topic: n.topic,
    summary: n.summaries.join(" · "),
    status: result.status,
    reason: result.error ?? (result.status === "logged" ? "Written and logged — email isn't connected yet" : null),
    email: { to: n.to, subject: email.subject, text: email.text, html: email.html, channel: channel.name },
  });
  await markFolded(admin, n.foldIds);
}

async function trackingCodeOf(admin: SupabaseClient, orderId: string): Promise<string> {
  const { data } = await admin.from("sales_orders").select("tracking_code").eq("id", orderId).single<{ tracking_code: string }>();
  return data?.tracking_code ?? "";
}

async function allSecrets(admin: SupabaseClient, orgId: string) {
  const [s, p] = await Promise.all([
    admin.from("suppliers").select("name").eq("org_id", orgId).limit(5000),
    admin.from("purchase_orders").select("po_number").eq("org_id", orgId).limit(20000),
  ]);
  return {
    supplierNames: ((s.data ?? []) as { name: string }[]).map((r) => r.name),
    poNumbers: ((p.data ?? []) as { po_number: string }[]).map((r) => r.po_number),
  };
}

/**
 * Held updates: those waiting for the gap go out once it has passed (folded
 * together); those waiting for the daily summary go out with the summary.
 */
export async function flushHeldNotifications(admin: SupabaseClient, mode: "throttle" | "digest", now: Date = new Date()): Promise<number> {
  const held = await listHeld(admin);
  const byOrder = new Map<string, typeof held>();
  for (const h of held) byOrder.set(h.orderId, [...(byOrder.get(h.orderId) ?? []), h]);
  let sent = 0;
  for (const [orderId, items] of byOrder) {
    try {
      const prefs = await getPrefs(admin, orderId);
      if (!prefs?.email) continue;
      if (mode === "throttle") {
        if (prefs.dailyDigest) continue;
        const settings = await getCustomerPageSettings(admin, items[0]!.orgId);
        if (!heldReadyToSend(await lastRoutineSentAt(admin, orderId), now, { minGapHours: settings.minGapHours, dateShiftDays: settings.dateShiftDays })) continue;
      } else if (!prefs.dailyDigest) continue;
      await send(admin, {
        orgId: items[0]!.orgId,
        orderId,
        kind: mode === "digest" ? "digest" : "milestone",
        topic: mode === "digest" ? "digest" : "date_changed",
        summaries: items.map((i) => i.summary),
        foldIds: items.map((i) => i.id),
        to: prefs.email,
      });
      sent++;
    } catch (e) {
      console.warn("[notifications] couldn't send held updates", e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** The /api/cron/notification-digest job. */
export async function scheduledDigest(): Promise<{ outcome: "ok" | "error"; summariesSent?: number }> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { outcome: "error" };
  return { outcome: "ok", summariesSent: await flushHeldNotifications(admin, "digest") };
}
