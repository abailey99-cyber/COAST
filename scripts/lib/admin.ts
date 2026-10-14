/**
 * Shared helpers for admin scripts. These run on your computer (via
 * `npm run …`), use the Supabase service-role key and bypass RLS — so they
 * live outside src/ and are never bundled into the app.
 */

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function coastEnv(): "development" | "staging" | "production" {
  const value = (process.env.COAST_ENV ?? "development").trim();
  if (value === "development" || value === "staging" || value === "production") return value;
  fail(`COAST_ENV must be development, staging or production (got "${value}").`);
}

export async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const target = email.toLowerCase();
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Couldn't list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function ensureOrganisation(admin: SupabaseClient, name: string, slug: string): Promise<string> {
  const existing = await admin.from("organisations").select("id").eq("slug", slug).maybeSingle<{ id: string }>();
  if (existing.error) fail(`Couldn't read organisations: ${existing.error.message}. Have you run the migrations (npm run db:push)?`);
  if (existing.data) return existing.data.id;
  const created = await admin.from("organisations").insert({ name, slug }).select("id").single<{ id: string }>();
  if (created.error) fail(`Couldn't create organisation "${name}": ${created.error.message}`);
  return created.data.id;
}

export interface StaffSpec {
  email: string;
  fullName: string;
  role: "admin" | "procurement" | "sales" | "director" | "goods_in";
  orgId: string;
  password?: string;
}

/** Creates (or updates) an auth user and their staff row. Never sends an email. */
export async function ensureStaffUser(admin: SupabaseClient, spec: StaffSpec): Promise<string> {
  let user = await findUserByEmail(admin, spec.email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.email,
      email_confirm: true,
      ...(spec.password ? { password: spec.password } : {}),
      user_metadata: { full_name: spec.fullName },
    });
    if (error || !data.user) fail(`Couldn't create user ${spec.email}: ${error?.message}`);
    user = data.user;
  } else if (spec.password) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: spec.password });
    if (error) fail(`Couldn't update password for ${spec.email}: ${error.message}`);
  }

  const { error } = await admin.from("staff_users").upsert(
    { id: user.id, org_id: spec.orgId, role: spec.role, full_name: spec.fullName, email: spec.email, is_active: true },
    { onConflict: "id" },
  );
  if (error) fail(`Couldn't save staff record for ${spec.email}: ${error.message}`);
  return user.id;
}
