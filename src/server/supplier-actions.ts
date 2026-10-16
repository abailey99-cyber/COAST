"use server";

import { revalidatePath } from "next/cache";
import { emailChannel } from "@/lib/email/channel";
import { getLineForStageChange } from "@/lib/data/orders";
import { getPurchaseOrder, updatePoStatus } from "@/lib/data/procurement";
import {
  applyAnswer,
  getChase,
  getChaseSettings,
  getResponse,
  openInternalChase,
  openSupplierChase,
  recordChased,
  recordEmail,
  rejectResponse,
  replaceLink,
  resolveChase,
  revokeLink,
  updateChaseSettings,
} from "@/lib/data/supplier-loop";
import { appUrl } from "@/lib/env";
import { thresholdsProblem } from "@/lib/logic/escalation";
import { formatDateTime, formatIsoDate } from "@/lib/logic/format";
import { hasPermission } from "@/lib/logic/permissions";
import { buildChaseEmail, buildPoEmail, type EmailMessage } from "@/lib/logic/po-email";
import { confirmedLines, isFullyConfirmed, validateLinkAnswer } from "@/lib/logic/supplier-response";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotAllowedError, requirePermission, requireStaffForAction, type StaffContext } from "./session";
import { answerFromEmail, poLinesForCheck, processSupplierAnswer } from "./supplier-loop";
import { addSupplierShipments } from "./shipments";
import { refreshPredictionsLater } from "./predictions";
import { newLinkToken } from "./tokens";
import { linkExpiry, linkLifetimeProblem } from "@/lib/logic/supplier-link";

export interface LoopResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Shown once, so staff can send it themselves while email isn't connected. */
  link?: string;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function failure(e: unknown, fallback: string): LoopResult {
  if (e instanceof NotAllowedError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

async function requireProcurement(): Promise<StaffContext> {
  const staff = await requirePermission("procurement.manage");
  if (!hasPermission(staff.permissions, "supplier.identity.view")) throw new NotAllowedError();
  return staff;
}

/** Stored emails never contain the link code; staff see it once, on screen. */
function redact(message: EmailMessage, url: string): EmailMessage {
  const hidden = `${appUrl()}/confirm/[link hidden — shown once when it was made]`;
  return { ...message, text: message.text.split(url).join(hidden), html: message.html.split(url).join(hidden) };
}

async function newLink(supabase: Awaited<ReturnType<typeof client>>, poId: string, userId: string): Promise<{ url: string; expires: Date }> {
  const { token, hash } = newLinkToken();
  // The company's chosen lifetime (readiness Task 5B).
  const expires = linkExpiry(new Date(), (await getChaseSettings(supabase)).linkLifetimeDays);
  await replaceLink(supabase, poId, userId, hash, expires);
  return { url: `${appUrl()}/confirm/${token}`, expires };
}

function revalidatePo(poId: string) {
  revalidatePath(`/app/purchase-orders/${poId}`);
  revalidatePath("/app/purchase-orders");
  revalidatePath("/app/orders", "layout");
  revalidatePath("/app/review-queue");
}

// ── Send the PO ─────────────────────────────────────────────────────────────
export async function sendPoToSupplier(poId: string): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    const supabase = await client();
    const po = await getPurchaseOrder(supabase, poId);
    if (!po) return { ok: false, error: "That purchase order isn't available." };
    if (po.status === "cancelled" || po.status === "confirmed") return { ok: false, error: "This purchase order is already confirmed or cancelled." };
    if (!po.supplierEmail) return { ok: false, error: "This supplier has no email address yet. Add one on the Suppliers screen, or send it yourself and mark it as sent." };

    const { url, expires } = await newLink(supabase, po.id, staff.id);
    const deliverTo = [...new Set(po.lines.map((l) => l.deliverTo).filter((d): d is string => Boolean(d)))];
    const message = buildPoEmail({
      to: po.supplierEmail,
      buyerName: staff.orgName,
      supplierName: po.supplierName,
      poNumber: po.poNumber,
      lines: po.lines.map((l) => ({ description: l.description, sku: l.sku, quantity: l.quantity, requestedDate: l.requestedDate })),
      deliverTo: deliverTo.length ? deliverTo.join(" / ") : null,
      confirmUrl: url,
      linkExpires: formatIsoDate(expires.toISOString().slice(0, 10)),
    });
    const channel = emailChannel();
    const sent = await channel.send(message);
    const stored = redact(message, url);
    await recordEmail(supabase, { orgId: staff.orgId, kind: "po", purchaseOrderId: po.id, to: message.to, subject: message.subject, text: stored.text, html: stored.html, channel: channel.name, status: sent.status, error: sent.error });
    if (po.status === "draft") await updatePoStatus(supabase, po.id, "draft", "sent");
    refreshPredictionsLater(po.lines.map((l) => l.orderId));
    revalidatePo(po.id);
    return {
      ok: true,
      message: sent.status === "sent" ? `Sent to ${message.to}.` : `Email written and logged. It isn't sent automatically yet — send the supplier this link yourself:`,
      link: sent.status === "sent" ? undefined : url,
    };
  } catch (e) {
    return failure(e, "The purchase order couldn't be sent. Try again.");
  }
}

export async function makeNewLink(poId: string): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    const supabase = await client();
    const po = await getPurchaseOrder(supabase, poId);
    if (!po || po.status === "cancelled") return { ok: false, error: "That purchase order isn't available." };
    const { url } = await newLink(supabase, po.id, staff.id);
    revalidatePo(po.id);
    return { ok: true, message: "New link made. Any older link has stopped working. Copy it now — for security it won't be shown again:", link: url };
  } catch (e) {
    return failure(e, "The link couldn't be made. Try again.");
  }
}

export async function revokePoLink(poId: string, linkId: string): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    const done = await revokeLink(await client(), linkId, staff.id);
    revalidatePo(poId);
    return done ? { ok: true, message: "Link revoked. It no longer works." } : { ok: false, error: "That link was already revoked." };
  } catch (e) {
    return failure(e, "The link couldn't be revoked. Try again.");
  }
}

// ── Chase the supplier ──────────────────────────────────────────────────────
export async function chaseSupplier(poId: string): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    const supabase = await client();
    const po = await getPurchaseOrder(supabase, poId);
    if (!po) return { ok: false, error: "That purchase order isn't available." };
    if (po.status !== "sent") return { ok: false, error: "Only sent, unconfirmed purchase orders can be chased." };
    if (!po.supplierEmail) return { ok: false, error: "This supplier has no email address. Add one on the Suppliers screen." };

    const chase = await openSupplierChase(supabase, staff.orgId, po.id);
    const { url } = await newLink(supabase, po.id, staff.id);
    const message = buildChaseEmail({
      to: po.supplierEmail,
      buyerName: staff.orgName,
      supplierName: po.supplierName,
      poNumber: po.poNumber,
      sentOn: formatDateTime(new Date(po.sentAt ?? po.createdAt)).split(",")[0]!,
      confirmUrl: url,
      chaseNumber: chase.chaseCount + 1,
    });
    const channel = emailChannel();
    const sent = await channel.send(message);
    const stored = redact(message, url);
    await recordEmail(supabase, { orgId: staff.orgId, kind: "po_chase", purchaseOrderId: po.id, to: message.to, subject: message.subject, text: stored.text, html: stored.html, channel: channel.name, status: sent.status, error: sent.error });
    await recordChased(supabase, chase);
    revalidatePo(po.id);
    return {
      ok: true,
      message: sent.status === "sent" ? "Chase sent." : "Chase written and logged. It isn't sent automatically yet — this new link replaces the old one:",
      link: sent.status === "sent" ? undefined : url,
    };
  } catch (e) {
    return failure(e, "The chase couldn't be recorded. Try again.");
  }
}

export async function resolveSupplierChase(poId: string, chaseId: string): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    await resolveChase(await client(), chaseId, staff.id, "Resolved by hand.");
    revalidatePo(poId);
    return { ok: true };
  } catch (e) {
    return failure(e, "The chase couldn't be closed. Try again.");
  }
}

// ── Paste a supplier's reply ────────────────────────────────────────────────
export async function pasteSupplierReply(poId: string, _prev: LoopResult, formData: FormData): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    const raw = String(formData.get("email") ?? "").slice(0, 50000);
    if (!raw.trim()) return { ok: false, error: "Paste the supplier's email first." };
    const supabase = await client();
    const po = await getPurchaseOrder(supabase, poId);
    if (!po) return { ok: false, error: "That purchase order isn't available." };
    if (po.status === "cancelled") return { ok: false, error: "This purchase order is cancelled." };

    const canSeeCosts = hasPermission(staff.permissions, "costs.view");
    const { read, score, answer } = answerFromEmail(po, raw, canSeeCosts, new Date());
    const result = await processSupplierAnswer(supabase, {
      orgId: staff.orgId,
      po,
      source: "paste",
      rawText: raw,
      answer,
      confidence: score.confidence,
      extraReasons: score.reasons,
      extras: { trackingNumbers: read.trackingNumbers.map((t) => t.number), currency: score.price?.currency ?? null },
      includePrices: canSeeCosts,
    });
    refreshPredictionsLater(po.lines.map((l) => l.orderId));
    revalidatePo(po.id);
    return result.outcome === "applied"
      ? { ok: true, message: `Read with high confidence and applied: confirmed for ${formatIsoDate(score.date)}.${result.shipmentsAdded > 0 ? ` Tracking added as ${result.shipmentsAdded === 1 ? "a shipment" : `${result.shipmentsAdded} shipments`}.` : ""}` }
      : { ok: true, message: `Sent to the review queue: ${result.reasons.join(" ")}` };
  } catch (e) {
    return failure(e, "The email couldn't be read. Try again.");
  }
}

// ── Review queue ────────────────────────────────────────────────────────────
export async function acceptReviewedResponse(responseId: string, _prev: LoopResult, formData: FormData): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    const supabase = await client();
    const response = await getResponse(supabase, responseId);
    if (!response || response.status !== "needs_review") return { ok: false, error: "That answer has already been dealt with." };
    const po = await getPurchaseOrder(supabase, response.purchaseOrderId);
    if (!po) return { ok: false, error: "That purchase order isn't available." };

    const check = { currency: po.currency, lines: poLinesForCheck(po) };
    const canSeeCosts = hasPermission(staff.permissions, "costs.view");
    const result = validateLinkAnswer(
      po.lines.map((l) => ({
        poLineId: l.id,
        available: formData.get(`available.${l.id}`) === "on",
        quantity: String(formData.get(`quantity.${l.id}`) ?? ""),
        date: String(formData.get(`date.${l.id}`) ?? ""),
        unitPrice: canSeeCosts ? String(formData.get(`price.${l.id}`) ?? "") : "",
      })),
      check,
    );
    if (!result.ok) return { ok: false, error: Object.values(result.errors).join(" ") };
    const confirmed = confirmedLines(result.answer, check);
    await applyAnswer(supabase, {
      purchaseOrderId: po.id,
      responseId,
      reviewStatus: "accepted",
      lines: confirmed,
      fullyConfirmed: isFullyConfirmed(confirmed, check),
      includePrices: canSeeCosts,
    });
    const added = await addSupplierShipments(supabase, po, response.extras.trackingNumbers ?? []);
    refreshPredictionsLater(po.lines.map((l) => l.orderId));
    revalidatePo(po.id);
    const shipped = added > 0 ? ` ${added === 1 ? "A shipment was" : `${added} shipments were`} added from the tracking numbers.` : "";
    return { ok: true, message: (isFullyConfirmed(confirmed, check) ? `${po.poNumber} confirmed.` : `Saved. ${po.poNumber} isn't fully confirmed yet.`) + shipped };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

export async function rejectReviewedResponse(responseId: string, note: string): Promise<LoopResult> {
  try {
    const staff = await requireProcurement();
    const supabase = await client();
    const response = await getResponse(supabase, responseId);
    const done = await rejectResponse(supabase, responseId, staff.id, note.trim().slice(0, 2000) || null);
    if (response) revalidatePo(response.purchaseOrderId);
    return done ? { ok: true, message: "Marked as not relevant. Nothing on the PO changed." } : { ok: false, error: "That answer has already been dealt with." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

// ── Internal chases: sales → procurement ────────────────────────────────────
export async function raiseInternalChase(lineId: string, note: string): Promise<LoopResult> {
  try {
    const staff = await requirePermission("chases.internal");
    const text = note.trim().slice(0, 2000);
    if (!text) return { ok: false, error: "Say what you need to know." };
    const supabase = await client();
    const line = await getLineForStageChange(supabase, lineId);
    if (!line) return { ok: false, error: "That line isn't available." };
    await openInternalChase(supabase, staff.orgId, line.salesOrderId, lineId, text);
    revalidatePath(`/app/orders/${line.salesOrderId}`);
    return { ok: true, message: "Procurement has been asked." };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("There's already")) return { ok: false, error: e.message };
    return failure(e, "The chase couldn't be raised. Try again.");
  }
}

export async function resolveInternalChase(chaseId: string, reply: string): Promise<LoopResult> {
  try {
    const staff = await requireStaffForAction();
    const supabase = await client();
    const chase = await getChase(supabase, chaseId);
    if (!chase || chase.kind !== "internal") return { ok: false, error: "That chase isn't available." };
    if (!hasPermission(staff.permissions, "procurement.manage") && chase.openedBy !== staff.id) throw new NotAllowedError();
    const done = await resolveChase(supabase, chaseId, staff.id, reply.trim().slice(0, 2000) || null);
    if (chase.salesOrderId) revalidatePath(`/app/orders/${chase.salesOrderId}`);
    return done ? { ok: true } : { ok: false, error: "That chase is already closed." };
  } catch (e) {
    return failure(e, "The chase couldn't be closed. Try again.");
  }
}

// ── Escalation settings ─────────────────────────────────────────────────────
export async function saveChaseSettings(_prev: LoopResult, formData: FormData): Promise<LoopResult> {
  try {
    const staff = await requirePermission("settings.edit");
    const n = (k: string) => Number(String(formData.get(k) ?? "").trim());
    const s = { amberHours: n("amberHours"), redHours: n("redHours"), alertHours: n("alertHours"), dayStartHour: n("dayStartHour"), dayEndHour: n("dayEndHour"), linkLifetimeDays: n("linkLifetimeDays") };
    if (![s.amberHours, s.redHours, s.alertHours, s.dayStartHour, s.dayEndHour].every(Number.isInteger)) return { ok: false, error: "Use whole numbers." };
    const problem = thresholdsProblem(s);
    if (problem) return { ok: false, error: problem };
    if (s.dayStartHour < 0 || s.dayEndHour > 24 || s.dayStartHour >= s.dayEndHour) return { ok: false, error: "The working day must start before it ends (hours 0–24)." };
    const linkProblem = linkLifetimeProblem(s.linkLifetimeDays);
    if (linkProblem) return { ok: false, error: linkProblem };
    await updateChaseSettings(await client(), staff.orgId, staff.id, s);
    revalidatePath("/app", "layout");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return failure(e, "The settings couldn't be saved. Try again.");
  }
}
