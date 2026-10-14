"use server";

import { hitRateLimit, insertLead, orgIdBySlug } from "@/lib/data/customer-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { visitorKey } from "./customer-view";

export interface LeadResult {
  ok: boolean;
  error?: string;
}

const SIZES = ["1-10", "11-50", "51-200", "201+"];

/**
 * "Get COAST for your business" — register interest (spec §5.8). Billing
 * and self-serve trials come later (decision E5; trial noted for a later
 * phase). Records which business's tracking page sent them, so the
 * customer-page marketing can be measured.
 */
export async function registerInterest(_prev: LeadResult, formData: FormData): Promise<LeadResult> {
  try {
    const name = String(formData.get("name") ?? "").trim().slice(0, 120);
    const company = String(formData.get("company") ?? "").trim().slice(0, 200);
    const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
    const phone = String(formData.get("phone") ?? "").trim().slice(0, 40) || null;
    const size = String(formData.get("size") ?? "");
    const message = String(formData.get("message") ?? "").trim().slice(0, 2000) || null;
    const ref = String(formData.get("ref") ?? "");
    const slug = String(formData.get("b") ?? "");
    // A hidden field people never see: bots fill it in.
    if (String(formData.get("website") ?? "") !== "") return { ok: true };
    if (!name || !company) return { ok: false, error: "Please give your name and your company's name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "This isn't available right now. Please try again later." };
    if (!(await hitRateLimit(admin, `lead:${await visitorKey()}`, 5, 3600))) return { ok: false, error: "Thanks — we've already got your details. We'll be in touch." };
    await insertLead(admin, {
      name,
      company,
      email,
      phone,
      companySize: SIZES.includes(size) ? size : null,
      message,
      source: ref === "track" ? "tracking_page" : ref === "portal" ? "customer_portal" : "website",
      referrerOrg: slug ? await orgIdBySlug(admin, slug) : null,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "That didn't go through. Please try again." };
  }
}
