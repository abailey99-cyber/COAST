import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getProblem,
  listPhotos,
  listProblemEvents,
  listProblems,
  signedPhotoUrls,
  type ProblemEvent,
  type ProblemRow,
  type RaisedVia,
} from "@/lib/data/problems";
import { listShipments } from "@/lib/data/shipments";
import { listStaffInOrg } from "@/lib/data/staff";
import { getChaseSettings } from "@/lib/data/supplier-loop";
import { getCarrier, isCarrierKey } from "@/lib/logic/carriers";
import { ESCALATION_LABELS, describeWait, escalate, type EscalationLevel } from "@/lib/logic/escalation";
import { formatDateTime, formatIsoDate } from "@/lib/logic/format";
import { hasPermission } from "@/lib/logic/permissions";
import { ukToday } from "@/lib/logic/prediction";
import {
  CATEGORY_LABELS,
  MAX_PHOTOS,
  PROBLEM_CATEGORIES,
  RESOLUTIONS,
  RESOLUTION_LABELS,
  STATUS_LABELS,
  claimHealth,
  customerStatus,
  isCategory,
  isOpen,
  isProblemStatus,
  nextStatuses,
  type ClaimHealth,
} from "@/lib/logic/problems";
import { LEG_LABELS } from "@/lib/logic/shipments";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff, type StaffContext } from "./session";

/** Loaders for delivery problems (Phase 7): the Problems screen, one problem, and the order page panel. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

export const VIA_LABELS: Record<RaisedVia, string> = { customer: "Customer", carrier: "Carrier", goods_in: "Goods-in", staff: "Staff" };

function carrierLabel(key: string | null): string | null {
  if (!key) return null;
  return isCarrierKey(key) ? getCarrier(key).label : key;
}

export interface ProblemItem {
  id: string;
  orderId: string;
  soNumber: string;
  customer: string;
  what: string;
  status: string;
  open: boolean;
  via: string;
  raised: string;
  owner: string | null;
  lines: string;
  photos: number;
  level: EscalationLevel;
  levelLabel: string;
  wait: string;
  claim: ClaimHealth | null;
}

type Known = { team: { id: string; fullName: string }[]; settings: Awaited<ReturnType<typeof getChaseSettings>> };

async function toItems(supabase: SupabaseClient, rows: readonly ProblemRow[], now: Date, known?: Known): Promise<ProblemItem[]> {
  if (rows.length === 0) return [];
  const [team, settings] = known ? [known.team, known.settings] : await Promise.all([listStaffInOrg(supabase), getChaseSettings(supabase)]);
  const names = new Map(team.map((p) => [p.id, p.fullName]));
  const today = ukToday(now);
  return rows.map((p) => {
    const open = isOpen(p.status);
    const e = open ? escalate(new Date(p.waitingSince), now, settings.thresholds, settings.calendar) : null;
    return {
      id: p.id,
      orderId: p.salesOrderId,
      soNumber: p.soNumber,
      customer: p.customerName,
      what: CATEGORY_LABELS[p.category],
      status: STATUS_LABELS[p.status],
      open,
      via: VIA_LABELS[p.raisedVia],
      raised: formatDateTime(new Date(p.createdAt)),
      owner: p.ownerId ? (names.get(p.ownerId) ?? "Someone") : null,
      lines: p.lines.length === 0 ? "Whole order" : `Line ${p.lines.map((l) => l.lineNo).join(", ")}`,
      photos: p.photoCount,
      level: e?.level ?? "none",
      levelLabel: ESCALATION_LABELS[e?.level ?? "none"],
      wait: e ? describeWait(e.waitedHours) : "",
      claim: open ? claimHealth(p.claimDeadline, today, p.claimSubmittedAt !== null) : null,
    };
  });
}

// ── The Problems screen ─────────────────────────────────────────────────────
export const PROBLEM_VIEWS = ["open", "mine", "closed", "all"] as const;
export type ProblemView = (typeof PROBLEM_VIEWS)[number];
export const PROBLEM_VIEW_LABELS: Record<ProblemView, string> = { open: "Open", mine: "Mine", closed: "Resolved and closed", all: "All" };

const LEVEL_RANK: Record<EscalationLevel, number> = { alert: 0, red: 1, amber: 2, none: 3 };

export interface ProblemsView {
  view: ProblemView;
  views: { value: ProblemView; label: string }[];
  items: ProblemItem[];
  counts: { open: number; overdue: number; claimsDue: number };
}

export async function loadProblems(params: { view?: string }): Promise<ProblemsView> {
  const staff = await requireStaff({ section: "problems" });
  const supabase = await client();
  const view = (PROBLEM_VIEWS as readonly string[]).includes(params.view ?? "") ? (params.view as ProblemView) : "open";
  const rows = await listProblems(supabase, view === "closed" ? { open: false } : view === "all" ? {} : { open: true });
  const shown = view === "mine" ? rows.filter((r) => r.ownerId === staff.id) : rows;
  const items = await toItems(supabase, shown, new Date());
  if (view !== "closed") items.sort((a, b) => Number(b.open) - Number(a.open) || LEVEL_RANK[worst(a)] - LEVEL_RANK[worst(b)]);
  const open = view === "open" ? items : await toItems(supabase, rows.filter((r) => isOpen(r.status)), new Date());
  return {
    view,
    views: PROBLEM_VIEWS.map((v) => ({ value: v, label: PROBLEM_VIEW_LABELS[v] })),
    items,
    counts: {
      open: open.length,
      overdue: open.filter((i) => i.level !== "none").length,
      claimsDue: open.filter((i) => i.claim && i.claim.level !== "none").length,
    },
  };
}

/** A problem's most urgent signal: its own wait, or its claim deadline. */
function worst(i: ProblemItem): EscalationLevel {
  const c = i.claim?.level ?? "none";
  return LEVEL_RANK[c] < LEVEL_RANK[i.level] ? c : i.level;
}

/** For Home: open problems and claims running out. */
export async function problemSummary(staff: StaffContext): Promise<{ open: number; overdue: number; claimsDue: number } | null> {
  if (!hasPermission(staff.permissions, "section.problems")) return null;
  try {
    const supabase = await client();
    const items = await toItems(supabase, await listProblems(supabase, { open: true }), new Date());
    return { open: items.length, overdue: items.filter((i) => i.level !== "none").length, claimsDue: items.filter((i) => i.claim && i.claim.level !== "none").length };
  } catch {
    return null;
  }
}

// ── One problem ─────────────────────────────────────────────────────────────
export interface ProblemPage {
  item: ProblemItem;
  description: string | null;
  reporterName: string | null;
  category: string;
  statusKey: string;
  ownerId: string | null;
  rootCause: string | null;
  resolution: string | null;
  resolutionLabel: string | null;
  resolutionNote: string | null;
  rmaReference: string | null;
  replacementLine: number | null;
  claimDeadline: string | null;
  claimDeadlineLabel: string | null;
  claimSubmitted: string | null;
  shipment: { id: string; label: string } | null;
  lineDetail: { lineNo: number; description: string; quantity: number | null }[];
  /** What the customer sees of it, if they reported it. */
  customerSees: string | null;
  canManage: boolean;
  nextStatuses: { value: string; label: string }[];
  categories: { value: string; label: string }[];
  resolutions: { value: string; label: string }[];
  team: { id: string; name: string }[];
  history: { id: number; when: string; who: string; text: string }[];
  photos: { id: string; url: string | null; name: string; by: string; when: string }[];
  maxPhotos: number;
}

function describeProblemEvent(e: ProblemEvent, names: Map<string, string>): string {
  const d = e.detail;
  switch (e.kind) {
    case "raised":
      return `Raised (${VIA_LABELS[(d.via as RaisedVia) ?? "staff"] ?? "Staff"}): ${isCategory(d.category) ? CATEGORY_LABELS[d.category] : "delivery problem"}`;
    case "status":
      return isProblemStatus(d.from) && isProblemStatus(d.to) ? `${STATUS_LABELS[d.from]} → ${STATUS_LABELS[d.to]}` : "Status changed";
    case "owner":
      return typeof d.owner_id === "string" ? `Assigned to ${names.get(d.owner_id) ?? "someone"}` : "Unassigned";
    case "note":
      return typeof d.text === "string" ? `Note: ${d.text}` : "Note added";
    case "resolution":
      return typeof d.text === "string" ? d.text : "Resolution recorded";
    case "claim":
      return "Claim submitted to the carrier";
    case "photo":
      return `Photo added${typeof d.name === "string" ? `: ${d.name}` : ""}${d.by === "customer" ? " by the customer" : ""}`;
  }
}

export async function loadProblem(id: string): Promise<ProblemPage | null> {
  const staff = await requireStaff({ section: "problems" });
  const supabase = await client();
  const p = await getProblem(supabase, id);
  if (!p) return null;
  const [items, events, photos, team] = await Promise.all([toItems(supabase, [p], new Date()), listProblemEvents(supabase, id), listPhotos(supabase, id), listStaffInOrg(supabase)]);
  const names = new Map(team.map((t) => [t.id, t.fullName]));
  // The bucket is private; the row above proved this person can see the problem, so hand out short-lived links.
  const admin = createSupabaseAdminClient();
  const urls = admin ? await signedPhotoUrls(admin, photos.map((ph) => ph.storagePath)) : new Map<string, string>();
  let replacementLine: number | null = null;
  if (p.replacementLineId) {
    const { data } = await supabase.from("order_lines").select("line_no").eq("id", p.replacementLineId).maybeSingle<{ line_no: number }>();
    replacementLine = data?.line_no ?? null;
  }
  const canManage = hasPermission(staff.permissions, "problems.manage");
  return {
    item: items[0]!,
    description: p.description,
    reporterName: p.reporterName,
    category: p.category,
    statusKey: p.status,
    ownerId: p.ownerId,
    rootCause: p.rootCause,
    resolution: p.resolution,
    resolutionLabel: p.resolution ? RESOLUTION_LABELS[p.resolution] : null,
    resolutionNote: p.resolutionNote,
    rmaReference: p.rmaReference,
    replacementLine,
    claimDeadline: p.claimDeadline,
    claimDeadlineLabel: p.claimDeadline ? formatIsoDate(p.claimDeadline) : null,
    claimSubmitted: p.claimSubmittedAt ? formatDateTime(new Date(p.claimSubmittedAt)) : null,
    shipment: p.shipmentId ? { id: p.shipmentId, label: [carrierLabel(p.carrier), p.trackingNumber].filter(Boolean).join(" · ") || "Shipment" } : null,
    lineDetail: p.lines.map((l) => ({ lineNo: l.lineNo, description: l.description, quantity: l.quantity })),
    customerSees: p.raisedVia === "customer" ? customerStatus(p.status) : null,
    canManage,
    nextStatuses: nextStatuses(p.status).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
    categories: PROBLEM_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    resolutions: RESOLUTIONS.map((r) => ({ value: r, label: RESOLUTION_LABELS[r] })),
    team: team.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.fullName })),
    history: events
      .map((e) => ({ id: e.id, when: formatDateTime(new Date(e.createdAt)), who: e.actorId ? (names.get(e.actorId) ?? (e.kind === "photo" ? "Customer" : "Someone")) : e.detail.via === "customer" || e.detail.by === "customer" ? "Customer" : "COAST", text: describeProblemEvent(e, names) }))
      .reverse(),
    photos: photos.map((ph) => ({
      id: ph.id,
      url: urls.get(ph.storagePath) ?? null,
      name: ph.fileName,
      by: ph.uploadedByKind === "customer" ? "Customer" : ph.uploadedBy ? (names.get(ph.uploadedBy) ?? "Staff") : "Staff",
      when: formatDateTime(new Date(ph.createdAt)),
    })),
    maxPhotos: MAX_PHOTOS,
  };
}

// ── The order page panel ────────────────────────────────────────────────────
export interface OrderProblems {
  canReport: boolean;
  items: ProblemItem[];
  lines: { id: string; lineNo: number; description: string }[];
  shipments: { id: string; label: string }[];
  categories: { value: string; label: string }[];
  maxPhotos: number;
}

/** For the order page, which has already loaded the order's lines, the team and the chase settings. */
export async function loadOrderProblems(
  staff: StaffContext,
  supabase: SupabaseClient,
  orderId: string,
  orderLines: readonly { id: string; lineNo: number; description: string; stage: string }[],
  known: Known,
): Promise<OrderProblems | null> {
  if (!hasPermission(staff.permissions, "section.problems") && !hasPermission(staff.permissions, "problems.manage")) return null;
  const canReport = hasPermission(staff.permissions, "problems.manage");
  const [rows, shipments] = await Promise.all([listProblems(supabase, { orderId }), canReport ? listShipments(supabase, { orderId }) : Promise.resolve([])]);
  const seeSupplierLegs = hasPermission(staff.permissions, "supplier.identity.view");
  return {
    canReport,
    items: await toItems(supabase, rows, new Date(), known),
    lines: orderLines.filter((l) => l.stage !== "cancelled").map((l) => ({ id: l.id, lineNo: l.lineNo, description: l.description })),
    shipments: shipments
      .filter((s) => seeSupplierLegs || s.leg === "outbound")
      .map((s) => ({ id: s.id, label: `${LEG_LABELS[s.leg]} · ${[carrierLabel(s.carrier), s.trackingNumber].filter(Boolean).join(" ")}` })),
    categories: PROBLEM_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    maxPhotos: MAX_PHOTOS,
  };
}
