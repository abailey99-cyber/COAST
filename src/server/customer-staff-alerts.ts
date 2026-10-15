import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailChannel } from "@/lib/email/channel";
import { appUrl } from "@/lib/env";

/**
 * Spec §5.5: the assigned rep — or, with no rep, procurement (decision C5) —
 * hears the moment a customer writes in. Shown as unread on the Orders
 * screen and the order; also emailed through the channel (logged until
 * Microsoft 365 is connected).
 */
export async function alertStaffToCustomerMessage(admin: SupabaseClient, orgId: string, orderId: string, body: string, path?: string): Promise<void> {
  try {
    const { data: order } = await admin.from("sales_orders").select("so_number, sales_rep_id").eq("id", orderId).single<{ so_number: string; sales_rep_id: string | null }>();
    if (!order) return;
    let recipients: { email: string }[] = [];
    if (order.sales_rep_id) {
      const { data } = await admin.from("staff_users").select("email").eq("id", order.sales_rep_id).eq("is_active", true);
      recipients = (data ?? []) as { email: string }[];
    }
    if (recipients.length === 0) {
      const { data } = await admin.from("staff_users").select("email").eq("org_id", orgId).eq("role", "procurement").eq("is_active", true).limit(10);
      recipients = (data ?? []) as { email: string }[];
    }
    const link = `${appUrl()}${path ?? `/app/orders/${orderId}`}`;
    const channel = emailChannel();
    for (const r of recipients) {
      await channel.send({
        to: r.email,
        subject: path ? `Delivery problem reported on ${order.so_number}` : `Customer message on ${order.so_number}`,
        text: `A customer wrote about ${order.so_number}:\n\n${body.slice(0, 1000)}\n\nReply from the order: ${link}`,
        html: `<p>A customer wrote about <strong>${order.so_number}</strong>:</p><blockquote>${body.slice(0, 1000).replace(/[<>&]/g, "")}</blockquote><p><a href="${link}">Reply from the order</a></p>`,
      });
    }
  } catch (e) {
    console.warn("[messages] couldn't alert staff", e instanceof Error ? e.message : e);
  }
}
