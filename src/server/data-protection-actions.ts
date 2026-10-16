"use server";

import { revalidatePath } from "next/cache";
import { recordSecurityEvent } from "@/lib/data/credentials";
import { findPerson, forgetPerson, saveDataSettings } from "@/lib/data/data-protection";
import { PERSON_SECTIONS, personTotal } from "@/lib/logic/data-protection";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotAllowedError, requireAdmin } from "./session";

/** Settings → Data protection (readiness plan Task 6). Admin only. */

export interface PersonResult {
  ok: boolean;
  error?: string;
  email?: string;
  name?: string | null;
  sections?: { key: string; label: string; count: number }[];
  total?: number;
  /** Everything found, as JSON, for the admin to download and send to the person. */
  json?: string;
  message?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function read(formData: FormData): { email: string; name: string | null } | string {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || null;
  if (!EMAIL.test(email)) return "Enter the person's email address.";
  return { email, name };
}

export async function lookUpPerson(_prev: PersonResult | null, formData: FormData): Promise<PersonResult> {
  try {
    const staff = await requireAdmin();
    const who = read(formData);
    if (typeof who === "string") return { ok: false, error: who };
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "This isn't available right now." };
    const found = await findPerson(admin, staff.orgId, who.email, who.name);
    await recordSecurityEvent(admin, { orgId: staff.orgId, kind: "person_looked_up", actorId: staff.id, detail: { total: personTotal(found) } });
    return {
      ok: true,
      ...who,
      sections: Object.entries(PERSON_SECTIONS).map(([key, label]) => ({ key, label, count: (found[key] ?? []).length })),
      total: personTotal(found),
      json: JSON.stringify({ email: who.email, name: who.name, exportedAt: new Date().toISOString(), records: found }, null, 2),
    };
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : "That couldn't be looked up. Try again." };
  }
}

/** Clear the person's details. The orders stay; what identifies them goes. Can't be undone. */
export async function removePerson(_prev: PersonResult | null, formData: FormData): Promise<PersonResult> {
  try {
    const staff = await requireAdmin();
    const who = read(formData);
    if (typeof who === "string") return { ok: false, error: who };
    if (formData.get("confirm") !== who.email) return { ok: false, error: "Type the email address again to confirm." };
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "This isn't available right now." };
    const cleared = await forgetPerson(admin, staff.orgId, who.email, who.name);
    const total = personTotal(cleared);
    await recordSecurityEvent(admin, { orgId: staff.orgId, kind: "person_removed", actorId: staff.id, detail: { total, ...cleared } });
    return { ok: true, total, message: total ? `Done: ${total} ${total === 1 ? "record" : "records"} cleared. Orders and their history are kept without the person's details.` : "Nothing to remove." };
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : "That couldn't be done. Try again." };
  }
}

export async function saveRetention(_prev: { ok: boolean; error?: string; message?: string } | null, formData: FormData): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const staff = await requireAdmin();
    const raw = String(formData.get("months") ?? "").trim();
    const months = raw === "" ? null : Number(raw);
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) return { ok: false, error: "Use a whole number of months from 1 to 120, or leave it blank to keep everything." };
    const enforce = formData.get("enforce") === "on" && months !== null;
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, error: "The database isn't connected." };
    await saveDataSettings(supabase, staff.orgId, staff.id, { retentionMonths: months, retentionEnforced: enforce });
    revalidatePath("/app/settings");
    return { ok: true, message: months === null ? "Saved: everything is kept." : enforce ? "Saved. Retention runs every night." : "Saved. Check the report, then switch it on." };
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : e instanceof Error && e.message === "not-allowed" ? "Only an admin can change this." : "That couldn't be saved. Try again." };
  }
}
