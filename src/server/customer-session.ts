import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getCustomerAccount, type CustomerAccount } from "@/lib/data/customer-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Who's signed in on the customer side. A customer login has a row in
 * customer_accounts and never one in staff_users (the database refuses
 * both). Customers can't read COAST's tables themselves (RLS gives them
 * nothing); their pages are built on the server, scoped to their account.
 */
export const getCustomerSession = cache(async (): Promise<CustomerAccount | null> => {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return null;
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  return getCustomerAccount(admin, userId);
});

export async function requireCustomer(): Promise<CustomerAccount> {
  const account = await getCustomerSession();
  if (!account) redirect("/portal/sign-in");
  return account;
}
