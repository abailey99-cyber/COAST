"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPrefs, hitRateLimit, insertCustomerMessage, normaliseTrackingCode, savePrefs, findOrderByTrackingCode } from "@/lib/data/customer-portal";
import { isNotifyLevel } from "@/lib/logic/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { lookUpTrackingCode, visitorKey } from "./customer-view";
import { alertStaffToCustomerMessage } from "./customer-staff-alerts";
import { readPhotos, savePhotos } from "./problem-photos";
import { countCustomerReportsToday, insertProblem } from "@/lib/data/problems";
import { ukDateOf, ukToday } from "@/lib/logic/prediction";
import { CATEGORY_LABELS, claimDeadline, validateReport } from "@/lib/logic/problems";

/**
 * What a customer can do without signing in, scoped by the tracking code
 * they hold. Rate-limited per visitor. Nothing here returns internal data.
 */

export interface PortalResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const NOT_FOUND = "We couldn't find an order with that tracking code. Check it and try again.";
const SLOW_DOWN = "Too many tries. Please wait a few minutes and try again.";

/** "Track an order": a code → that order's page. */
export async function trackOrder(_prev: PortalResult, formData: FormData): Promise<PortalResult> {
  const r = await lookUpTrackingCode(String(formData.get("code") ?? ""));
  if (r.state === "slow_down") return { ok: false, error: SLOW_DOWN };
  if (r.state === "unavailable") return { ok: false, error: "Tracking isn't available right now. Please try again later." };
  if (r.state === "not_found") return { ok: false, error: NOT_FOUND };
  redirect(`/track/${r.code}`);
}

async function scoped(code: string, bucket: string, limit: number) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: "This isn't available right now. Please try again later." } as const;
  const who = await visitorKey();
  if (!(await hitRateLimit(admin, `${bucket}:${who}`, limit, 3600))) return { error: SLOW_DOWN } as const;
  const normal = normaliseTrackingCode(code);
  const found = normal ? await findOrderByTrackingCode(admin, normal) : null;
  if (!found || !normal) return { error: NOT_FOUND } as const;
  return { admin, code: normal, ...found } as const;
}

/** A customer writes about their order. The rep (or procurement) hears straight away. */
export async function sendCustomerMessage(code: string, _prev: PortalResult, formData: FormData): Promise<PortalResult> {
  try {
    const body = String(formData.get("body") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim().slice(0, 120) || null;
    if (!body) return { ok: false, error: "Write your message first." };
    if (body.length > 4000) return { ok: false, error: "Please keep your message under 4,000 characters." };
    const s = await scoped(code, "message", 20);
    if ("error" in s) return { ok: false, error: s.error };
    await insertCustomerMessage(s.admin, s.orgId, s.orderId, name, body);
    await alertStaffToCustomerMessage(s.admin, s.orgId, s.orderId, body);
    revalidatePath(`/track/${s.code}`);
    revalidatePath(`/app/orders/${s.orderId}`);
    return { ok: true, message: "Sent. We'll reply here, and by email if you've chosen updates." };
  } catch {
    return { ok: false, error: "Your message couldn't be sent. Please try again." };
  }
}

/** A customer chooses how much they hear (spec §5.5). */
export async function saveCustomerUpdates(code: string, _prev: PortalResult, formData: FormData): Promise<PortalResult> {
  try {
    const level = String(formData.get("level") ?? "");
    if (!isNotifyLevel(level)) return { ok: false, error: "Choose how much you'd like to hear." };
    const emailText = String(formData.get("email") ?? "").trim();
    const email = emailText ? emailText.slice(0, 254) : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
    const s = await scoped(code, "prefs", 30);
    if ("error" in s) return { ok: false, error: s.error };
    const before = await getPrefs(s.admin, s.orderId);
    // A blank box keeps the address already saved (the page only shows a hint of it).
    await savePrefs(s.admin, s.orderId, null, { email: email ?? undefined, level, dailyDigest: formData.get("digest") === "on" });
    revalidatePath(`/track/${s.code}`);
    const has = email ?? before?.email ?? null;
    return { ok: true, message: !has ? "Saved. Add an email address to get updates." : email && email !== before?.email ? "Saved. Updates will go to that address." : "Saved." };
  } catch {
    return { ok: false, error: "That couldn't be saved. Please try again." };
  }
}

/**
 * A customer reports a problem with their delivery (spec §5.4): what's
 * wrong, which items, a few words and up to five photos. Rate-limited per
 * visitor and per order. The rep (or procurement) hears straight away;
 * the customer only ever sees a customer-safe status back.
 */
export async function reportCustomerProblem(code: string, _prev: PortalResult | null, formData: FormData): Promise<PortalResult> {
  try {
    const s = await scoped(code, "problem", 10);
    if ("error" in s) return { ok: false, error: s.error };
    if ((await countCustomerReportsToday(s.admin, s.orderId, new Date(Date.now() - 86_400_000).toISOString())) >= 5) {
      return { ok: false, error: "We've had several reports on this order today. Please send us a message instead." };
    }
    const { data: lines } = await s.admin.from("order_lines").select("id, line_no, stage").eq("sales_order_id", s.orderId).returns<{ id: string; line_no: number; stage: string }[]>();
    const live = (lines ?? []).filter((l) => l.stage !== "cancelled");
    // The page only knows line numbers; turn them into this order's own lines.
    const wanted = new Set(formData.getAll("lines").map(String));
    const r = validateReport(
      { category: String(formData.get("category") ?? ""), description: String(formData.get("description") ?? ""), lineIds: live.filter((l) => wanted.has(String(l.line_no))).map((l) => l.id) },
      live.map((l) => l.id),
    );
    if (!r.ok) return { ok: false, error: r.error.replace("Choose which items", "Tick which items") };
    const photos = await readPhotos(formData);
    if (!photos.ok) return { ok: false, error: photos.error };
    const name = String(formData.get("name") ?? "").trim().slice(0, 120) || null;

    // Tie it to the delivery the customer saw, when there's exactly one.
    const { data: shipments } = await s.admin.from("shipments").select("id, carrier, delivered_at").eq("sales_order_id", s.orderId).neq("leg", "inbound").returns<{ id: string; carrier: string; delivered_at: string | null }[]>();
    const only = shipments?.length === 1 ? shipments[0]! : null;
    let deadline: string | null = null;
    if (only) {
      const { data: cs } = await s.admin.from("carrier_settings").select("claim_window_days").eq("org_id", s.orgId).eq("carrier", only.carrier).maybeSingle<{ claim_window_days: number | null }>();
      deadline = claimDeadline(cs?.claim_window_days ?? null, only.delivered_at ? ukDateOf(only.delivered_at) : ukToday(new Date()));
    }
    const id = await insertProblem(s.admin, {
      orgId: s.orgId,
      orderId: s.orderId,
      shipmentId: only?.id ?? null,
      raisedVia: "customer",
      category: r.value.category,
      description: r.value.description,
      reporterName: name,
      claimDeadline: deadline,
      lines: r.value.lineIds.map((l) => ({ orderLineId: l, quantity: null })),
    });
    const saved = photos.photos.length > 0 ? await savePhotos(s.admin, s.orgId, id, photos.photos, { kind: "customer", userId: null }) : 0;
    await alertStaffToCustomerMessage(s.admin, s.orgId, s.orderId, `Delivery problem reported — ${CATEGORY_LABELS[r.value.category]}${r.value.description ? `: ${r.value.description}` : ""}`, `/app/problems/${id}`);
    revalidatePath(`/track/${s.code}`);
    revalidatePath(`/app/orders/${s.orderId}`);
    revalidatePath("/app/problems");
    const lost = photos.photos.length - saved;
    return { ok: true, message: `Thanks — we've got your report and we're looking into it. You'll see updates here.${lost > 0 ? " Some photos didn't upload; you can send them in a message." : ""}` };
  } catch {
    return { ok: false, error: "Your report couldn't be sent. Please try again, or send us a message." };
  }
}
