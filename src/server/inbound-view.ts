import "server-only";
import { listConnections } from "@/lib/data/credentials";
import { getInboundAddress, listInboundMessages } from "@/lib/data/inbound";
import { formatDateTime } from "@/lib/logic/format";
import { exchangeScopingCommands } from "@/lib/logic/inbound-email";
import { hasPermission } from "@/lib/logic/permissions";
import { platformApp } from "@/lib/inbound/m365";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consentRedirectUri } from "./m365";
import { requireStaff, type StaffContext } from "./session";

/** Loaders for supplier replies by email (readiness Task 3): Settings and the review queue. */

export interface ForwardingView {
  /** Mailgun and the inbound domain are set up for COAST. */
  serviceReady: boolean;
  address: string | null;
  allowedDomains: string[];
  canEdit: boolean;
  m365: {
    appReady: boolean;
    connected: boolean;
    consented: string | null;
    mailbox: string | null;
    redirectUri: string;
    commands: string | null;
  };
}

export async function loadForwarding(staff: StaffContext): Promise<ForwardingView | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const [address, connections] = await Promise.all([getInboundAddress(supabase), listConnections(supabase)]);
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim() || null;
  const m365 = connections.find((c) => c.provider === "microsoft365") ?? null;
  const app = platformApp();
  return {
    serviceReady: Boolean(domain && process.env.MAILGUN_WEBHOOK_SIGNING_KEY?.trim()),
    address: address && domain ? `${address.localPart}@${domain}` : address ? address.localPart : null,
    allowedDomains: address?.allowedDomains ?? [],
    canEdit: staff.role === "admin",
    m365: {
      appReady: Boolean(app),
      connected: Boolean(m365),
      consented: m365?.config.consentedAt ? formatDateTime(new Date(m365.config.consentedAt)) : null,
      mailbox: m365?.config.mailbox ?? null,
      redirectUri: consentRedirectUri(),
      commands:
        app && m365?.config.mailbox
          ? exchangeScopingCommands({ appId: app.clientId, servicePrincipalObjectId: "<Object ID from Entra → Enterprise applications → COAST>", mailbox: m365.config.mailbox })
          : null,
    },
  };
}

export interface EmailToSort {
  id: string;
  when: string;
  from: string;
  subject: string;
  excerpt: string;
  status: "unmatched" | "quarantined";
  reason: string;
  channel: string;
}

/** Emails COAST couldn't match to one PO, or held back because they weren't forwarded by the organisation's mailbox. */
export async function loadEmailsToSort(): Promise<{ canSort: boolean; items: EmailToSort[] }> {
  const staff = await requireStaff({ section: "review-queue" });
  if (!hasPermission(staff.permissions, "procurement.manage")) return { canSort: false, items: [] };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { canSort: false, items: [] };
  const rows = await listInboundMessages(supabase, ["unmatched", "quarantined"], 50);
  return {
    canSort: true,
    items: rows.map((r) => ({
      id: r.id,
      when: formatDateTime(new Date(r.receivedAt)),
      from: r.fromAddress ?? "Unknown sender",
      subject: r.subject || "(no subject)",
      excerpt: (r.body ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
      status: r.status === "quarantined" ? "quarantined" : "unmatched",
      reason: r.reason ?? "",
      channel: r.channel === "m365" ? "Microsoft 365 mailbox" : "Forwarded",
    })),
  };
}
