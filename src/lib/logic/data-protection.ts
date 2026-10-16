/**
 * Data protection (readiness plan Task 6). Pure: what's personal and how
 * it's handled, what an organisation's export contains, and CSV writing.
 * tests/rls/data-protection.test.ts checks these lists against the real
 * database, so a new table or column can't slip past them.
 */

// ── Personal data, column by column ─────────────────────────────────────────
export type Handling =
  /** Found, exported and cleared by "find a person" (and, for customers, by retention). */
  | "person"
  /** Part of the order record (a delivery address, an item): kept with the order. */
  | "order_record"
  /** Staff: managed through Team management, not this tool. */
  | "staff"
  /** COAST's own records, not an organisation's: handled by the founder. */
  | "platform"
  /** Not personal data. */
  | "not_personal";

export const PERSONAL_DATA: Readonly<Record<string, Handling>> = {
  "attachments.file_name": "not_personal",
  "audit_log.table_name": "not_personal",
  "branches.address": "not_personal",
  "branches.code": "not_personal",
  "branches.name": "not_personal",
  "chases.note": "not_personal",
  "chases.resolution_note": "not_personal",
  "currencies.name": "not_personal",
  "customer_accounts.email": "person",
  "customer_accounts.full_name": "person",
  "customer_notification_prefs.email": "person",
  "customer_notifications.body_html": "person",
  "customer_notifications.body_text": "person",
  "customer_notifications.subject": "person",
  "customer_notifications.to_address": "person",
  "customer_page_settings.display_name": "not_personal",
  "customers.name": "order_record",
  "customs_documents.note": "not_personal",
  "delivery_exceptions.description": "person",
  "delivery_exceptions.reporter_name": "person",
  "delivery_exceptions.resolution_note": "not_personal",
  "erp_branch_mappings.source_field": "not_personal",
  "erp_branch_mappings.source_value": "not_personal",
  "goods_receipts.note": "not_personal",
  "inbound_messages.body": "person",
  "inbound_messages.envelope_sender": "person",
  "inbound_messages.from_address": "person",
  "inbound_messages.subject": "person",
  "leads.email": "platform",
  "leads.name": "platform",
  "leads.phone": "platform",
  "order_lines.description": "order_record",
  "order_messages.body": "person",
  "order_messages.customer_name": "person",
  "organisations.name": "not_personal",
  "outbound_emails.body_html": "person",
  "outbound_emails.body_text": "person",
  "outbound_emails.subject": "not_personal",
  "outbound_emails.to_address": "person",
  "purchase_orders.notes": "not_personal",
  "sales_orders.delivery_line1": "order_record",
  "sales_orders.delivery_line2": "order_record",
  "sales_orders.delivery_name": "order_record",
  "sales_orders.delivery_postcode": "order_record",
  "sales_orders.delivery_town": "order_record",
  "sales_orders.predicted_override_note": "not_personal",
  "shipments.note": "not_personal",
  "staff_users.email": "staff",
  "staff_users.full_name": "staff",
  "supplier_responses.raw_text": "person",
  "supplier_responses.review_note": "not_personal",
  "suppliers.email": "person",
  "suppliers.known_senders": "person",
  "suppliers.name": "not_personal",
  "suppliers.notes": "not_personal",
  "suppliers.phone": "person",
  "tracking_events.description": "not_personal",
};

/** Sections of a person's report, in the words the admin sees. */
export const PERSON_SECTIONS: Readonly<Record<string, string>> = {
  order_update_emails: "Order update emails they signed up for",
  emails_sent_to_them: "Update emails COAST sent them",
  emails_from_them: "Emails received from them",
  emails_to_them_as_supplier: "PO emails sent to them",
  supplier_contact: "Supplier contact details",
  customer_account: "Their COAST account's link to you",
  messages_they_wrote: "Messages they wrote (matched by name)",
  problems_they_reported: "Delivery problems they reported (matched by name)",
};

export function personTotal(counts: Readonly<Record<string, number | unknown[]>>): number {
  return Object.values(counts).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : Number(v) || 0), 0);
}

// ── The organisation's export ───────────────────────────────────────────────
export type OrgRoute = { kind: "org" } | { kind: "self" } | { kind: "via"; column: string; parent: string; parentColumn?: string };

/** Every table an organisation's data lives in, and how its rows are found. */
export const EXPORT_TABLES: readonly { table: string; route: OrgRoute }[] = [
  { table: "organisations", route: { kind: "self" } },
  ...[
    "staff_users", "role_permissions", "customers", "suppliers", "sales_orders", "purchase_orders", "supplier_responses", "outbound_emails", "chases", "chase_settings",
    "shipments", "carrier_settings", "carrier_activity", "order_messages", "customer_notifications", "customer_page_settings", "goods_receipts", "delivery_exceptions",
    "attachments", "customs_settings", "prediction_settings", "product_availability", "audit_log", "integration_credentials", "security_events",
    "inbound_addresses", "inbound_messages", "tracking_registrations", "tracking_usage", "order_meter", "data_settings", "customer_account_links",
    "branches", "user_branch_access", "erp_branch_mappings",
  ].map((table) => ({ table, route: { kind: "org" } as OrgRoute })),
  { table: "order_lines", route: { kind: "via", column: "sales_order_id", parent: "sales_orders" } },
  { table: "order_events", route: { kind: "via", column: "sales_order_id", parent: "sales_orders" } },
  { table: "order_predictions", route: { kind: "via", column: "sales_order_id", parent: "sales_orders" } },
  { table: "customer_notification_prefs", route: { kind: "via", column: "sales_order_id", parent: "sales_orders" } },
  { table: "customer_account_orders", route: { kind: "via", column: "sales_order_id", parent: "sales_orders" } },
  { table: "purchase_order_lines", route: { kind: "via", column: "purchase_order_id", parent: "purchase_orders" } },
  { table: "purchase_order_line_costs", route: { kind: "via", column: "purchase_order_line_id", parent: "purchase_order_lines" } },
  { table: "po_links", route: { kind: "via", column: "purchase_order_id", parent: "purchase_orders" } },
  { table: "supplier_response_prices", route: { kind: "via", column: "supplier_response_id", parent: "supplier_responses" } },
  { table: "shipment_lines", route: { kind: "via", column: "shipment_id", parent: "shipments" } },
  { table: "shipment_poll_state", route: { kind: "via", column: "shipment_id", parent: "shipments" } },
  { table: "tracking_events", route: { kind: "via", column: "shipment_id", parent: "shipments" } },
  { table: "customs_documents", route: { kind: "via", column: "shipment_id", parent: "shipments" } },
  { table: "aggregator_events", route: { kind: "via", column: "shipment_id", parent: "shipments" } },
  { table: "delivery_exception_lines", route: { kind: "via", column: "exception_id", parent: "delivery_exceptions" } },
  { table: "delivery_exception_events", route: { kind: "via", column: "exception_id", parent: "delivery_exceptions" } },
  { table: "staff_permission_overrides", route: { kind: "via", column: "user_id", parent: "staff_users" } },
];

/** Not an organisation's own data (shared reference lists, COAST's own records), so not in its export. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  currencies: "shared reference list",
  permissions: "shared reference list",
  permission_defaults: "shared reference list",
  customer_accounts: "people with their own COAST accounts across businesses (their link to you is exported)",
  leads: "COAST's own sales enquiries",
  rate_limit_hits: "short-lived counters",
  cron_runs: "COAST's job log",
  document_counters: "number sequences",
  m365_sync_state: "where mailbox reading got to",
  org_plans: "COAST's billing settings",
};

/** Never in an export: secrets, even encrypted, and link codes. */
export const EXPORT_DROP_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  integration_credentials: ["ciphertext"],
  po_links: ["token_hash"],
};

// ── CSV ─────────────────────────────────────────────────────────────────────
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Spreadsheets run cells starting with these as formulas ("CSV injection"): make them plain text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with a header row; columns are the union of every row's keys, in first-seen order. */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  if (cols.length === 0) return "";
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
