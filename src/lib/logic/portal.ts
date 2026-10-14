/**
 * The customer portal's layout (product-owner decision, 14 October 2026):
 * one COAST account across every business ("supplier", to the customer),
 * grouped by supplier, the supplier with the earliest delivery first, and an
 * "Arriving soon" list across all of them. Pure: "today" is passed in.
 */

export interface PortalOrderInput {
  key: string;
  businessId: string;
  /** Customer stage index 0–4, or null when cancelled. */
  stage: number | null;
  expectedFrom: string | null;
  expectedTo: string | null;
  placedAt: string;
}

export interface SupplierGroup<T extends PortalOrderInput> {
  businessId: string;
  /** Orders still on their way, earliest expected first; then delivered and cancelled, newest first. */
  open: T[];
  done: T[];
  /** The earliest expected date among open orders (null when none has a date). */
  nextExpected: string | null;
}

const isOpen = (o: PortalOrderInput) => o.stage !== null && o.stage < 4;

function byExpected(a: PortalOrderInput, b: PortalOrderInput): number {
  const ea = a.expectedFrom ?? a.expectedTo;
  const eb = b.expectedFrom ?? b.expectedTo;
  if (ea && eb && ea !== eb) return ea.localeCompare(eb);
  if (ea && !eb) return -1;
  if (!ea && eb) return 1;
  return b.placedAt.localeCompare(a.placedAt);
}

/** One group per supplier; the supplier with the earliest expected delivery comes first. */
export function groupBySupplier<T extends PortalOrderInput>(orders: readonly T[]): SupplierGroup<T>[] {
  const groups = new Map<string, SupplierGroup<T>>();
  for (const o of orders) {
    const g = groups.get(o.businessId) ?? { businessId: o.businessId, open: [], done: [], nextExpected: null };
    (isOpen(o) ? g.open : g.done).push(o);
    groups.set(o.businessId, g);
  }
  for (const g of groups.values()) {
    g.open.sort(byExpected);
    g.done.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    g.nextExpected = g.open.map((o) => o.expectedFrom ?? o.expectedTo).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  }
  return [...groups.values()].sort((a, b) => {
    // Something coming with a date → something coming without one → only finished orders.
    const rank = (g: SupplierGroup<T>) => (g.nextExpected ? 0 : g.open.length ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.nextExpected && b.nextExpected && a.nextExpected !== b.nextExpected) return a.nextExpected.localeCompare(b.nextExpected);
    return a.businessId.localeCompare(b.businessId);
  });
}

/**
 * Everything due in the next `days` days (or already due and not here),
 * across every supplier, soonest first. Orders without a date aren't
 * guessed into it.
 */
export function arrivingSoon<T extends PortalOrderInput>(orders: readonly T[], today: string, days = 7): T[] {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return orders.filter((o) => isOpen(o) && (o.expectedFrom ?? o.expectedTo) !== null && (o.expectedFrom ?? o.expectedTo)! <= end).sort(byExpected);
}

/** "Due today", "Overdue", "In 3 days" — a short label for the soonest end of the expected window. */
export function dueLabel(expectedFrom: string | null, expectedTo: string | null, today: string): string | null {
  const from = expectedFrom ?? expectedTo;
  const to = expectedTo ?? expectedFrom;
  if (!from || !to) return null;
  if (to < today) return "Later than expected";
  if (from <= today && today <= to) return from === to ? "Due today" : "Due now";
  const days = Math.round((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}
