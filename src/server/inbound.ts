import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrgPos, insertInboundMessage, provenAnswers, supplierSenders, updateInboundMessage, type NewInboundMessage } from "@/lib/data/inbound";
import { getPurchaseOrder, type PoDetail } from "@/lib/data/procurement";
import { emailChannel } from "@/lib/email/channel";
import { appUrl } from "@/lib/env";
import { findPoNumbers } from "@/lib/logic/email-reading";
import { autoApplyBlockers, checkForwarder, isKnownSender, parseAuthResults, type AuthResults } from "@/lib/logic/inbound-email";
import { refreshPredictionsLater } from "./predictions";
import { answerFromEmail, processSupplierAnswer } from "./supplier-loop";

/**
 * Every supplier email that arrives — forwarded to an organisation's COAST
 * address (Mailgun) or read from its Microsoft 365 mailbox — comes through
 * here (readiness plan Task 3). Service role, and the organisation is fixed
 * before this is called: from the address it was sent to, or from the
 * mailbox's own connection. Everything below looks things up only within
 * that organisation, so a reply can never attach to another organisation's PO.
 */

export interface ArrivedEmail {
  orgId: string;
  channel: "forward" | "m365";
  messageId: string;
  from: string | null;
  envelopeSender: string | null;
  subject: string;
  text: string;
  headers: readonly (readonly [string, string])[];
  /** Forwarding only: the domains the organisation forwards from. */
  allowedDomains?: readonly string[];
}

export type InboundOutcome = { status: NewInboundMessage["status"] | "duplicate"; reason: string; purchaseOrderId?: string };

export async function handleInboundEmail(admin: SupabaseClient, e: ArrivedEmail, now: Date = new Date()): Promise<InboundOutcome> {
  const auth: AuthResults = parseAuthResults(e.headers);
  const base = { orgId: e.orgId, channel: e.channel, messageId: e.messageId, fromAddress: e.from, envelopeSender: e.envelopeSender, subject: e.subject, body: e.text, auth };

  // Forwarded mail must come through the organisation's own mailbox.
  if (e.channel === "forward") {
    const fwd = checkForwarder({ envelopeSender: e.envelopeSender, headers: e.headers, allowedDomains: e.allowedDomains ?? [] });
    if (!fwd.ok) {
      const id = await insertInboundMessage(admin, { ...base, status: "quarantined", reason: fwd.reason });
      return id ? { status: "quarantined", reason: fwd.reason } : { status: "duplicate", reason: "Already received." };
    }
  }

  // Which of THIS organisation's POs is it about? Exactly one, or a person decides.
  const pos = await findOrgPos(admin, e.orgId, findPoNumbers(`${e.subject}\n${e.text}`));
  if (pos.length !== 1) {
    const reason = pos.length === 0 ? "No PO number of yours found in it." : `It mentions ${pos.length} of your POs (${pos.map((p) => p.poNumber).join(", ")}).`;
    const id = await insertInboundMessage(admin, { ...base, status: "unmatched", reason });
    return id ? { status: "unmatched", reason } : { status: "duplicate", reason: "Already received." };
  }

  // Record it first: a retry of the same message stops here.
  const messageRowId = await insertInboundMessage(admin, { ...base, status: "review", reason: "Being read.", purchaseOrderId: pos[0]!.id });
  if (!messageRowId) return { status: "duplicate", reason: "Already received." };

  const po = await getPurchaseOrder(admin, pos[0]!.id);
  if (!po || po.status === "cancelled") {
    const reason = po ? "That PO is cancelled." : "That PO isn't available.";
    await updateInboundMessage(admin, e.orgId, messageRowId, { status: "ignored", reason });
    return { status: "ignored", reason, purchaseOrderId: pos[0]!.id };
  }

  return readEmailIntoPo(admin, e.orgId, { id: messageRowId, channel: e.channel, from: e.from, subject: e.subject, text: e.text, auth }, po, now);
}

/**
 * Read one recorded email as an answer for one of the organisation's POs,
 * and record the outcome. Also used when a person attaches an unmatched or
 * held-back email to a PO (`db` is then their own client). The auto-apply
 * rules always run on the email's own channel: forwarded mail never applies itself.
 */
export async function readEmailIntoPo(
  db: SupabaseClient,
  orgId: string,
  m: { id: string; channel: "forward" | "m365"; from: string | null; subject: string; text: string; auth: AuthResults },
  po: PoDetail,
  now: Date = new Date(),
): Promise<InboundOutcome> {
  const raw = `Subject: ${m.subject}

${m.text}`;
  const { read, score, answer } = answerFromEmail(po, raw, true, now);
  const [senders, proven] = await Promise.all([supplierSenders(db, orgId, po.supplierId), provenAnswers(db, orgId, po.supplierId)]);
  const blockers = autoApplyBlockers({
    mode: m.channel,
    auth: m.auth,
    senderKnown: isKnownSender(m.from, senders),
    provenAnswers: proven,
    mentionsPriceOrQuantity: read.prices.length > 0 || read.partial,
  });
  const result = await processSupplierAnswer(db, {
    orgId,
    po,
    source: "inbound",
    rawText: raw.slice(0, 50000),
    answer,
    confidence: score.confidence,
    extraReasons: [...blockers, ...score.reasons],
    extras: {
      trackingNumbers: read.trackingNumbers.map((t) => t.number),
      currency: score.price?.currency ?? null,
      inboundMessageId: m.id,
      previous: { poStatus: po.status, lines: po.lines.map((l) => ({ poLineId: l.id, confirmedDate: l.confirmedDate, confirmedQuantity: l.confirmedQuantity })) },
    },
    includePrices: true,
  });

  const status = result.outcome === "applied" ? "applied" : "review";
  const reason = result.outcome === "applied" ? `Date applied automatically: ${score.date}.` : result.reasons.join(" ");
  await updateInboundMessage(db, orgId, m.id, { status, reason, purchaseOrderId: po.id, supplierResponseId: result.responseId });
  refreshPredictionsLater(po.lines.map((l) => l.orderId));
  if (result.outcome === "applied") await tellStaffAboutAutoApply(db, orgId, po.id, po.poNumber, score.date, result.responseId);
  return { status, reason, purchaseOrderId: po.id };
}

/**
 * A date moved by itself: the people on the order hear straight away, with
 * a link to undo it in one click (readiness Task 3).
 */
async function tellStaffAboutAutoApply(admin: SupabaseClient, orgId: string, poId: string, poNumber: string, date: string | null, responseId: string): Promise<void> {
  try {
    const { data: lines } = await admin
      .from("purchase_order_lines")
      .select("order_lines(sales_orders(sales_rep_id))")
      .eq("purchase_order_id", poId)
      .returns<{ order_lines: { sales_orders: { sales_rep_id: string | null } | null } | null }[]>();
    const reps = [...new Set((lines ?? []).map((l) => l.order_lines?.sales_orders?.sales_rep_id).filter((x): x is string => Boolean(x)))];
    let q = admin.from("staff_users").select("email").eq("org_id", orgId).eq("is_active", true);
    q = reps.length ? q.in("id", reps) : q.eq("role", "procurement");
    const { data: people } = await q.limit(20).returns<{ email: string }[]>();
    const link = `${appUrl()}/app/purchase-orders/${poId}?undo=${responseId}`;
    for (const p of people ?? []) {
      await emailChannel().send({
        to: p.email,
        subject: `${poNumber}: supplier's date applied automatically`,
        text: `The supplier confirmed ${poNumber}${date ? ` for ${date}` : ""} by email, and COAST applied it automatically.\n\nNot right? Undo it in one click: ${link}`,
        html: `<p>The supplier confirmed <strong>${poNumber}</strong>${date ? ` for ${date}` : ""} by email, and COAST applied it automatically.</p><p>Not right? <a href="${link}">Undo it in one click</a>.</p>`,
      });
    }
  } catch (err) {
    console.warn("[inbound] couldn't tell staff about an automatic date", err instanceof Error ? err.message : err);
  }
}
