"use server";

import { revalidatePath } from "next/cache";
import { getOrder } from "@/lib/data/orders";
import {
  getCustomerPageSettings,
  insertStaffMessage,
  leakSecretsForOrder,
  markCustomerMessagesRead,
  regenerateTrackingCode,
  savePrefs,
  updateCustomerPageSettings,
} from "@/lib/data/customer-portal";
import { describeLeaks, findLeaks } from "@/lib/logic/masking";
import { isNotifyLevel } from "@/lib/logic/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyCustomerLater } from "./notifications";
import { NotAllowedError, requirePermission } from "./session";

/** Staff talking to customers (spec §5.5): replies (leak-checked), update settings, tracking codes, customer page settings. */

export interface CustomerResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function failure(e: unknown, fallback: string): CustomerResult {
  if (e instanceof NotAllowedError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

/** A staff reply. Blocked — with the reason — if it names a supplier or a PO (non-negotiable 1). */
export async function replyToCustomer(orderId: string, _prev: CustomerResult, formData: FormData): Promise<CustomerResult> {
  try {
    const staff = await requirePermission("customers.manage");
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { ok: false, error: "Write your reply first." };
    if (body.length > 4000) return { ok: false, error: "Keep the reply under 4,000 characters." };
    const supabase = await client();
    if (!(await getOrder(supabase, orderId))) return { ok: false, error: "That order isn't available." };
    // Checked against every supplier and PO in the company, whether or not this person can see them.
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "Replies aren't available right now." };
    const [secrets, settings] = await Promise.all([leakSecretsForOrder(admin, staff.orgId, orderId), getCustomerPageSettings(supabase)]);
    const leaks = findLeaks(body, secrets);
    if (leaks.length > 0) return { ok: false, error: describeLeaks(leaks, settings.supplierWord) };
    await insertStaffMessage(supabase, staff.orgId, orderId, staff.id, body);
    await markCustomerMessagesRead(supabase, orderId, staff.id);
    notifyCustomerLater(orderId, "reply", { replyText: body });
    revalidatePath(`/app/orders/${orderId}`);
    revalidatePath("/app/orders");
    return { ok: true, message: "Sent. The customer sees it on their tracking page, and by email if they've chosen updates." };
  } catch (e) {
    return failure(e, "The reply couldn't be sent. Try again.");
  }
}

export async function markMessagesRead(orderId: string): Promise<CustomerResult> {
  try {
    const staff = await requirePermission("customers.manage");
    await markCustomerMessagesRead(await client(), orderId, staff.id);
    revalidatePath(`/app/orders/${orderId}`);
    revalidatePath("/app/orders");
    return { ok: true };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

/** Who hears about this order, and how much. */
export async function saveOrderUpdates(orderId: string, _prev: CustomerResult, formData: FormData): Promise<CustomerResult> {
  try {
    const staff = await requirePermission("customers.manage");
    const level = String(formData.get("level") ?? "");
    if (!isNotifyLevel(level)) return { ok: false, error: "Choose how much they'll hear." };
    const emailText = String(formData.get("email") ?? "").trim();
    if (emailText && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailText)) return { ok: false, error: "That email address doesn't look right." };
    const supabase = await client();
    if (!(await getOrder(supabase, orderId))) return { ok: false, error: "That order isn't available." };
    await savePrefs(supabase, orderId, staff.id, { email: emailText || null, level, dailyDigest: formData.get("digest") === "on" });
    revalidatePath(`/app/orders/${orderId}`);
    return { ok: true, message: "Saved." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

/** A new tracking code: the old one (and any link with it) stops working at once. */
export async function newTrackingCode(orderId: string): Promise<CustomerResult> {
  try {
    await requirePermission("customers.manage");
    const supabase = await client();
    if (!(await getOrder(supabase, orderId))) return { ok: false, error: "That order isn't available." };
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "That isn't available right now." };
    const code = await regenerateTrackingCode(admin, orderId);
    revalidatePath(`/app/orders/${orderId}`);
    return code ? { ok: true, message: `New code ${code}. The old one no longer works.` } : { ok: false, error: "That order isn't available." };
  } catch (e) {
    return failure(e, "A new code couldn't be made. Try again.");
  }
}

/** Settings → Customer page. */
export async function saveCustomerPageSettings(_prev: CustomerResult, formData: FormData): Promise<CustomerResult> {
  try {
    const staff = await requirePermission("settings.edit");
    const displayName = String(formData.get("displayName") ?? "").trim().slice(0, 120) || null;
    const logoUrl = String(formData.get("logoUrl") ?? "").trim() || null;
    const supplierWord = String(formData.get("supplierWord") ?? "").trim().toLowerCase();
    const minGapHours = Number(formData.get("minGapHours"));
    const dateShiftDays = Number(formData.get("dateShiftDays"));
    if (logoUrl && !/^https:\/\/\S{4,500}$/.test(logoUrl)) return { ok: false, error: "The logo must be a web address starting https://." };
    if (!/^[a-z][a-z -]{1,23}$/.test(supplierWord)) return { ok: false, error: "The word for a supplier must be 2–24 letters, e.g. shipper or partner." };
    if (!Number.isInteger(minGapHours) || minGapHours < 0 || minGapHours > 72) return { ok: false, error: "The gap between updates must be 0–72 hours." };
    if (!Number.isInteger(dateShiftDays) || dateShiftDays < 0 || dateShiftDays > 30) return { ok: false, error: "The date change must be 0–30 days." };
    await updateCustomerPageSettings(await client(), staff.orgId, staff.id, {
      displayName,
      logoUrl,
      supplierWord,
      showDirectCarrier: formData.get("showDirectCarrier") === "on",
      minGapHours,
      dateShiftDays,
    });
    revalidatePath("/app/settings");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return failure(e, "The settings couldn't be saved. Try again.");
  }
}
