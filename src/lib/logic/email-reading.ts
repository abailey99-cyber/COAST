/**
 * Reading a supplier's email reply (spec §5.1, HowItWorks steps 3–5).
 * Deterministic rules only — no AI (CLAUDE.md). Anything the rules aren't
 * sure about goes to the review queue rather than being guessed. Pure: the
 * current time is passed in (needed to work out the year of "16 Oct").
 */

import type { Currency } from "./format";

export interface CleanedEmail {
  subject: string;
  body: string;
}

const HEADER = /^(from|sent|date|to|cc|bcc|subject|importance)\s*:/i;
const QUOTE_START = [/^-{2,}\s*original message/i, /^_{5,}/, /^on .{4,200}wrote:\s*$/i, /^>/, /^from:\s.+/i, /^sent from my /i];

/**
 * Keeps the newest message only: drops header lines at the top (keeping the
 * subject) and everything from the first quoted earlier message onwards, so
 * the PO's own requested date in the quoted original isn't mistaken for the
 * supplier's answer.
 */
export function cleanEmail(raw: string): CleanedEmail {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  let subject = "";
  let i = 0;
  while (i < lines.length && (HEADER.test(lines[i]!.trim()) || lines[i]!.trim() === "")) {
    const m = /^subject\s*:\s*(.*)$/i.exec(lines[i]!.trim());
    if (m) subject = m[1]!.trim();
    i++;
  }
  const body: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (QUOTE_START.some((re) => re.test(line))) break;
    body.push(lines[i]!);
  }
  return { subject, body: body.join("\n").trim() };
}

// ── Dates ───────────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export interface FoundDate {
  iso: string;
  text: string;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A date with no year is the one nearest after "60 days ago". */
function inferYear(m: number, d: number, now: Date): number {
  const floor = now.getTime() - 60 * 86_400_000;
  const y = now.getUTCFullYear();
  for (const candidate of [y - 1, y, y + 1]) {
    const t = Date.UTC(candidate, m - 1, d);
    if (t >= floor) return candidate;
  }
  return y + 1;
}

function fullYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

export function findDates(text: string, now: Date): FoundDate[] {
  const found: { iso: string; text: string; index: number }[] = [];
  const add = (index: number, t: string, value: string | null) => {
    if (value) found.push({ iso: value, text: t, index });
  };

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m.index!, m[0], iso(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) add(m.index!, m[0], iso(fullYear(m[3]!), Number(m[2]), Number(m[1])));
  // "16/10" — slash only: "3.10" is far more often a price than a date.
  for (const m of text.matchAll(/(?<![£€$\d.,/])\b(\d{1,2})\/(\d{1,2})\b(?![/.-]\d)/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) add(m.index!, m[0], iso(inferYear(mo, d, now), mo, d));
  }
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+(\\d{4}))?\\b`, "gi");
  for (const m of text.matchAll(dayMonth)) {
    const mo = MONTHS[m[2]!.slice(0, m[2]!.toLowerCase().startsWith("sept") ? 4 : 3).toLowerCase()]!;
    const d = Number(m[1]);
    add(m.index!, m[0], iso(m[3] ? Number(m[3]) : inferYear(mo, d, now), mo, d));
  }
  const monthDay = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");
  for (const m of text.matchAll(monthDay)) {
    const mo = MONTHS[m[1]!.slice(0, m[1]!.toLowerCase().startsWith("sept") ? 4 : 3).toLowerCase()]!;
    const d = Number(m[2]);
    add(m.index!, m[0], iso(m[3] ? Number(m[3]) : inferYear(mo, d, now), mo, d));
  }

  // Overlapping matches of the same text count once; distinct dates keep their first wording.
  found.sort((a, b) => a.index - b.index);
  const byIso = new Map<string, FoundDate>();
  for (const f of found) if (!byIso.has(f.iso)) byIso.set(f.iso, { iso: f.iso, text: f.text });
  return [...byIso.values()];
}

const VAGUE_DATE = /\b(today|tomorrow|next week|this week|end of (the )?(week|month)|asap|soon|shortly|in (a|\d+) (few )?(days?|weeks?))\b/i;

// ── Other things a reply can contain ────────────────────────────────────────
export function findPoNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bPO[-\s#:]*(\d{3,10})\b/gi)) out.add(`PO-${m[1]}`);
  return [...out];
}

export interface FoundPrice {
  minor: number;
  currency: Currency | null;
  text: string;
}

const SYMBOLS: Record<string, Currency> = { "£": "GBP", "€": "EUR", $: "USD" };

export function findPrices(text: string): FoundPrice[] {
  const out: FoundPrice[] = [];
  const toMinor = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
  for (const m of text.matchAll(/([£€$])\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)) {
    out.push({ minor: toMinor(m[2]!), currency: SYMBOLS[m[1]!] ?? null, text: m[0] });
  }
  for (const m of text.matchAll(/\b(GBP|EUR|USD)\s?(\d+(?:\.\d{1,2})?)\b|\b(\d+(?:\.\d{1,2})?)\s?(GBP|EUR|USD)\b/gi)) {
    const code = (m[1] ?? m[4])!.toUpperCase() as Currency;
    out.push({ minor: toMinor((m[2] ?? m[3])!), currency: code, text: m[0] });
  }
  return out;
}

export interface FoundTracking {
  number: string;
  carrier: "UPS" | null;
}

export function findTrackingNumbers(text: string): FoundTracking[] {
  const out = new Map<string, FoundTracking>();
  for (const m of text.matchAll(/\b1Z[0-9A-Z]{16}\b/gi)) out.set(m[0].toUpperCase(), { number: m[0].toUpperCase(), carrier: "UPS" });
  const labelled = /\b(?:tracking|track(?:ing)? (?:no|number|ref)|awb|waybill|consignment(?: no| number)?)\s*(?:no\.?|number|#|ref)?\s*[:\-]?\s*([A-Z0-9]{8,30})\b/gi;
  for (const m of text.matchAll(labelled)) {
    const n = m[1]!.toUpperCase();
    if (/\d/.test(n) && !out.has(n)) out.set(n, { number: n, carrier: null });
  }
  return [...out.values()];
}

const CONFIRM = /\b(confirm(ed|ing|s)?|accept(ed)?|can (do|supply|deliver|ship)|(will|shall) (be )?(deliver(ed)?|dispatch(ed)?|ship(ped)?|sent)|on (track|schedule)|booked( in)?|no problem|in stock|dispatched|shipped|on its way)\b/i;
const NEGATIVE = /\b(can(no|'|’)?t|unable|not able|out of stock|no stock|discontinued|back[\s-]?order(ed)?|delay(ed|s)?|shortage|unavailable|won(?:'|’)t|will not|not possible|regret)\b/i;
const PARTIAL = /\b(partial(ly)?|part[\s-]shipment|split (delivery|shipment)|only (have )?\d+|balance (to follow|will follow)|remaining \d+|short[\s-]shipped)\b/i;

export interface Extraction {
  poNumbers: string[];
  dates: FoundDate[];
  vagueDate: boolean;
  prices: FoundPrice[];
  trackingNumbers: FoundTracking[];
  confirms: boolean;
  negative: boolean;
  partial: boolean;
}

/** Everything the rules can read from one pasted reply. */
export function readSupplierEmail(raw: string, now: Date): Extraction {
  const { subject, body } = cleanEmail(raw);
  const all = `${subject}\n${body}`;
  return {
    poNumbers: findPoNumbers(all),
    dates: findDates(body, now),
    vagueDate: VAGUE_DATE.test(body),
    prices: findPrices(body),
    trackingNumbers: findTrackingNumbers(all),
    confirms: CONFIRM.test(body),
    negative: NEGATIVE.test(body),
    partial: PARTIAL.test(body),
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────────
export type Confidence = "high" | "medium" | "low";

export interface ScoringContext {
  poNumber: string;
  lineCount: number;
  currency: Currency;
}

export interface Score {
  confidence: Confidence;
  /** Plain-English reasons it isn't high, shown in the review queue. */
  reasons: string[];
  /** The confirmed date, when exactly one was found. */
  date: string | null;
  /** The price, when exactly one was found. */
  price: FoundPrice | null;
}

/**
 * High confidence means: it's about this PO, it clearly confirms, it gives
 * exactly one date, nothing negative or partial, and the PO has one line
 * (decisions B15 — multi-line confirmations always go to review).
 */
export function scoreExtraction(x: Extraction, ctx: ScoringContext): Score {
  const low: string[] = [];
  const medium: string[] = [];

  if (x.poNumbers.length > 0 && !x.poNumbers.includes(ctx.poNumber)) low.push(`It mentions ${x.poNumbers.join(", ")}, not ${ctx.poNumber}.`);
  if (x.negative) low.push("It says something can't be supplied, or is delayed.");
  if (x.dates.length === 0) (x.vagueDate ? medium : low).push(x.vagueDate ? "It gives a vague date, not a calendar date." : "No date found.");
  if (x.dates.length > 1) medium.push(`It mentions more than one date (${x.dates.map((d) => d.text).join(", ")}).`);
  if (x.partial) medium.push("It mentions a partial delivery.");
  if (!x.confirms && !x.negative) medium.push("It doesn't clearly confirm.");
  if (ctx.lineCount > 1) medium.push("The PO has several lines — a person checks which line each answer is for.");
  if (x.prices.length > 1) medium.push("It mentions more than one price.");
  const price = x.prices.length === 1 ? x.prices[0]! : null;
  if (price?.currency && price.currency !== ctx.currency) medium.push(`It quotes ${price.currency}; the PO is in ${ctx.currency}.`);

  const confidence: Confidence = low.length ? "low" : medium.length ? "medium" : "high";
  return {
    confidence,
    reasons: [...low, ...medium],
    date: x.dates.length === 1 ? x.dates[0]!.iso : null,
    price,
  };
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};
