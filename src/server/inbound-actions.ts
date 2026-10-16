"use server";

import { revalidatePath } from "next/cache";
import { deleteInboundAddress, getInboundAddress, getInboundMessage, saveInboundAddress, updateInboundMessage } from "@/lib/data/inbound";
import { getPurchaseOrder, saveKnownSenders } from "@/lib/data/procurement";
import { normaliseDomain, type AuthResults } from "@/lib/logic/inbound-email";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readEmailIntoPo } from "./inbound";
import { refreshPredictionsLater } from "./predictions";
import { NotAllowedError, requireAdmin, requirePermission } from "./session";

/** Supplier replies by email (readiness Task 3): settings, sorting out unmatched mail, and undoing a date. */

export interface InboundResult {
  ok: boolean;
  message?: string;
  error?: string;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function failure(e: unknown, fallback: string): InboundResult {
  if (e instanceof NotAllowedError) return { ok: false, error: e.message };
  if (e instanceof Error && e.message === "not-allowed") return { ok: false, error: "Only an admin can change this." };
  console.warn("[inbound]", e instanceof Error ? e.message : e);
  return { ok: false, error: fallback };
}

/** Create the organisation's forwarding address, or change the domains its mail must be forwarded from. */
export async function saveForwarding(_prev: InboundResult | null, formData: FormData): Promise<InboundResult> {
  try {
    const staff = await requireAdmin();
    const domains: string[] = [];
    for (const part of String(formData.get("domains") ?? "").split(/[\s,]+/)) {
      const d = normaliseDomain(part);
      if (d === "invalid") return { ok: false, error: `"${part.slice(0, 60)}" doesn't look like a domain (e.g. yourcompany.co.uk).` };
      if (d && !domains.includes(d)) domains.push(d);
    }
    if (domains.length === 0) return { ok: false, error: "Enter the domain your purchasing mailbox is on, e.g. yourcompany.co.uk." };
    if (domains.length > 10) return { ok: false, error: "Up to 10 domains." };
    const supabase = await client();
    const had = await getInboundAddress(supabase);
    await saveInboundAddress(supabase, staff.orgId, domains);
    revalidatePath("/app/settings");
    return { ok: true, message: had ? "Saved." : "Your forwarding address is ready. Set your mailbox to forward supplier replies to it." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

/** A new address: the old one stops working straight away (e.g. if it leaked). */
export async function replaceForwardingAddress(): Promise<InboundResult> {
  try {
    const staff = await requireAdmin();
    const supabase = await client();
    const had = await getInboundAddress(supabase);
    if (!had) return { ok: false, error: "There's no address yet." };
    await deleteInboundAddress(supabase, staff.orgId);
    await saveInboundAddress(supabase, staff.orgId, had.allowedDomains);
    revalidatePath("/app/settings");
    return { ok: true, message: "New address made. Update your mailbox's forwarding rule — mail to the old address is no longer accepted." };
  } catch (e) {
    return failure(e, "That couldn't be changed. Try again.");
  }
}

/** Read an unmatched or held-back email as an answer for one of the organisation's POs. A person chose it, so it always goes to review if it's forwarded. */
export async function attachEmailToPo(messageId: string, _prev: InboundResult | null, formData: FormData): Promise<InboundResult> {
  try {
    const staff = await requirePermission("procurement.manage");
    const supabase = await client();
    const m = await getInboundMessage(supabase, messageId);
    if (!m) return { ok: false, error: "That email isn't available." };
    if (m.status !== "unmatched" && m.status !== "quarantined") return { ok: false, error: "That email has already been dealt with." };
    const poNumber = String(formData.get("poNumber") ?? "").trim().toUpperCase();
    // RLS keeps this to the person's own organisation's POs.
    const { data: po } = await supabase.from("purchase_orders").select("id").eq("po_number", poNumber).maybeSingle<{ id: string }>();
    const detail = po ? await getPurchaseOrder(supabase, po.id) : null;
    if (!detail) return { ok: false, error: `There's no PO ${poNumber || "with that number"}.` };
    if (detail.status === "cancelled") return { ok: false, error: "That PO is cancelled." };
    const auth = (m.auth && "spf" in m.auth ? m.auth : { spf: "unknown", dkim: "unknown", dmarc: "unknown" }) as AuthResults;
    const outcome = await readEmailIntoPo(supabase, staff.orgId, { id: m.id, channel: m.channel, from: m.fromAddress, subject: m.subject ?? "", text: m.body ?? "", auth }, detail);
    revalidatePath("/app/review-queue");
    revalidatePath(`/app/purchase-orders/${detail.id}`);
    return { ok: true, message: outcome.status === "applied" ? `Applied to ${detail.poNumber}.` : `Read against ${detail.poNumber} and sent for review.` };
  } catch (e) {
    return failure(e, "That couldn't be attached. Try again.");
  }
}

export async function dismissEmail(messageId: string): Promise<InboundResult> {
  try {
    const staff = await requirePermission("procurement.manage");
    if (!(await updateInboundMessage(await client(), staff.orgId, messageId, { status: "ignored", reason: `Dismissed by ${staff.fullName}.` }))) return { ok: false, error: "That email isn't available." };
    revalidatePath("/app/review-queue");
    return { ok: true, message: "Dismissed." };
  } catch (e) {
    return failure(e, "That couldn't be dismissed. Try again.");
  }
}

/** One click: put back a date that applied itself from an email. */
export async function undoAutomaticDate(responseId: string): Promise<InboundResult> {
  try {
    await requirePermission("procurement.manage");
    const supabase = await client();
    const { data: r } = await supabase.from("supplier_responses").select("purchase_order_id").eq("id", responseId).maybeSingle<{ purchase_order_id: string }>();
    if (!r) return { ok: false, error: "That answer isn't available." };
    const { error } = await supabase.rpc("undo_supplier_answer", { p_response: responseId });
    if (error) return { ok: false, error: /already undone/.test(error.message) ? "That was already undone." : /nothing to undo/.test(error.message) ? "Only a date that applied itself can be undone here." : "That couldn't be undone. Try again." };
    const po = await getPurchaseOrder(supabase, r.purchase_order_id);
    refreshPredictionsLater(po?.lines.map((l) => l.orderId) ?? []);
    revalidatePath(`/app/purchase-orders/${r.purchase_order_id}`);
    revalidatePath("/app/review-queue");
    return { ok: true, message: "Undone. The PO is back as it was, and the supplier's email is still there to check." };
  } catch (e) {
    return failure(e, "That couldn't be undone. Try again.");
  }
}

/** The other addresses a supplier's replies come from (only these, and its main email, count as known contacts). */
export async function saveSupplierSenders(supplierId: string, _prev: InboundResult | null, formData: FormData): Promise<InboundResult> {
  try {
    await requirePermission("procurement.manage");
    const senders: string[] = [];
    for (const part of String(formData.get("senders") ?? "").split(/[\s,;]+/)) {
      const v = part.trim().toLowerCase();
      if (!v) continue;
      if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return { ok: false, error: `"${v.slice(0, 60)}" isn't an email address.` };
      if (!senders.includes(v)) senders.push(v);
    }
    if (senders.length > 20) return { ok: false, error: "Up to 20 addresses." };
    if (!(await saveKnownSenders(await client(), supplierId, senders))) return { ok: false, error: "That supplier isn't available." };
    revalidatePath("/app/suppliers");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}
