/**
 * Purchase orders to suppliers (spec §5.1). Pure: no I/O.
 */

import { isCurrency, type Currency } from "./format";
import { parseIsoDate, parseMoneyToMinor, parseQuantity, routeNeedsSupplier, type FieldErrors, type FulfilmentRoute, type LineStage } from "./orders";

export const PO_STATUSES = ["draft", "sent", "confirmed", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

/**
 * Manual PO status changes in Phase 1. "Sent" here means staff sent it
 * themselves — automatic sending arrives in Phase 2.
 */
export function allowedPoStatusChanges(current: PoStatus): PoStatus[] {
  switch (current) {
    case "draft":
      return ["sent", "cancelled"];
    case "sent":
      return ["confirmed", "cancelled"];
    case "confirmed":
      return ["cancelled"];
    case "cancelled":
      return [];
  }
}

export interface PoCandidateLine {
  id: string;
  route: FulfilmentRoute;
  stage: LineStage;
  quantity: number;
  /** Already on a live (not cancelled) purchase order. */
  onLivePo: boolean;
}

/** Lines a PO can be raised for: supplier-fulfilled, still at "Needs PO", not already on a live PO. */
export function canRaisePoFor(line: PoCandidateLine): boolean {
  return routeNeedsSupplier(line.route) && line.stage === "ordered" && !line.onLivePo;
}

export interface NewPoLineInput {
  orderLineId: string;
  quantity: string;
  unitCost: string;
  requestedDate: string;
}

export interface NewPoInput {
  supplierId: string;
  currency: string;
  lines: NewPoLineInput[];
}

export interface ValidPoLine {
  orderLineId: string;
  quantity: number;
  unitCostMinor: number | null;
  requestedDate: string | null;
}

export interface ValidPo {
  supplierId: string;
  currency: Currency;
  lines: ValidPoLine[];
}

/**
 * Checks a new PO against the order lines it's for. `candidates` are the
 * order's lines as stored; `canEnterCosts` is false for people who can't
 * see costs, whose cost fields are ignored rather than trusted.
 */
export function validateNewPo(
  input: NewPoInput,
  candidates: readonly PoCandidateLine[],
  canEnterCosts: boolean,
): { ok: true; po: ValidPo } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!input.supplierId.trim()) errors.supplierId = "Choose a supplier.";
  if (!isCurrency(input.currency)) errors.currency = "Choose a currency.";

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const lines: ValidPoLine[] = [];

  input.lines.forEach((l, i) => {
    const n = i + 1;
    const line = byId.get(l.orderLineId);
    if (!line) {
      errors[`lines.${i}`] = `Line ${n} isn't on this order.`;
      return;
    }
    if (seen.has(l.orderLineId)) {
      errors[`lines.${i}`] = `Line ${n} is listed twice.`;
      return;
    }
    seen.add(l.orderLineId);
    if (!canRaisePoFor(line)) {
      errors[`lines.${i}`] = `Line ${n} doesn't need a purchase order.`;
      return;
    }
    const quantity = parseQuantity(l.quantity);
    if (quantity === null) errors[`lines.${i}.quantity`] = `Line ${n}: enter a quantity above 0.`;
    else if (quantity > line.quantity) errors[`lines.${i}.quantity`] = `Line ${n}: can't order more than the customer ordered (${line.quantity}).`;
    const unitCostMinor = canEnterCosts && l.unitCost.trim() ? parseMoneyToMinor(l.unitCost) : null;
    if (canEnterCosts && l.unitCost.trim() && unitCostMinor === null) errors[`lines.${i}.unitCost`] = `Line ${n}: enter a cost like 12.50.`;
    const requestedDate = l.requestedDate.trim() ? parseIsoDate(l.requestedDate.trim()) : null;
    if (l.requestedDate.trim() && !requestedDate) errors[`lines.${i}.requestedDate`] = `Line ${n}: enter a real date.`;
    if (quantity !== null && quantity <= line.quantity) lines.push({ orderLineId: l.orderLineId, quantity, unitCostMinor, requestedDate });
  });

  if (input.lines.length === 0) errors.lines = "Choose at least one line.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, po: { supplierId: input.supplierId.trim(), currency: input.currency as Currency, lines } };
}

export interface NewSupplierInput {
  name: string;
  email: string;
  phone: string;
  currency: string;
  leadTimeDays: string;
}

export interface ValidSupplier {
  name: string;
  email: string | null;
  phone: string | null;
  currency: Currency;
  leadTimeDays: number | null;
}

export function validateNewSupplier(input: NewSupplierInput): { ok: true; supplier: ValidSupplier } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "Enter the supplier's name.";
  else if (name.length > 200) errors.name = "Use 200 characters or fewer.";
  const email = input.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "That doesn't look like an email address.";
  if (!isCurrency(input.currency)) errors.currency = "Choose a currency.";
  const lead = input.leadTimeDays.trim();
  const leadTimeDays = lead ? Number(lead) : null;
  if (lead && (!Number.isInteger(leadTimeDays) || leadTimeDays! < 0 || leadTimeDays! > 365)) errors.leadTimeDays = "Enter whole days between 0 and 365.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    supplier: { name, email: email || null, phone: input.phone.trim() || null, currency: input.currency as Currency, leadTimeDays },
  };
}
