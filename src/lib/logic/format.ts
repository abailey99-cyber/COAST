/**
 * UK display formatting (CLAUDE.md conventions, decisions C12/C13).
 * Dates like "Thu 16 Oct"; money with its symbol, e.g. "£1,250.00".
 */

export const DISPLAY_TIME_ZONE = "Europe/London";

export const CURRENCIES = ["GBP", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** "Thu 16 Oct" */
export function formatShortDate(date: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(date);
}

/** "Thursday 16 October" */
export function formatLongDate(date: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone }).format(date);
}

/**
 * Money is stored as integer minor units (pence/cents) to avoid float error.
 * formatMoney(125000, "GBP") → "£1,250.00"
 */
export function formatMoney(amountMinor: number, currency: Currency): string {
  if (!Number.isInteger(amountMinor)) throw new RangeError("amountMinor must be an integer number of minor units");
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(amountMinor / 100);
}

/** "Thu 15 Oct, 10:42" */
export function formatDateTime(date: Date, timeZone: string = DISPLAY_TIME_ZONE): string {
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
  return `${formatShortDate(date, timeZone)}, ${time}`;
}

/** A calendar date stored as "2026-10-16" (no time zone) → "Fri 16 Oct". */
export function formatIsoDate(iso: string | null): string {
  if (!iso) return "—";
  return formatShortDate(new Date(`${iso}T12:00:00Z`), "UTC");
}

/** Quantities: no trailing zeros, UK separators. 2 → "2", 1.5 → "1.5". */
export function formatQuantity(n: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(n);
}
