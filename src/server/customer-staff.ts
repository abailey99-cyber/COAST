import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPrefs, listMessages, listNotifications } from "@/lib/data/customer-portal";
import { formatDateTime } from "@/lib/logic/format";
import { MaskingError } from "@/lib/logic/masking";
import { NOTIFY_LEVELS, NOTIFY_LEVEL_LABELS } from "@/lib/logic/notifications";
import { hasPermission } from "@/lib/logic/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { customerViewFor, trackingUrl } from "./customer-view";
import type { StaffContext } from "./session";

/** The order page's Customer panel: tracking link, conversation, update settings, what was sent, and a preview of their page. */

export interface OrderCustomerPanel {
  trackingCode: string;
  trackingLink: string;
  canManage: boolean;
  messages: { id: string; from: "customer" | "staff"; who: string; body: string; when: string; unread: boolean }[];
  unread: number;
  prefs: { email: string | null; level: string; dailyDigest: boolean };
  levels: { value: string; label: string }[];
  notifications: { id: string; when: string; summary: string; status: string; to: string | null; reason: string | null }[];
  /** "Customer view shows: …" (App.dc.html). */
  preview: { headline: string; latest: string; status: string } | { blocked: string } | null;
}

const STATUS_WORDS: Record<string, string> = {
  logged: "Written (email not connected yet)",
  sent: "Sent",
  failed: "Not sent",
  held: "Held",
  folded: "Folded into a later update",
  skipped: "Not sent",
};

export async function loadOrderCustomer(staff: StaffContext, supabase: SupabaseClient, orderId: string, trackingCode: string): Promise<OrderCustomerPanel> {
  const [messages, prefs, notifications] = await Promise.all([listMessages(supabase, orderId), getPrefs(supabase, orderId), listNotifications(supabase, orderId)]);
  let preview: OrderCustomerPanel["preview"] = null;
  const admin = createSupabaseAdminClient();
  if (admin) {
    try {
      const built = await customerViewFor(admin, orderId);
      if (built) {
        const v = built.view;
        preview = { headline: v.headline.kind, latest: v.latest, status: v.status.label };
      }
    } catch (e) {
      preview = { blocked: e instanceof MaskingError ? "The customer page is switched off for this order: it would have shown supplier details. Check the order's wording." : "The preview couldn't be built." };
    }
  }
  return {
    trackingCode,
    trackingLink: trackingUrl(trackingCode),
    canManage: hasPermission(staff.permissions, "customers.manage"),
    messages: messages.map((m) => ({
      id: m.id,
      from: m.authorKind,
      who: m.authorKind === "staff" ? (m.staffName ?? "Staff") : (m.customerName ? `${m.customerName} (customer)` : "Customer"),
      body: m.body,
      when: formatDateTime(new Date(m.createdAt)),
      unread: m.authorKind === "customer" && !m.readAt,
    })),
    unread: messages.filter((m) => m.authorKind === "customer" && !m.readAt).length,
    prefs: { email: prefs?.email ?? null, level: prefs?.level ?? "milestones", dailyDigest: prefs?.dailyDigest ?? false },
    levels: NOTIFY_LEVELS.map((l) => ({ value: l, label: NOTIFY_LEVEL_LABELS[l] })),
    notifications: notifications.map((n) => ({ id: n.id, when: formatDateTime(new Date(n.createdAt)), summary: n.summary, status: STATUS_WORDS[n.status] ?? n.status, to: n.toAddress, reason: n.reason })),
    preview,
  };
}
