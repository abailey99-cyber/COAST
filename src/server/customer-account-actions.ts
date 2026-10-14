"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOrder } from "@/lib/data/orders";
import {
  addOrderToAccount,
  createCustomerAccount,
  findCustomerAccountByEmail,
  findOrderByTrackingCode,
  getCustomerAccount,
  hitRateLimit,
  linkAccountToCustomer,
  normaliseTrackingCode,
  removeOrderFromAccount,
  unlinkAccount,
} from "@/lib/data/customer-portal";
import { emailChannel } from "@/lib/email/channel";
import { appUrl } from "@/lib/env";
import { passwordProblem } from "@/lib/logic/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { visitorKey } from "./customer-view";
import { getCustomerSession } from "./customer-session";
import { NotAllowedError, requirePermission } from "./session";

/**
 * Customer accounts: one free COAST account per person, covering every
 * business that uses COAST (product-owner decision, 14 October 2026).
 * Orders get in three ways: a tracking code (that one order), the "Add to
 * my COAST account" button on a tracking page (that one order), or a
 * business vouching for the person (all that customer's orders, from then
 * on). A tracking code never adds more than its own order.
 */

export interface AccountResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Shown once to staff, so they can pass it on while email isn't connected. */
  link?: string;
}

const NOT_CONNECTED = "Customer accounts aren't available right now.";
const NOT_FOUND = "We couldn't find an order with that tracking code.";

/** Adds the order for a tracking code to an account; null if the code doesn't match. */
async function addByCode(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string, input: string): Promise<string | null> {
  const code = normaliseTrackingCode(input);
  const found = code ? await findOrderByTrackingCode(admin, code) : null;
  if (!found || !code) return null;
  await addOrderToAccount(admin, userId, found.orderId);
  return code;
}

/** Where to go after signing in or up: back to the tracking page they came from, or their orders. */
function after(code: string | null): string {
  return code ? `/track/${code}?added=1` : "/portal";
}

// ── Customers ───────────────────────────────────────────────────────────────
export async function signInCustomer(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const addCode = String(formData.get("add") ?? "");
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
  const added = addCode ? await addByCode(admin, account.userId, addCode) : null;
  redirect(after(added));
}

export async function signOutCustomer(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  redirect("/portal/sign-in");
}

/** A customer adds an order with its tracking code — from any business that uses COAST. */
export async function addOrderByCode(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const account = await getCustomerSession();
  const admin = createSupabaseAdminClient();
  if (!account || !admin) return { ok: false, error: "Please sign in again." };
  if (!(await hitRateLimit(admin, `add-order:${account.userId}`, 30, 3600))) return { ok: false, error: "Too many tries. Please wait a while." };
  const added = await addByCode(admin, account.userId, String(formData.get("code") ?? ""));
  if (!added) return { ok: false, error: NOT_FOUND };
  revalidatePath("/portal");
  return { ok: true, message: "Added to your orders." };
}

/** "Add to my COAST account" on a tracking page, for a signed-in customer. */
export async function addThisOrder(code: string): Promise<AccountResult> {
  const account = await getCustomerSession();
  const admin = createSupabaseAdminClient();
  if (!account || !admin) return { ok: false, error: "Please sign in again." };
  const added = await addByCode(admin, account.userId, code);
  if (!added) return { ok: false, error: NOT_FOUND };
  revalidatePath(`/track/${added}`);
  revalidatePath("/portal");
  return { ok: true, message: "Added to your COAST account." };
}

/** A customer takes an order off their list. */
export async function removeOrder(orderCode: string): Promise<AccountResult> {
  const account = await getCustomerSession();
  const admin = createSupabaseAdminClient();
  if (!account || !admin) return { ok: false, error: "Please sign in again." };
  const code = normaliseTrackingCode(orderCode);
  const found = code ? await findOrderByTrackingCode(admin, code) : null;
  if (!found) return { ok: false, error: NOT_FOUND };
  await removeOrderFromAccount(admin, account.userId, found.orderId);
  revalidatePath("/portal");
  return { ok: true };
}

/** A customer stops a business adding their orders automatically. */
export async function stopFollowing(orgId: string): Promise<AccountResult> {
  const account = await getCustomerSession();
  const admin = createSupabaseAdminClient();
  if (!account || !admin) return { ok: false, error: "Please sign in again." };
  await unlinkAccount(admin, account.userId, orgId);
  revalidatePath("/portal");
  return { ok: true, message: "New orders from them won't be added automatically. Orders already here stay." };
}

/**
 * A customer makes their own free account. A tracking code is optional: with
 * one, that order is added. Accounts aren't tied to one business.
 *
 * UNVERIFIED: the email address isn't proven yet — confirming it needs real
 * email (Phase 8). Low risk meanwhile: a self-made account only ever sees
 * orders whose tracking codes its owner holds. See KNOWN-GAPS.md.
 */
export async function signUpCustomer(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  let addedCode: string | null = null;
  try {
    const codeText = String(formData.get("code") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim().slice(0, 120);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (!name) return { ok: false, error: "Enter your name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
    const problem = passwordProblem(password, confirm);
    if (problem) return { ok: false, error: problem };
    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();
    if (!supabase || !admin) return { ok: false, error: NOT_CONNECTED };
    if (!(await hitRateLimit(admin, `customer-sign-up:${await visitorKey()}`, 10, 3600))) return { ok: false, error: "Too many tries. Please wait a while and try again." };

    const code = codeText ? normaliseTrackingCode(codeText) : null;
    const found = code ? await findOrderByTrackingCode(admin, code) : null;
    if (codeText && !found) return { ok: false, error: `${NOT_FOUND} Leave it blank to add orders later.` };

    // The same message whether the address is a team member's or already has an account — it doesn't reveal which.
    const taken = "That email address can't be used for a new account. If it's yours, sign in instead, or use “Forgotten your password?”.";
    const [{ data: staffRow }, existing] = await Promise.all([admin.from("staff_users").select("id").eq("email", email).maybeSingle(), findCustomerAccountByEmail(admin, email)]);
    if (staffRow || existing) return { ok: false, error: taken };

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, kind: "customer" } });
    if (created.error || !created.data.user) return { ok: false, error: taken };
    try {
      await createCustomerAccount(admin, { userId: created.data.user.id, fullName: name, email });
      if (found) await addOrderToAccount(admin, created.data.user.id, found.orderId);
    } catch {
      await admin.auth.admin.deleteUser(created.data.user.id);
      return { ok: false, error: "Your account couldn't be made. Please try again." };
    }
    await emailChannel().send({
      to: email,
      subject: "Your free COAST account",
      text: `Hello ${name},\n\nYour COAST account is ready. Track deliveries from every business that uses COAST in one place: ${appUrl()}/portal/sign-in\n`,
      html: `<p>Hello ${name.replace(/[<>&]/g, "")},</p><p>Your COAST account is ready. <a href="${appUrl()}/portal/sign-in">Sign in</a> to track deliveries from every business that uses COAST in one place.</p>`,
    });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: true, message: "Your account is ready. Please sign in." };
    addedCode = found ? code : null;
  } catch {
    return { ok: false, error: "Your account couldn't be made. Please try again." };
  }
  redirect(after(addedCode));
}

// ── Staff ───────────────────────────────────────────────────────────────────
/**
 * Invite (vouch for) the customer on an order. Their COAST account — new or
 * existing, whoever else they buy from — is linked to this customer, so this
 * business's orders for them are added automatically from now on. A new
 * login gets a set-password link, shown once here and emailed through the
 * channel (logged until Microsoft 365 is connected).
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
    if (!(await getOrder(supabase, orderId))) return { ok: false, error: "That order isn't available." };
    const { data: so } = await admin.from("sales_orders").select("customer_id, org_id").eq("id", orderId).single<{ customer_id: string; org_id: string }>();
    if (!so || so.org_id !== staff.orgId) return { ok: false, error: "That order isn't available." };

    const { data: existingStaff } = await admin.from("staff_users").select("id").eq("email", email).maybeSingle();
    if (existingStaff) return { ok: false, error: "That address belongs to a COAST team member, so it can't be a customer account." };

    const existing = await findCustomerAccountByEmail(admin, email);
    if (existing) {
      await linkAccountToCustomer(admin, { userId: existing.userId, orgId: staff.orgId, customerId: so.customer_id, vouchedBy: staff.id });
      revalidatePath(`/app/orders/${orderId}`);
      return { ok: true, message: `${email} already has a COAST account. Your orders for this customer will now appear in it automatically.` };
    }

    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name, kind: "customer" } });
    if (created.error || !created.data.user) return { ok: false, error: "That login couldn't be made. If they already have one, ask them to sign in." };
    await createCustomerAccount(admin, { userId: created.data.user.id, fullName: name, email });
    await linkAccountToCustomer(admin, { userId: created.data.user.id, orgId: staff.orgId, customerId: so.customer_id, vouchedBy: staff.id });

    const linkData = await admin.auth.admin.generateLink({ type: "recovery", email });
    const hashed = linkData.data?.properties?.hashed_token;
    if (linkData.error || !hashed) return { ok: true, message: "Account made, but the set-password link couldn't be. They can use “Forgotten your password?” on the customer sign-in page." };
    const link = `${appUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=/auth/set-password`;
    await emailChannel().send({
      to: email,
      subject: `${staff.orgName} has set up order tracking for you`,
      text: `Hello ${name},\n\n${staff.orgName} uses COAST to keep you up to date. Your free account shows their orders — and deliveries from any other business that uses COAST — in one place.\n\nSet your password (the link works once): ${link}\n`,
      html: `<p>Hello ${name.replace(/[<>&]/g, "")},</p><p>${staff.orgName.replace(/[<>&]/g, "")} uses COAST to keep you up to date. Your free account shows their orders — and deliveries from any other business that uses COAST — in one place.</p><p><a href="${link}">Set your password</a> (the link works once).</p>`,
    });
    revalidatePath(`/app/orders/${orderId}`);
    return { ok: true, message: "Account made, and this customer's orders will appear in it automatically. Email isn't connected yet, so send them this link yourself — it works once:", link };
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, error: e.message };
    return { ok: false, error: "The invitation couldn't be made. Try again." };
  }
}

/** Staff stop adding this customer's orders to someone's account automatically. */
export async function stopLinkingAccount(orderId: string, userId: string): Promise<AccountResult> {
  try {
    const staff = await requirePermission("customers.manage");
    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();
    if (!supabase || !admin) return { ok: false, error: NOT_CONNECTED };
    if (!(await getOrder(supabase, orderId))) return { ok: false, error: "That order isn't available." };
    const { data: so } = await admin.from("sales_orders").select("customer_id").eq("id", orderId).single<{ customer_id: string }>();
    if (!so) return { ok: false, error: "That order isn't available." };
    await unlinkAccount(admin, userId, staff.orgId, so.customer_id);
    revalidatePath(`/app/orders/${orderId}`);
    return { ok: true, message: "New orders won't be added to their account automatically. Orders already there stay." };
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, error: e.message };
    return { ok: false, error: "That couldn't be saved. Try again." };
  }
}
