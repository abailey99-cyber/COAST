import "server-only";
import { listOrderEvents, getOrder, listOrders, searchOrderIds, type OrderDetail } from "@/lib/data/orders";
import { listSuppliers, type Supplier } from "@/lib/data/procurement";
import { getChaseSettings, listChases } from "@/lib/data/supplier-loop";
import { listStaffInOrg } from "@/lib/data/staff";
import { formatDateTime, formatIsoDate, formatMoney, formatQuantity } from "@/lib/logic/format";
import { describeEvent, matchesView, orderKpis, parseOrderView, type OrderKpis, type OrderView } from "@/lib/logic/order-list";
import {
  ORDER_STATUS_LABELS,
  ROUTE_LABELS,
  allowedNextStages,
  orderFulfilmentLabel,
  orderStageLabel,
  orderStatus,
  parseRepFilter,
  stageLabel,
  type LineStage,
  type OrderStatus,
  type RepFilter,
} from "@/lib/logic/orders";
import { hasPermission } from "@/lib/logic/permissions";
import { canRaisePoFor, PO_STATUS_LABELS } from "@/lib/logic/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff, type StaffContext } from "./session";
import { waitingFor, type Waiting } from "./supplier-loop";

/** Loaders for the order screens. Each checks who's asking first; RLS checks again underneath. */

export interface Rep {
  id: string;
  name: string;
}

export interface OrderRow {
  id: string;
  soNumber: string;
  customerName: string;
  customerReference: string | null;
  salesRepName: string | null;
  fulfilment: string;
  stage: string;
  promised: string;
  status: OrderStatus;
  statusLabel: string;
}

export interface OrdersView {
  rows: OrderRow[];
  kpis: OrderKpis;
  view: OrderView;
  q: string;
  repFilter: RepFilter;
  reps: Rep[];
  canSeeAllOrders: boolean;
  canCreate: boolean;
  truncated: boolean;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

/** People who can be a sales rep on an order. */
async function loadReps(staff: StaffContext): Promise<Rep[]> {
  const team = await listStaffInOrg(await client());
  const reps = team.filter((p) => p.isActive && (p.role === "sales" || p.role === "sales_manager")).map((p) => ({ id: p.id, name: p.fullName }));
  if (!reps.some((r) => r.id === staff.id) && (staff.role === "sales" || staff.role === "sales_manager")) reps.unshift({ id: staff.id, name: staff.fullName });
  return reps;
}

export async function loadOrders(params: { view?: string; q?: string; rep?: string }): Promise<OrdersView> {
  const staff = await requireStaff({ section: "orders" });
  const supabase = await client();
  const canSeeAllOrders = hasPermission(staff.permissions, "orders.view_all");
  const repFilter = canSeeAllOrders ? parseRepFilter(params.rep, staff.role) : "mine";
  const view = parseOrderView(params.view);
  const q = (params.q ?? "").trim().slice(0, 100);

  const repId = repFilter === "mine" ? staff.id : repFilter === "all" ? undefined : repFilter.repId;
  const ids = q ? await searchOrderIds(supabase, q) : undefined;
  const [orders, reps] = await Promise.all([listOrders(supabase, { repId, ids }), loadReps(staff)]);

  const rows = orders.filter((o) => matchesView(o, view)).map<OrderRow>((o) => {
    const status = orderStatus(o.lines);
    return {
      id: o.id,
      soNumber: o.soNumber,
      customerName: o.customerName,
      customerReference: o.customerReference,
      salesRepName: o.salesRepName,
      fulfilment: orderFulfilmentLabel(o.lines),
      stage: orderStageLabel(o.lines),
      promised: formatIsoDate(o.promisedDate),
      status,
      statusLabel: ORDER_STATUS_LABELS[status],
    };
  });

  return {
    rows,
    kpis: orderKpis(orders),
    view,
    q,
    repFilter,
    reps,
    canSeeAllOrders,
    canCreate: hasPermission(staff.permissions, "orders.edit"),
    truncated: orders.length >= 500,
  };
}

// ── One order ───────────────────────────────────────────────────────────────

export interface LineView {
  id: string;
  lineNo: number;
  sku: string | null;
  description: string;
  quantity: string;
  quantityValue: number;
  unitPrice: string;
  route: string;
  stage: LineStage;
  stageLabel: string;
  nextStages: { value: LineStage; label: string }[];
  canRaisePo: boolean;
  pos: { id: string; poNumber: string; status: string; supplierName: string; quantity: string; requested: string; unitCost: string | null; confirmed: string | null }[];
}

export interface ChaseView {
  id: string;
  lineLabel: string;
  note: string | null;
  openedBy: string;
  opened: string;
  open: boolean;
  waiting: Waiting | null;
  resolvedBy: string | null;
  resolved: string | null;
  reply: string | null;
  canResolve: boolean;
}

export interface HistoryItem {
  id: number;
  text: string;
  who: string;
  when: string;
}

export interface OrderPage {
  order: Omit<OrderDetail, "lines">;
  statusLabel: string;
  status: OrderStatus;
  fulfilment: string;
  stage: string;
  promised: string;
  createdAt: string;
  lines: LineView[];
  history: HistoryItem[];
  can: { edit: boolean; changeStage: boolean; raisePo: boolean; seeSuppliers: boolean; seeCosts: boolean; chase: boolean };
  suppliers: Supplier[];
  chases: ChaseView[];
  /** Lines that can have a new internal chase (no open one, not finished). */
  chaseableLines: { id: string; label: string }[];
}

export async function loadOrder(id: string): Promise<OrderPage | null> {
  const staff = await requireStaff({ section: "orders" });
  const supabase = await client();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const order = await getOrder(supabase, id);
  if (!order) return null;

  const can = {
    edit: hasPermission(staff.permissions, "orders.edit"),
    changeStage: hasPermission(staff.permissions, "orders.edit") || hasPermission(staff.permissions, "procurement.manage"),
    raisePo: hasPermission(staff.permissions, "procurement.manage") && hasPermission(staff.permissions, "supplier.identity.view"),
    seeSuppliers: hasPermission(staff.permissions, "supplier.identity.view"),
    seeCosts: hasPermission(staff.permissions, "costs.view"),
    chase: hasPermission(staff.permissions, "chases.internal"),
  };

  const [events, team, suppliers, chases, settings] = await Promise.all([
    listOrderEvents(supabase, id),
    listStaffInOrg(supabase),
    can.raisePo ? listSuppliers(supabase) : Promise.resolve([] as Supplier[]),
    listChases(supabase, { orderId: id }),
    getChaseSettings(supabase),
  ]);
  const now = new Date();
  const names = new Map(team.map((p) => [p.id, p.fullName]));
  const poNumbers = new Map(order.lines.flatMap((l) => l.poLinks.map((p) => [p.purchaseOrderId, p.poNumber] as const)));
  const lineMap = new Map(order.lines.map((l) => [l.id, { lineNo: l.lineNo, route: l.route }]));

  const lines: LineView[] = order.lines.map((l) => {
    const onLivePo = l.poLinks.some((p) => p.status !== "cancelled");
    return {
      id: l.id,
      lineNo: l.lineNo,
      sku: l.sku,
      description: l.description,
      quantity: formatQuantity(l.quantity),
      quantityValue: l.quantity,
      unitPrice: l.unitPriceMinor === null ? "—" : formatMoney(l.unitPriceMinor, order.currency),
      route: ROUTE_LABELS[l.route],
      stage: l.stage,
      stageLabel: stageLabel(l.stage, l.route),
      nextStages: can.changeStage ? allowedNextStages(l.stage, l.route).map((s) => ({ value: s, label: stageLabel(s, l.route) })) : [],
      canRaisePo: can.raisePo && canRaisePoFor({ id: l.id, route: l.route, stage: l.stage, quantity: l.quantity, onLivePo }),
      pos: l.poLinks.map((p) => ({
        id: p.purchaseOrderId,
        poNumber: p.poNumber,
        status: PO_STATUS_LABELS[p.status],
        supplierName: p.supplierName,
        quantity: formatQuantity(p.quantity),
        requested: formatIsoDate(p.requestedDate),
        unitCost: can.seeCosts && p.unitCostMinor !== null ? formatMoney(p.unitCostMinor, order.currency) : null,
        confirmed: p.confirmedDate ? formatIsoDate(p.confirmedDate) : null,
      })),
    };
  });

  const summaryLines = order.lines.map((l) => ({ route: l.route, stage: l.stage }));
  const status = orderStatus(summaryLines);
  const { lines: _lines, ...rest } = order;
  void _lines;

  return {
    order: rest,
    status,
    statusLabel: ORDER_STATUS_LABELS[status],
    fulfilment: orderFulfilmentLabel(summaryLines),
    stage: orderStageLabel(summaryLines),
    promised: formatIsoDate(order.promisedDate),
    createdAt: formatDateTime(new Date(order.createdAt)),
    lines,
    history: events.map((e) => ({
      id: e.id,
      text: describeEvent(e, { lines: lineMap, poNumbers }),
      who: e.actorId ? (names.get(e.actorId) ?? "Someone") : "COAST",
      when: formatDateTime(new Date(e.createdAt)),
    })),
    can,
    suppliers: suppliers.filter((s) => s.isActive),
    chases: chases
      .filter((c) => c.kind === "internal")
      .map((c) => {
        const line = order.lines.find((l) => l.id === c.orderLineId);
        return {
          id: c.id,
          lineLabel: line ? `Line ${line.lineNo} · ${line.description}` : "A line",
          note: c.note,
          openedBy: c.openedBy ? (names.get(c.openedBy) ?? "Someone") : "COAST",
          opened: formatDateTime(new Date(c.openedAt)),
          open: c.status === "open",
          waiting: c.status === "open" ? waitingFor(c.openedAt, now, settings) : null,
          resolvedBy: c.resolvedBy ? (names.get(c.resolvedBy) ?? "Someone") : null,
          resolved: c.resolvedAt ? formatDateTime(new Date(c.resolvedAt)) : null,
          reply: c.resolutionNote,
          canResolve: c.status === "open" && (hasPermission(staff.permissions, "procurement.manage") || c.openedBy === staff.id),
        };
      }),
    chaseableLines: can.chase
      ? order.lines
          .filter((l) => l.stage !== "delivered" && l.stage !== "cancelled" && !chases.some((c) => c.kind === "internal" && c.status === "open" && c.orderLineId === l.id))
          .map((l) => ({ id: l.id, label: `Line ${l.lineNo} · ${l.description}` }))
      : [],
  };
}

export async function loadNewOrderForm(): Promise<{ reps: Rep[]; defaultRepId: string | null }> {
  const staff = await requireStaff({ section: "orders" });
  if (!hasPermission(staff.permissions, "orders.edit")) throw new Error("not allowed");
  const reps = await loadReps(staff);
  return { reps, defaultRepId: reps.some((r) => r.id === staff.id) ? staff.id : null };
}

// ── Editing ─────────────────────────────────────────────────────────────────

export interface EditLine {
  id: string;
  lineNo: number;
  sku: string;
  description: string;
  quantity: string;
  unitPrice: string;
  route: string;
  stageLabel: string;
  locked: boolean;
  quantityOnLivePos: number;
}

export interface OrderEditPage {
  id: string;
  soNumber: string;
  values: {
    customerName: string;
    customerReference: string;
    salesRepId: string;
    currency: string;
    promisedDate: string;
    deliveryName: string;
    deliveryLine1: string;
    deliveryLine2: string;
    deliveryTown: string;
    deliveryPostcode: string;
    deliveryCountry: string;
  };
  lines: EditLine[];
  reps: Rep[];
  mustBeOwnRep: boolean;
}

/** Money in minor units → "12.50" for an input box. */
function moneyInput(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(2);
}

export async function loadOrderEdit(id: string): Promise<OrderEditPage | null> {
  const staff = await requireStaff({ section: "orders" });
  if (!hasPermission(staff.permissions, "orders.edit") || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const order = await getOrder(await client(), id);
  if (!order) return null;
  const reps = await loadReps(staff);
  if (order.salesRepId && !reps.some((r) => r.id === order.salesRepId)) reps.push({ id: order.salesRepId, name: order.salesRepName ?? "Former rep" });
  return {
    id: order.id,
    soNumber: order.soNumber,
    values: {
      customerName: order.customerName,
      customerReference: order.customerReference ?? "",
      salesRepId: order.salesRepId ?? "",
      currency: order.currency,
      promisedDate: order.promisedDate ?? "",
      deliveryName: order.delivery.name,
      deliveryLine1: order.delivery.line1,
      deliveryLine2: order.delivery.line2 ?? "",
      deliveryTown: order.delivery.town,
      deliveryPostcode: order.delivery.postcode,
      deliveryCountry: order.delivery.country,
    },
    lines: order.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      sku: l.sku ?? "",
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: moneyInput(l.unitPriceMinor),
      route: ROUTE_LABELS[l.route],
      stageLabel: stageLabel(l.stage, l.route),
      locked: l.stage === "delivered" || l.stage === "cancelled",
      quantityOnLivePos: l.poLinks.filter((p) => p.status !== "cancelled").reduce((s, p) => s + p.quantity, 0),
    })),
    reps,
    mustBeOwnRep: !hasPermission(staff.permissions, "orders.view_all"),
  };
}
