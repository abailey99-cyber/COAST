"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOrder } from "@/lib/data/orders";
import {
  addOrderToAccount,
  createCustomerAccount,
  findOrderByTrackingCode,
  getCustomerAccount,
  hitRateLimit,
  normaliseTrackingCode,
} from "@/lib/data/customer-portal";
import { emailChannel } from "@/lib/email/channel";
import { appUrl } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { visitorKey } from "./customer-view";
import { getCustomerSession } from "./customer-session";
import { NotAllowedError, requirePermission } from "./session";

/** Customer accounts (spec §5.5, decision E4): staff invite; customers sign in and add orders by tracking code. */

export interface AccountResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Shown once to staff, so they can pass it on while email isn't connected. */
  link?: string;
}

const NOT_CONNECTED = "Customer accounts aren't available right now.";

// ── Customers ───────────────────────────────────────────────────────────────
export async function signInCustomer(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return { ok: false, error: NOT_CONNECTED };
  if (!(await hitRateLimit(admin, `customer-sign-in:${await visitorKey()}`, 20, 600))) return { ok: false, error: "Too many tries. Please wait a few minutes." };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  const account = !error && data.user ? await getCustomerAccount(admin, data.user.id) : null;
  if (!account) {
    if (!error) await supabase.auth.signOut({ scope: "local" });
    // The same answer whatever went wrong (wrong password, no account, a staff login).
    return { ok: false, error: "That email and password don't match a customer account." };
  }
  redirect("/portal");
}

export async function signOutCustomer(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  redirect("/portal/sign-in");
}

/** E4: a tracking code adds that order to the signed-in customer's account (same business only). */
export async function addOrderByCode(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const account = await getCustomerSession();
  const admin = createSupabaseAdminClient();
  if (!account || !admin) return { ok: false, error: "Please sign in again." };
  if (!(await hitRateLimit(admin, `add-order:${account.userId}`, 30, 3600))) return { ok: false, error: "Too many tries. Please wait a while." };
  const code = normaliseTrackingCode(String(formData.get("code") ?? ""));
  const found = code ? await findOrderByTrackingCode(admin, code) : null;
  if (!found || found.orgId !== account.orgId) return { ok: false, error: "We couldn't find an order with that tracking code." };
  await addOrderToAccount(admin, account.userId, found.orderId);
  revalidatePath("/portal");
  return { ok: true, message: "Added to your orders." };
}

// ── Staff ───────────────────────────────────────────────────────────────────
/**
 * Invite the person on an order to a customer account. Their login is made
 * now with no password; the link lets them set one. Shown once here, and
 * emailed through the channel (logged until Microsoft 365 is connected).
 */
export async function inviteCustomer(orderId: string, _prev: AccountResult, formData: FormData): Promise<AccountResult> {
  try {
    const staff = await requirePermission("customers.manage");
    const name = String(formData.get("name") ?? "").trim().slice(0, 120);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!name) return { ok: false, error: "Enter their name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();
    if (!supabase || !admin) return { ok: false, error: NOT_CONNECTED };
    const order = await getOrder(supabase, orderId);
    if (!order) return { ok: false, error: "That order isn't available." };
    const { data: so } = await admin.from("sales_orders").select("customer_id, org_id").eq("id", orderId).single<{ customer_id: string; org_id: string }>();
    if (!so || so.org_id !== staff.orgId) return { ok: false, error: "That order isn't available." };

    // Someone with a login already?
    const { data: existingStaff } = await admin.from("staff_users").select("id").eq("email", email).maybeSingle();
    if (existingStaff) return { ok: false, error: "That address belongs to a COAST team member, so it can't be a customer account." };
    const { data: existingAccount } = await admin.from("customer_accounts").select("user_id, org_id").eq("email", email).maybeSingle<{ user_id: string; org_id: string }>();
    if (existingAccount) {
      if (existingAccount.org_id !== staff.orgId) return { ok: false, error: "That address already has a customer account with another business." };
      await addOrderToAccount(admin, existingAccount.user_id, orderId);
      revalidatePath(`/app/orders/${orderId}`);
      return { ok: true, message: `${email} already has an account. This order has been added to it.` };
    }

    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name, kind: "customer" } });
    if (created.error || !created.data.user) return { ok: false, error: "That login couldn't be made. If they already have one, ask them to sign in." };
    await createCustomerAccount(admin, { userId: created.data.user.id, orgId: staff.orgId, customerId: so.customer_id, fullName: name, email, invitedBy: staff.id });
    await addOrderToAccount(admin, created.data.user.id, orderId);

    const linkData = await admin.auth.admin.generateLink({ type: "recovery", email });
    const hashed = linkData.data?.properties?.hashed_token;
    if (linkData.error || !hashed) return { ok: true, message: "Account made, but the set-password link couldn't be. They can use “Forgotten it?” on the customer sign-in page." };
    const link = `${appUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=/auth/set-password`;
    await emailChannel().send({
      to: email,
      subject: `Your order tracking account with ${staff.orgName}`,
      text: `Hello ${name},\n\n${staff.orgName} has set up an account so you can see all your orders in one place.\n\nSet your password (the link works once): ${link}\n`,
      html: `<p>Hello ${name.replace(/[<>&]/g, "")},</p><p>${staff.orgName.replace(/[<>&]/g, "")} has set up an account so you can see all your orders in one place.</p><p><a href="${link}">Set your password</a> (the link works once).</p>`,
    });
    revalidatePath(`/app/orders/${orderId}`);
    return { ok: true, message: "Account made. Email isn't connected yet, so send them this link yourself — it works once:", link };
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, error: e.message };
    return { ok: false, error: "The invitation couldn't be made. Try again." };
  }
}
