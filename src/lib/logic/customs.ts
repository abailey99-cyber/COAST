/**
 * Customs (spec §5.3, decisions C6/C7). Pure.
 *
 * International detection, the mainland → territory cases a person has to
 * confirm, the document checklist an international shipment needs, and the
 * customer's wording for a customs hold.
 */

import { HOME_COUNTRY } from "./shipments";

/** Crown Dependencies: their own country codes, but often thought of as "domestic". */
const CROWN_DEPENDENCIES = new Set(["JE", "GG", "IM"]);

export interface BorderCheck {
  /** Treat as crossing a customs border. */
  international: boolean;
  /** Politically domestic but practically customs-relevant (GB → Northern Ireland, Jersey, Guernsey, Isle of Man): a person should confirm. */
  territory: boolean;
}

/**
 * Does a delivery cross a customs border? Abroad: yes. Mainland → Northern
 * Ireland (BT postcodes) or a Crown Dependency: it depends on the company's
 * setting (decision C6, default yes), and is flagged for a person to
 * confirm (spec §5.3) rather than settled by guesswork.
 */
export function borderCheck(deliveryCountry: string, deliveryPostcode: string, territoriesNeedCustoms: boolean, home: string = HOME_COUNTRY): BorderCheck {
  const country = deliveryCountry.trim().toUpperCase();
  const ni = country === "GB" && /^BT\d/i.test(deliveryPostcode.trim());
  const territory = home === "GB" && (ni || CROWN_DEPENDENCIES.has(country));
  if (territory) return { international: territoriesNeedCustoms, territory: true };
  return { international: country !== home, territory: false };
}

// ── Documents ───────────────────────────────────────────────────────────────
export const DOC_TYPES = ["commercial_invoice", "packing_list", "certificate_of_origin", "export_declaration", "import_declaration", "dangerous_goods_note", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABELS: Record<DocType, string> = {
  commercial_invoice: "Commercial invoice",
  packing_list: "Packing list",
  certificate_of_origin: "Certificate of origin",
  export_declaration: "Export declaration",
  import_declaration: "Import declaration",
  dangerous_goods_note: "Dangerous goods note",
  other: "Other",
};

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
}

export interface LineCustomsFacts {
  countryOfOrigin: string | null;
  dangerousGoods: string | null;
  hsCode: string | null;
}

/**
 * The documents an international shipment needs, as a starting checklist
 * staff can change: a commercial invoice and packing list always; an
 * export declaration leaving the home country; a certificate of origin
 * when goods were made elsewhere; a dangerous goods note when any line has
 * dangerous-goods detail.
 */
export function requiredDocuments(leg: "inbound" | "outbound" | "direct", lines: readonly LineCustomsFacts[], home: string = HOME_COUNTRY): DocType[] {
  const docs: DocType[] = ["commercial_invoice", "packing_list"];
  if (leg === "inbound") docs.push("import_declaration");
  else docs.push("export_declaration");
  if (lines.some((l) => l.countryOfOrigin && l.countryOfOrigin !== home)) docs.push("certificate_of_origin");
  if (lines.some((l) => l.dangerousGoods && l.dangerousGoods.trim())) docs.push("dangerous_goods_note");
  return docs;
}

/** Lines without an HS code: customs will ask for one. */
export function linesMissingHsCode(lines: readonly (LineCustomsFacts & { lineNo: number })[]): number[] {
  return lines.filter((l) => !l.hsCode).map((l) => l.lineNo);
}

export interface DocState {
  docType: DocType;
  required: boolean;
  receivedAt: string | null;
}

/** Needed documents still outstanding. */
export function outstandingDocuments(docs: readonly DocState[]): DocType[] {
  return docs.filter((d) => d.required && !d.receivedAt).map((d) => d.docType);
}

/** Does this shipment need someone to look at customs? */
export function needsCustomsAttention(s: { international: boolean; delivered: boolean; customsStatus: string; territoryUnconfirmed: boolean; outstandingDocs: number }): boolean {
  if (s.delivered) return false;
  if (s.territoryUnconfirmed) return true;
  if (!s.international) return false;
  return s.customsStatus === "held" || s.customsStatus === "unknown" || s.outstandingDocs > 0;
}

// ── Validation ──────────────────────────────────────────────────────────────
/** EORI-style customs number: two letters then up to 15 letters or digits (e.g. GB123456789000). */
export function normaliseEori(input: string): string | null | "invalid" {
  const v = input.replace(/\s+/g, "").toUpperCase();
  if (!v) return null;
  return /^[A-Z]{2}[A-Z0-9]{1,15}$/.test(v) ? v : "invalid";
}

/** HS commodity code: 6 to 10 digits (dots and spaces allowed when typed). */
export function normaliseHsCode(input: string): string | null | "invalid" {
  const v = input.replace(/[\s.]/g, "");
  if (!v) return null;
  return /^\d{6,10}$/.test(v) ? v : "invalid";
}

export function normaliseCountry(input: string): string | null | "invalid" {
  const v = input.trim().toUpperCase();
  if (!v) return null;
  return /^[A-Z]{2}$/.test(v) ? v : "invalid";
}

/** Decision C7: what a customer is told while customs holds things up. */
export const CUSTOMER_CUSTOMS_LINE = "Customs checks in progress — we're on it.";
