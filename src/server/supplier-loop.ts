import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPurchaseOrder, type PoDetail } from "@/lib/data/procurement";
import { listStaffInOrg } from "@/lib/data/staff";
import {
  applyAnswer,
  countNeedsReview,
  getChaseSettings,
  insertResponse,
  listChases,
  listEmailsForPo,
  listLinksForPo,
  listResponses,
  resolveSupplierChases,
  type ChaseSettings,
} from "@/lib/data/supplier-loop";
import { CONFIDENCE_LABELS, type Confidence } from "@/lib/logic/email-reading";
import { ESCALATION_LABELS, describeWait, escalate, type EscalationLevel } from "@/lib/logic/escalation";
import { formatDateTime, formatIsoDate, formatMoney, formatQuantity, type Currency } from "@/lib/logic/format";
import { hasPermission } from "@/lib/logic/permissions";
import {
  confirmedLines,
  decide,
  detectDiscrepancies,
  isFullyConfirmed,
  type PoLineForCheck,
  type ResponseSource,
  type SupplierAnswer,
} from "@/lib/logic/supplier-response";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "./session";
import { addSupplierShipments } from "./shipments";

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

/** PO lines as the checks see them: "Line 1 (Shelving unit)". */
export function poLinesForCheck(po: PoDetail): PoLineForCheck[] {
  return po.lines.map((l, i) => ({
    poLineId: l.id,
    lineLabel: `Line ${i + 1} (${l.description})`,
    quantity: l.quantity,
    requestedDate: l.requestedDate,
    unitCostMinor: l.unitCostMinor,
  }));
}

export interface ProcessResult {
  outcome: "applied" | "needs_review";
  reasons: string[];
  /** Shipments added from tracking numbers in the answer (applied answers only). */
  shipmentsAdded: number;
}

/**
 * The one path every supplier answer takes, whatever the source: check it
 * against the PO, then either apply it (certain and matching) or queue it
 * for a person. `db` is the signed-in client, or the service-role client
 * for the public confirmation link.
 */
export async function processSupplierAnswer(
  db: SupabaseClient,
  a: {
    orgId: string;
    po: PoDetail;
    source: ResponseSource;
    rawText: string | null;
    answer: SupplierAnswer;
    confidence: Confidence;
    extraReasons: string[];
    extras: { trackingNumbers?: string[]; supplierReference?: string; note?: string; currency?: string | null };
    linkId?: string;
    includePrices: boolean;
  },
): Promise<ProcessResult> {
  const check = { currency: a.po.currency, lines: poLinesForCheck(a.po) };
  const discrepancies = detectDiscrepancies(check, a.answer);
  const decision = decide(a.source, a.confidence, discrepancies, a.extraReasons);
  const reasons = decision.action === "review" ? decision.reasons : [];

  let shipmentsAdded = 0;
  const responseId = await insertResponse(db, {
    orgId: a.orgId,
    purchaseOrderId: a.po.id,
    source: a.source,
    rawText: a.rawText,
    lines: a.answer.lines,
    extras: a.extras,
    confidence: a.confidence,
    reasons,
    status: decision.action === "apply" ? "applied" : "needs_review",
    linkId: a.linkId,
  });

  if (decision.action === "apply") {
    const confirmed = confirmedLines(a.answer, check);
    await applyAnswer(db, {
      purchaseOrderId: a.po.id,
      responseId,
      reviewStatus: "applied",
      lines: confirmed,
      fullyConfirmed: isFullyConfirmed(confirmed, check),
      includePrices: a.includePrices,
    });
    shipmentsAdded = await addSupplierShipments(db, a.po, a.extras.trackingNumbers ?? []);
  }
  // Either way the supplier has answered, so any open chase is done.
  await resolveSupplierChases(db, a.po.id, decision.action === "apply" ? "Supplier confirmed." : "Supplier replied; waiting for review.");
  return { outcome: decision.action === "apply" ? "applied" : "needs_review", reasons, shipmentsAdded };
}

// ── PO page: everything about talking to the supplier ───────────────────────
export interface Waiting {
  level: EscalationLevel;
  label: string;
  wait: string;
}

export function waitingFor(since: string | null, now: Date, settings: ChaseSettings): Waiting | null {
  if (!since) return null;
  const e = escalate(new Date(since), now, settings.thresholds, settings.calendar);
  const hoursPerDay = settings.calendar.dayEndHour - settings.calendar.dayStartHour;
  return { level: e.level, label: ESCALATION_LABELS[e.level], wait: describeWait(e.waitedHours, hoursPerDay) };
}

const RESPONSE_STATUS: Record<string, string> = {
  applied: "Applied automatically",
  needs_review: "Waiting for review",
  accepted: "Accepted after review",
  rejected: "Rejected",
};

const SOURCE_LABELS: Record<ResponseSource, string> = { link: "Confirmation link", paste: "Pasted email", inbound: "Email" };

export async function loadPoCommunication(po: PoDetail) {
  const staff = await requireStaff({ section: "purchase-orders" });
  const supabase = await client();
  const now = new Date();
  const [emails, links, responses, chases, settings, team] = await Promise.all([
    listEmailsForPo(supabase, po.id),
    listLinksForPo(supabase, po.id),
    listResponses(supabase, { poId: po.id }),
    listChases(supabase, { poId: po.id }),
    getChaseSettings(supabase),
    listStaffInOrg(supabase),
  ]);
  const names = new Map(team.map((p) => [p.id, p.fullName]));
  const canManage = hasPermission(staff.permissions, "procurement.manage");
  const canSeeCosts = hasPermission(staff.permissions, "costs.view");
  const openChase = chases.find((c) => c.status === "open" && c.kind === "supplier") ?? null;
  const awaiting = po.status === "sent";

  return {
    canManage,
    hasSupplierEmail: Boolean(po.supplierEmail),
    waiting: awaiting ? waitingFor(po.sentAt ?? po.createdAt, now, settings) : null,
    sentAt: po.sentAt ? formatDateTime(new Date(po.sentAt)) : null,
    confirmedAt: po.confirmedAt ? formatDateTime(new Date(po.confirmedAt)) : null,
    openChase: openChase
      ? {
          id: openChase.id,
          count: openChase.chaseCount,
          last: openChase.lastChasedAt ? formatDateTime(new Date(openChase.lastChasedAt)) : null,
          waiting: waitingFor(openChase.openedAt, now, settings),
        }
      : null,
    links: links.map((l) => {
      const state = l.revokedAt ? "Revoked" : new Date(l.expiresAt) < now ? "Expired" : "Active";
      return {
        id: l.id,
        state,
        created: formatDateTime(new Date(l.createdAt)),
        expires: formatDateTime(new Date(l.expiresAt)),
        opened: l.lastOpenedAt ? formatDateTime(new Date(l.lastOpenedAt)) : null,
      };
    }),
    emails: emails.map((e) => ({
      id: e.id,
      kind: e.kind === "po" ? "Purchase order" : "Chase",
      to: e.toAddress,
      subject: e.subject,
      body: e.bodyText,
      when: formatDateTime(new Date(e.createdAt)),
      status: e.status === "logged" ? "Logged — not sent (email isn't connected yet)" : e.status === "sent" ? "Sent" : "Failed",
    })),
    responses: responses.map((r) => ({
      id: r.id,
      when: formatDateTime(new Date(r.createdAt)),
      source: SOURCE_LABELS[r.source],
      confidence: r.source === "link" ? null : CONFIDENCE_LABELS[r.confidence],
      status: RESPONSE_STATUS[r.status] ?? r.status,
      needsReview: r.status === "needs_review",
      reasons: r.reasons,
      tracking: r.extras.trackingNumbers ?? [],
      note: r.extras.note ?? null,
      reviewNote: r.reviewNote,
    })),
    lineConfirmations: po.lines.map((l, i) => ({
      id: l.id,
      label: `Line ${i + 1}`,
      confirmed: l.confirmedDate ? formatIsoDate(l.confirmedDate) : null,
      quantity: l.confirmedQuantity === null ? null : formatQuantity(l.confirmedQuantity),
      price: canSeeCosts && l.confirmedUnitCostMinor !== null ? formatMoney(l.confirmedUnitCostMinor, po.currency) : null,
    })),
    namesOf: (id: string | null) => (id ? (names.get(id) ?? "Someone") : "COAST"),
  };
}

// ── Review queue ────────────────────────────────────────────────────────────
export interface ReviewItem {
  id: string;
  poId: string;
  poNumber: string;
  supplierName: string;
  currency: Currency;
  when: string;
  source: string;
  confidence: string | null;
  reasons: string[];
  rawText: string | null;
  tracking: string[];
  note: string | null;
  canSeeCosts: boolean;
  lines: {
    poLineId: string;
    label: string;
    orderedQuantity: string;
    requested: string;
    expectedCost: string | null;
    available: boolean;
    quantity: string;
    date: string;
    unitPrice: string;
  }[];
}

export async function loadReviewQueue(): Promise<{ canReview: boolean; items: ReviewItem[] }> {
  const staff = await requireStaff({ section: "review-queue" });
  const canReview = hasPermission(staff.permissions, "procurement.manage") && hasPermission(staff.permissions, "supplier.identity.view");
  if (!hasPermission(staff.permissions, "supplier.identity.view")) return { canReview: false, items: [] };
  const supabase = await client();
  const canSeeCosts = hasPermission(staff.permissions, "costs.view");
  const responses = await listResponses(supabase, { status: "needs_review" });
  const pos = new Map<string, PoDetail | null>();
  for (const id of new Set(responses.map((r) => r.purchaseOrderId))) pos.set(id, await getPurchaseOrder(supabase, id));

  const items = responses.flatMap<ReviewItem>((r) => {
    const po = pos.get(r.purchaseOrderId);
    if (!po) return [];
    const answers = new Map(r.lines.map((l) => [l.poLineId, l]));
    return [
      {
        id: r.id,
        poId: po.id,
        poNumber: po.poNumber,
        supplierName: po.supplierName,
        currency: po.currency,
        when: formatDateTime(new Date(r.createdAt)),
        source: SOURCE_LABELS[r.source],
        confidence: r.source === "link" ? null : CONFIDENCE_LABELS[r.confidence],
        reasons: r.reasons,
        rawText: r.rawText,
        tracking: r.extras.trackingNumbers ?? [],
        note: r.extras.note ?? null,
        canSeeCosts,
        lines: po.lines.map((l, i) => {
          const a = answers.get(l.id);
          return {
            poLineId: l.id,
            label: `Line ${i + 1} · ${l.description}`,
            orderedQuantity: formatQuantity(l.quantity),
            requested: formatIsoDate(l.requestedDate),
            expectedCost: canSeeCosts && l.unitCostMinor !== null ? formatMoney(l.unitCostMinor, po.currency) : null,
            available: a ? a.available : true,
            quantity: a?.quantity != null ? String(a.quantity) : String(l.quantity),
            date: a?.date ?? "",
            unitPrice: canSeeCosts && a?.unitCostMinor != null ? (a.unitCostMinor / 100).toFixed(2) : "",
          };
        }),
      },
    ];
  });
  return { canReview, items };
}

/** For the sidebar badge. Zero for anyone who can't see the queue. */
export async function reviewQueueCount(canSee: boolean): Promise<number> {
  if (!canSee) return 0;
  const supabase = await createSupabaseServerClient();
  return supabase ? countNeedsReview(supabase) : 0;
}
