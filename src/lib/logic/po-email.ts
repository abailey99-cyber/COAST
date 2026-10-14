/**
 * The emails COAST sends suppliers: a new PO, and a chase. Plain text plus
 * simple HTML that survives email clients. Pure — no I/O.
 *
 * Supplier-safe by construction: the input type has no field for the
 * customer's price, margin, internal notes or other suppliers.
 */

import { formatIsoDate, formatQuantity } from "./format";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SupplierPoLine {
  description: string;
  sku: string | null;
  quantity: number;
  requestedDate: string | null;
}

export interface SupplierPoEmailInput {
  to: string;
  buyerName: string;
  supplierName: string;
  poNumber: string;
  lines: readonly SupplierPoLine[];
  /** Only for direct-ship lines, where the supplier delivers to the customer. */
  deliverTo: string | null;
  confirmUrl: string;
  linkExpires: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function lineText(l: SupplierPoLine): string {
  return `- ${formatQuantity(l.quantity)} × ${l.description}${l.sku ? ` (${l.sku})` : ""}${l.requestedDate ? ` — needed by ${formatIsoDate(l.requestedDate)}` : ""}`;
}

const BTN = "display:inline-block;padding:12px 20px;border-radius:10px;background:#1A7584;color:#FFFFFF;text-decoration:none;font-weight:600";

function wrapHtml(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F6F5;font-family:Segoe UI,Arial,sans-serif;color:#0E2A3B"><div style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:24px">${inner}</div></body></html>`;
}

export function buildPoEmail(i: SupplierPoEmailInput): EmailMessage {
  const subject = `Purchase order ${i.poNumber} from ${i.buyerName}`;
  const text = [
    `Hello ${i.supplierName},`,
    "",
    `Please find purchase order ${i.poNumber} from ${i.buyerName}:`,
    "",
    ...i.lines.map(lineText),
    ...(i.deliverTo ? ["", `Deliver to: ${i.deliverTo}`] : []),
    "",
    `Please confirm the quantities and delivery date online — no login needed:`,
    i.confirmUrl,
    `(The link works until ${i.linkExpires}.)`,
    "",
    `Or reply to this email with your confirmed delivery date, quoting ${i.poNumber}.`,
    "",
    "Thank you,",
    i.buyerName,
  ].join("\n");

  const rows = i.lines
    .map(
      (l) =>
        `<tr><td style="padding:8px;border-top:1px solid #E3E9EB">${escapeHtml(formatQuantity(l.quantity))}</td><td style="padding:8px;border-top:1px solid #E3E9EB">${escapeHtml(l.description)}${l.sku ? `<br><span style="color:#5E7884">${escapeHtml(l.sku)}</span>` : ""}</td><td style="padding:8px;border-top:1px solid #E3E9EB">${escapeHtml(l.requestedDate ? formatIsoDate(l.requestedDate) : "—")}</td></tr>`,
    )
    .join("");
  const html = wrapHtml(
    `<p>Hello ${escapeHtml(i.supplierName)},</p>
<p>Please find purchase order <strong>${escapeHtml(i.poNumber)}</strong> from ${escapeHtml(i.buyerName)}:</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th align="left" style="padding:8px">Qty</th><th align="left" style="padding:8px">Item</th><th align="left" style="padding:8px">Needed by</th></tr>${rows}</table>
${i.deliverTo ? `<p><strong>Deliver to:</strong> ${escapeHtml(i.deliverTo)}</p>` : ""}
<p style="margin:24px 0"><a href="${escapeHtml(i.confirmUrl)}" style="${BTN}">Confirm this order</a></p>
<p style="color:#5E7884;font-size:13px">No login needed. The link works until ${escapeHtml(i.linkExpires)}. Or reply to this email with your confirmed delivery date, quoting ${escapeHtml(i.poNumber)}.</p>
<p>Thank you,<br>${escapeHtml(i.buyerName)}</p>`,
  );
  return { to: i.to, subject, text, html };
}

export interface ChaseEmailInput {
  to: string;
  buyerName: string;
  supplierName: string;
  poNumber: string;
  sentOn: string;
  confirmUrl: string | null;
  chaseNumber: number;
}

export function buildChaseEmail(i: ChaseEmailInput): EmailMessage {
  const subject = `Reminder: please confirm purchase order ${i.poNumber}`;
  const ask = i.confirmUrl ? `You can confirm online, no login needed: ${i.confirmUrl}` : `Please reply with your confirmed delivery date, quoting ${i.poNumber}.`;
  const text = [
    `Hello ${i.supplierName},`,
    "",
    `We sent purchase order ${i.poNumber} on ${i.sentOn} and haven't had a confirmation yet.${i.chaseNumber > 1 ? " This is a follow-up to our earlier reminder." : ""}`,
    "",
    ask,
    "",
    "Thank you,",
    i.buyerName,
  ].join("\n");
  const html = wrapHtml(
    `<p>Hello ${escapeHtml(i.supplierName)},</p>
<p>We sent purchase order <strong>${escapeHtml(i.poNumber)}</strong> on ${escapeHtml(i.sentOn)} and haven't had a confirmation yet.${i.chaseNumber > 1 ? " This is a follow-up to our earlier reminder." : ""}</p>
${i.confirmUrl ? `<p style="margin:24px 0"><a href="${escapeHtml(i.confirmUrl)}" style="${BTN}">Confirm this order</a></p><p style="color:#5E7884;font-size:13px">No login needed.</p>` : `<p>Please reply with your confirmed delivery date, quoting ${escapeHtml(i.poNumber)}.</p>`}
<p>Thank you,<br>${escapeHtml(i.buyerName)}</p>`,
  );
  return { to: i.to, subject, text, html };
}
