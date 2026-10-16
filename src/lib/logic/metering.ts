/**
 * Order metering (readiness plan Task 6). Pure.
 *
 * An "order" is one sales order, counted once, in the calendar month (UK
 * time) it was created in COAST or first synced from an ERP — however many
 * lines, POs or shipments it has, and however often it's synced again.
 * There's no billing yet: admins see the monthly count.
 */

/** "2026-10" — the UK calendar month an instant falls in (handles GMT/BST). */
export function meterMonth(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

/** "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** Count orders per month from their first-seen times; an order seen twice (synced again) counts once, in its first month. */
export function countByMonth(orders: readonly { id: string; firstSeenAt: string }[]): Map<string, number> {
  const first = new Map<string, string>();
  for (const o of orders) {
    const prev = first.get(o.id);
    if (!prev || o.firstSeenAt < prev) first.set(o.id, o.firstSeenAt);
  }
  const out = new Map<string, number>();
  for (const at of first.values()) {
    const m = meterMonth(at);
    out.set(m, (out.get(m) ?? 0) + 1);
  }
  return out;
}
