import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listExpected, listOrgEvents, listRecentReceipts, metricsRows, poNumbersById, waitingRows, type ExpectedLine } from "@/lib/data/insight";
import { problemRows } from "@/lib/data/problems";
import { listStaffInOrg } from "@/lib/data/staff";
import { getChaseSettings } from "@/lib/data/supplier-loop";
import { getCarrier, isCarrierKey } from "@/lib/logic/carriers";
import { ESCALATION_LABELS, describeWait, type EscalationLevel } from "@/lib/logic/escalation";
import { FEED_FILTERS, FEED_FILTER_LABELS, countByWaitingOn, feedCategory, isProblem, matchesFeed, parseFeedFilter, rankWaiting, type FeedCategory, type FeedFilter, type WaitItem, type WaitItemInput, type WaitingOn } from "@/lib/logic/feed";
import { formatDateTime, formatIsoDate, formatMoney, isCurrency } from "@/lib/logic/format";
import { CONDITIONS, CONDITION_LABELS } from "@/lib/logic/goods-in";
import { orderFigures, readingFigures, spendConcentration, supplierFigures, type LineArrivalFact, type OrderFact, type PoFact, type SpendFact } from "@/lib/logic/metrics";
import { canAccessSection } from "@/lib/logic/navigation";
import { describeEvent } from "@/lib/logic/order-list";
import { isFulfilmentRoute, isLineStage, orderStatus, type FulfilmentRoute, type LineStage } from "@/lib/logic/orders";
import { hasPermission } from "@/lib/logic/permissions";
import { CATEGORY_LABELS, STATUS_LABELS as PROBLEM_STATUS_LABELS, isCategory, isProblemStatus, problemRates, waitingOn as problemWaitingOn } from "@/lib/logic/problems";
import { problemSummary } from "./problems";
import { formatRange, ukDateOf, ukToday } from "@/lib/logic/prediction";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff, type StaffContext } from "./session";

/** Loaders for Home, Updates, Chases, Metrics and Goods-in (Phase 6). Each checks the section first; RLS checks again. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

// ── Updates feed ────────────────────────────────────────────────────────────
export interface FeedItem {
  id: number;
  orderId: string;
  soNumber: string;
  text: string;
  who: string;
  when: string;
  category: FeedCategory;
  problem: boolean;
}

export interface UpdatesView {
  filter: FeedFilter;
  filters: { value: FeedFilter; label: string }[];
  items: FeedItem[];
  /** For "Older updates". */
  before: number | null;
}

async function feedItems(supabase: SupabaseClient, filter: FeedFilter, before: number | undefined, want: number): Promise<{ items: FeedItem[]; before: number | null }> {
  const items: FeedItem[] = [];
  let cursor = before;
  let lastId: number | null = null;
  const team = await listStaffInOrg(supabase);
  const names = new Map(team.map((p) => [p.id, p.fullName]));
  // Filtering happens after reading, so read in pages until there's enough (bounded).
  for (let page = 0; page < 5 && items.length < want; page++) {
    const events = await listOrgEvents(supabase, { before: cursor, limit: 200 });
    if (events.length === 0) {
      lastId = null;
      break;
    }
    const poIds = events.flatMap((e) => (typeof e.detail.purchase_order_id === "string" ? [e.detail.purchase_order_id] : []));
    const poNumbers = await poNumbersById(supabase, poIds);
    for (const e of events) {
      lastId = e.id;
      if (!matchesFeed(filter, e.kind, e.detail)) continue;
      const lines = new Map(e.lines.filter((l) => isFulfilmentRoute(l.route)).map((l) => [l.id, { lineNo: l.lineNo, route: l.route as FulfilmentRoute }]));
      items.push({
        id: e.id,
        orderId: e.orderId,
        soNumber: e.soNumber,
        text: describeEvent(e, { lines, poNumbers }),
        who: e.actorId ? (names.get(e.actorId) ?? "Someone") : e.kind === "customer_message" ? "Customer" : "COAST",
        when: formatDateTime(new Date(e.createdAt)),
        category: feedCategory(e.kind, e.detail),
        problem: isProblem(e.kind, e.detail),
      });
      if (items.length >= want) break;
    }
    cursor = lastId ?? undefined;
    if (events.length < 200) {
      if (items.length < want) lastId = null;
      break;
    }
  }
  return { items, before: items.length >= want ? (items.at(-1)?.id ?? null) : lastId };
}

export async function loadUpdates(params: { filter?: string; before?: string }): Promise<UpdatesView> {
  await requireStaff({ section: "updates" });
  const filter = parseFeedFilter(params.filter);
  const before = params.before && /^\d+$/.test(params.before) ? Number(params.before) : undefined;
  const { items, before: next } = await feedItems(await client(), filter, before, 60);
  return { filter, filters: FEED_FILTERS.map((f) => ({ value: f, label: FEED_FILTER_LABELS[f] })), items, before: next };
}

// ── Chases: everything waiting on someone ───────────────────────────────────
export interface WaitingView {
  items: (WaitItem & { levelLabel: string; wait: string })[];
  counts: Record<WaitingOn | "overdue", number>;
  filter: WaitingOn | "all" | "overdue";
}

const WAIT_FILTERS = ["all", "overdue", "supplier", "procurement", "us", "carrier", "customer"] as const;

async function waitingItems(supabase: SupabaseClient, now: Date): Promise<WaitItem[]> {
  const [rows, settings] = await Promise.all([waitingRows(supabase), getChaseSettings(supabase)]);
  const items: WaitItemInput[] = [];
  const chasedPos = new Map(rows.chases.filter((c) => c.kind === "supplier" && c.purchase_order_id).map((c) => [c.purchase_order_id!, c]));

  for (const p of rows.pos) {
    if (p.status === "draft") {
      items.push({ id: `po-draft-${p.id}`, waitingOn: "procurement", since: p.created_at, title: `${p.po_number} hasn't been sent`, detail: p.suppliers?.name ?? null, href: `/app/purchase-orders/${p.id}` });
      continue;
    }
    const chase = chasedPos.get(p.id);
    const since = chase ? (chase.last_chased_at ?? chase.opened_at) : (p.sent_at ?? p.created_at);
    items.push({
      id: `po-${p.id}`,
      waitingOn: "supplier",
      since,
      title: `${p.po_number}: waiting for the supplier to confirm`,
      detail: [p.suppliers?.name, chase ? `chased ${chase.chase_count} ${chase.chase_count === 1 ? "time" : "times"}` : null].filter(Boolean).join(" · ") || null,
      href: `/app/purchase-orders/${p.id}`,
    });
  }
  for (const c of rows.chases.filter((x) => x.kind === "internal")) {
    items.push({ id: `chase-${c.id}`, waitingOn: "procurement", since: c.opened_at, title: `${c.sales_orders?.so_number ?? "An order"}: sales asked for an update`, detail: c.note, href: `/app/orders/${c.sales_order_id}` });
  }
  for (const r of rows.reviews) {
    items.push({ id: `review-${r.id}`, waitingOn: "procurement", since: r.created_at, title: `${r.purchase_orders?.po_number ?? "A PO"}: supplier answer to check`, detail: null, href: "/app/review-queue" });
  }
  for (const m of rows.messages) {
    items.push({ id: `msg-${m.id}`, waitingOn: "us", since: m.created_at, title: `${m.sales_orders?.so_number ?? "An order"}: customer message`, detail: m.body.slice(0, 120), href: `/app/orders/${m.sales_order_id}` });
  }
  // Delivery problems: waiting on whoever their status says (spec §5.4). A carrier problem replaces the shipment's own line.
  const problemShipments = new Set<string>();
  for (const p of rows.problems) {
    if (!isProblemStatus(p.status)) continue;
    const on = problemWaitingOn(p.status);
    if (!on) continue;
    if (p.shipment_id) problemShipments.add(p.shipment_id);
    items.push({
      id: `problem-${p.id}`,
      waitingOn: on,
      since: p.waiting_since,
      title: `${p.sales_orders?.so_number ?? "An order"}: delivery problem — ${isCategory(p.category) ? CATEGORY_LABELS[p.category].toLowerCase() : "something's wrong"}`,
      detail: PROBLEM_STATUS_LABELS[p.status],
      href: `/app/problems/${p.id}`,
    });
  }
  for (const s of rows.shipments) {
    const so = s.sales_orders?.so_number ?? "An order";
    if (s.status === "exception" && problemShipments.has(s.id)) continue;
    const label = isCarrierKey(s.carrier) ? getCarrier(s.carrier).label : s.carrier;
    if (s.status === "exception") items.push({ id: `ship-${s.id}`, waitingOn: "carrier", since: s.updated_at, title: `${so}: delivery problem reported`, detail: [label, s.tracking_number].filter(Boolean).join(" · "), href: `/app/shipments/${s.id}` });
    else if (s.is_international && s.customs_status === "held") items.push({ id: `customs-${s.id}`, waitingOn: "carrier", since: s.updated_at, title: `${so}: held at customs`, detail: [label, s.tracking_number].filter(Boolean).join(" · "), href: `/app/shipments/${s.id}` });
    else if (s.carrier === "unknown") items.push({ id: `carrier-${s.id}`, waitingOn: "procurement", since: s.updated_at, title: `${so}: choose the carrier for ${s.tracking_number ?? "a shipment"}`, detail: null, href: `/app/shipments/${s.id}` });
  }
  return rankWaiting(items, now, settings.thresholds, settings.calendar);
}

export async function loadWaiting(params: { filter?: string }): Promise<WaitingView> {
  await requireStaff({ section: "chases" });
  const all = await waitingItems(await client(), new Date());
  const filter = (WAIT_FILTERS as readonly string[]).includes(params.filter ?? "") ? (params.filter as WaitingView["filter"]) : "all";
  const shown = all.filter((i) => filter === "all" || (filter === "overdue" ? i.level !== "none" : i.waitingOn === filter));
  return {
    items: shown.map((i) => ({ ...i, levelLabel: ESCALATION_LABELS[i.level], wait: describeWait(i.hours) })),
    counts: countByWaitingOn(all),
    filter,
  };
}

/** For the menu badge: how many things are overdue (amber or worse). */
export async function overdueCount(staff: StaffContext): Promise<number> {
  if (!canAccessSection(staff.permissions, "chases")) return 0;
  try {
    return (await waitingItems(await client(), new Date())).filter((i) => i.level !== "none").length;
  } catch {
    return 0;
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────
export interface MetricsView {
  periodDays: number;
  orders: ReturnType<typeof orderFigures>;
  suppliers: (ReturnType<typeof supplierFigures>[number] & { responseLabel: string })[] | null;
  spend: { currency: string; total: string; top: string | null; rows: { name: string; amount: string; percent: number }[] }[] | null;
  reading: ReturnType<typeof readingFigures> | null;
  /** Delivery problems per 100 delivered (spec §5.4). Suppliers only for people who may see them. */
  problemRates: { bySupplier: ReturnType<typeof problemRates> | null; byCarrier: ReturnType<typeof problemRates>; total: number } | null;
}

const PERIOD_DAYS = 180;

export async function loadMetrics(): Promise<MetricsView> {
  const staff = await requireStaff({ section: "metrics" });
  const supabase = await client();
  const since = new Date(Date.now() - PERIOD_DAYS * 86_400_000).toISOString();
  const seeProblems = hasPermission(staff.permissions, "section.problems");
  const [rows, settings, problems] = await Promise.all([metricsRows(supabase, since), getChaseSettings(supabase), seeProblems ? problemRows(supabase, since) : Promise.resolve(null)]);

  const ordersById = new Map(rows.orders.map((o) => [o.id, o]));
  const orderFacts: OrderFact[] = rows.orders.map((o) => {
    const lines = (o.order_lines ?? []).filter((l) => isFulfilmentRoute(l.route) && isLineStage(l.stage)) as { route: FulfilmentRoute; stage: LineStage }[];
    const status = orderStatus(lines);
    const deliveredDates = (o.shipments ?? []).filter((s) => s.leg !== "inbound" && s.delivered_at).map((s) => ukDateOf(s.delivered_at!)!).sort();
    const pred = Array.isArray(o.order_predictions) ? o.order_predictions[0] : o.order_predictions;
    return { status, promisedDate: o.promised_date, deliveredDate: status === "delivered" ? (deliveredDates.at(-1) ?? null) : null, atRisk: pred?.at_risk ?? null };
  });

  const seeSuppliers = hasPermission(staff.permissions, "supplier.identity.view");
  const seeCosts = hasPermission(staff.permissions, "costs.view");
  let suppliers: MetricsView["suppliers"] = null;
  let spend: MetricsView["spend"] = null;
  let reading: MetricsView["reading"] = null;

  if (seeSuppliers) {
    const firstResponse = new Map<string, string>();
    for (const r of rows.responses) {
      const prev = firstResponse.get(r.purchase_order_id);
      if (!prev || r.created_at < prev) firstResponse.set(r.purchase_order_id, r.created_at);
    }
    const poById = new Map(rows.pos.map((p) => [p.id, p]));
    const poFacts: PoFact[] = rows.pos.map((p) => ({ supplierId: p.supplier_id, supplierName: p.suppliers?.name ?? "", sentAt: p.sent_at, firstResponseAt: firstResponse.get(p.id) ?? null }));
    const received = new Map<string, string>();
    for (const g of rows.receipts) {
      if (g.condition !== "ok" && g.condition !== "short") continue;
      const prev = received.get(g.order_line_id);
      if (!prev || g.received_at < prev) received.set(g.order_line_id, g.received_at);
    }
    const arrivals: LineArrivalFact[] = [];
    const spendRows: SpendFact[] = [];
    for (const pl of rows.poLines) {
      const po = poById.get(pl.purchase_order_id);
      if (!po || po.status === "cancelled") continue;
      let arrived: string | null = null;
      if (pl.order_lines?.route === "via_warehouse") arrived = received.get(pl.order_line_id) ?? null;
      else if (pl.order_lines?.route === "direct_ship") {
        const o = ordersById.get(pl.order_lines.sales_order_id);
        arrived = (o?.shipments ?? []).filter((s) => s.leg === "direct" && s.delivered_at).map((s) => s.delivered_at!).sort()[0] ?? null;
      }
      arrivals.push({
        supplierId: po.supplier_id,
        supplierName: po.suppliers?.name ?? "",
        poSentDate: po.sent_at ? ukDateOf(po.sent_at) : null,
        confirmedDate: pl.confirmed_date,
        arrivedDate: arrived ? ukDateOf(arrived) : null,
        typicalLeadDays: po.suppliers?.typical_lead_time_days ?? null,
      });
      const unit = pl.purchase_order_line_costs?.confirmed_unit_cost_minor ?? pl.purchase_order_line_costs?.unit_cost_minor ?? null;
      if (seeCosts && unit !== null) spendRows.push({ supplierId: po.supplier_id, supplierName: po.suppliers?.name ?? "", currency: po.currency, amountMinor: unit * Number(pl.quantity) });
    }
    suppliers = supplierFigures(poFacts, arrivals, settings.calendar).map((s) => ({ ...s, responseLabel: s.medianResponseHours === null ? "—" : describeWait(s.medianResponseHours) }));
    reading = readingFigures(rows.responses);
    if (seeCosts) {
      spend = spendConcentration(spendRows).map((c) => {
        const cur = isCurrency(c.currency) ? c.currency : "GBP";
        return {
          currency: c.currency,
          total: formatMoney(c.totalMinor, cur),
          top: c.suppliers[0] ? `${c.suppliers[0].supplierName} is ${c.topPercent}% of it` : null,
          rows: c.suppliers.map((s) => ({ name: s.supplierName, amount: formatMoney(s.amountMinor, cur), percent: s.percent })),
        };
      });
    }
  }

  let rates: MetricsView["problemRates"] = null;
  if (problems) {
    // Carriers: delivered shipments vs problems tied to their shipments.
    const carriers = new Map<string, { delivered: number; problems: number }>();
    const bump = (m: Map<string, { delivered: number; problems: number }>, k: string, f: "delivered" | "problems") => {
      const v = m.get(k) ?? { delivered: 0, problems: 0 };
      v[f]++;
      m.set(k, v);
    };
    for (const o of rows.orders) for (const s of o.shipments ?? []) if (s.status === "delivered" && s.carrier !== "unknown") bump(carriers, s.carrier, "delivered");
    for (const p of problems) if (p.shipments?.carrier && p.shipments.carrier !== "unknown") bump(carriers, p.shipments.carrier, "problems");
    const carrierName = (k: string) => (isCarrierKey(k) ? getCarrier(k).label : k);
    let bySupplier: ReturnType<typeof problemRates> | null = null;
    if (seeSuppliers) {
      // Suppliers: their delivered order lines vs problems on those lines.
      const lineSupplier = new Map<string, { id: string; name: string }>();
      const suppliersMap = new Map<string, { name: string; delivered: number; problems: number }>();
      const poById = new Map(rows.pos.map((p) => [p.id, p]));
      for (const pl of rows.poLines) {
        const po = poById.get(pl.purchase_order_id);
        if (!po || po.status === "cancelled") continue;
        lineSupplier.set(pl.order_line_id, { id: po.supplier_id, name: po.suppliers?.name ?? "" });
        const v = suppliersMap.get(po.supplier_id) ?? { name: po.suppliers?.name ?? "", delivered: 0, problems: 0 };
        if (pl.order_lines?.stage === "delivered") v.delivered++;
        suppliersMap.set(po.supplier_id, v);
      }
      for (const p of problems) {
        const hit = new Set((p.delivery_exception_lines ?? []).flatMap((l) => (lineSupplier.has(l.order_line_id) ? [lineSupplier.get(l.order_line_id)!.id] : [])));
        for (const id of hit) suppliersMap.get(id)!.problems++;
      }
      bySupplier = problemRates([...suppliersMap].filter(([, v]) => v.delivered > 0 || v.problems > 0).map(([key, v]) => ({ key, name: v.name, delivered: v.delivered, problems: v.problems })));
    }
    rates = { bySupplier, byCarrier: problemRates([...carriers].map(([key, v]) => ({ key, name: carrierName(key), ...v }))), total: problems.length };
  }

  return { periodDays: PERIOD_DAYS, orders: orderFigures(orderFacts), suppliers, spend, reading, problemRates: rates };
}

// ── Goods-in ────────────────────────────────────────────────────────────────
export interface GoodsInLine extends ExpectedLine {
  expected: string;
  late: boolean;
  outstanding: number;
  inboundShipments: { id: string; label: string }[];
}

export interface GoodsInView {
  canCheckIn: boolean;
  lines: GoodsInLine[];
  conditions: { value: string; label: string }[];
  recent: { id: string; when: string; who: string; what: string }[];
}

export async function loadGoodsIn(): Promise<GoodsInView> {
  const staff = await requireStaff({ section: "goods-in" });
  const supabase = await client();
  const canCheckIn = hasPermission(staff.permissions, "goods_in.check");
  const [expected, recent, team] = await Promise.all([canCheckIn ? listExpected(supabase) : Promise.resolve([]), listRecentReceipts(supabase), listStaffInOrg(supabase)]);
  const names = new Map(team.map((p) => [p.id, p.fullName]));
  const today = ukToday(new Date());
  const lineInfo = new Map(expected.map((l) => [l.orderLineId, l]));
  return {
    canCheckIn,
    lines: expected.map((l) => {
      const eta = l.tracking.find((t) => t.status !== "delivered" && (t.eta_from || t.eta_to));
      const expectedDate = eta ? (eta.eta_to ?? eta.eta_from) : l.confirmedDate;
      return {
        ...l,
        expected: eta ? `${formatRange(eta.eta_from ?? eta.eta_to, eta.eta_to)} (carrier)` : l.confirmedDate ? formatIsoDate(l.confirmedDate) : "Not known yet",
        late: expectedDate !== null && expectedDate < today,
        outstanding: Math.max(0, l.quantity - l.receivedSoFar),
        inboundShipments: l.tracking
          .filter((t) => t.status !== "delivered")
          .map((t) => ({ id: t.shipment_id, label: `${isCarrierKey(t.carrier) ? getCarrier(t.carrier).label : t.carrier}${t.tracking ? ` · ${t.tracking}` : ""}` })),
      };
    }),
    conditions: CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] })),
    recent: recent.map((r) => {
      const l = lineInfo.get(r.orderLineId);
      return {
        id: r.id,
        when: formatDateTime(new Date(r.receivedAt)),
        who: r.receivedBy ? (names.get(r.receivedBy) ?? "Someone") : "Someone",
        what: `${l ? `${l.soNumber} line ${l.lineNo}: ` : ""}${r.condition === "ok" ? `${r.quantity} checked in` : r.condition === "short" ? `${r.quantity} arrived (short)` : r.condition === "damaged" ? "damaged" : "wrong item"}${r.note ? ` — “${r.note}”` : ""}`,
      };
    }),
  };
}

// ── Home ────────────────────────────────────────────────────────────────────
export interface HomeView {
  name: string;
  waiting: { overdue: number; top: (WaitItem & { levelLabel: string; wait: string })[] } | null;
  atRisk: { count: number; top: { id: string; soNumber: string; customer: string; predicted: string }[] } | null;
  reviewCount: number | null;
  goodsIn: { due: number; late: number } | null;
  problems: FeedItem[] | null;
  openProblems: { open: number; overdue: number; claimsDue: number } | null;
}

export async function loadHome(): Promise<HomeView> {
  const staff = await requireStaff();
  const supabase = await client();
  const can = (s: Parameters<typeof canAccessSection>[1]) => canAccessSection(staff.permissions, s);
  const now = new Date();

  const [waiting, atRisk, problems, goods, openProblems] = await Promise.all([
    can("chases") ? waitingItems(supabase, now) : Promise.resolve(null),
    can("orders") ? atRiskOrders(supabase) : Promise.resolve(null),
    can("updates") ? feedItems(supabase, "problems", undefined, 6).then((r) => r.items) : Promise.resolve(null),
    can("goods-in") && hasPermission(staff.permissions, "goods_in.check") ? listExpected(supabase) : Promise.resolve(null),
    problemSummary(staff),
  ]);
  const today = ukToday(now);
  const label = (i: WaitItem) => ({ ...i, levelLabel: ESCALATION_LABELS[i.level], wait: describeWait(i.hours) });
  return {
    name: staff.fullName,
    waiting: waiting ? { overdue: waiting.filter((i) => i.level !== "none").length, top: waiting.slice(0, 6).map(label) } : null,
    atRisk,
    reviewCount: can("review-queue") && waiting ? waiting.filter((i) => i.id.startsWith("review-")).length : null,
    goodsIn: goods ? { due: goods.length, late: goods.filter((l) => l.confirmedDate !== null && l.confirmedDate < today).length } : null,
    problems,
    openProblems,
  };
}

async function atRiskOrders(supabase: SupabaseClient): Promise<HomeView["atRisk"]> {
  const { data } = await supabase
    .from("order_predictions")
    .select("sales_order_id, predicted_from, predicted_to, sales_orders!inner(so_number, customers(name), order_lines(stage, route))")
    .eq("at_risk", true)
    .limit(200)
    .returns<{ sales_order_id: string; predicted_from: string | null; predicted_to: string | null; sales_orders: { so_number: string; customers: { name: string } | null; order_lines: { stage: string; route: string }[] | null } }[]>();
  const open = (data ?? []).filter((r) => {
    const lines = (r.sales_orders.order_lines ?? []).filter((l) => isFulfilmentRoute(l.route) && isLineStage(l.stage)) as { route: FulfilmentRoute; stage: LineStage }[];
    return orderStatus(lines) === "open";
  });
  return {
    count: open.length,
    top: open.slice(0, 6).map((r) => ({ id: r.sales_order_id, soNumber: r.sales_orders.so_number, customer: r.sales_orders.customers?.name ?? "", predicted: formatRange(r.predicted_from, r.predicted_to) ?? "Not known yet" })),
  };
}

export type { EscalationLevel };
