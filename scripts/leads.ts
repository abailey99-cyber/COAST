/**
 * Lists "Get COAST for your business" sign-ups (newest first), with where
 * they came from. `npm run leads` prints a table; `npm run leads -- --csv`
 * prints CSV to save. Uses the service-role key from .env.local.
 */
import { adminClient, fail } from "./lib/admin";

async function main() {
  const admin = adminClient();
  const { data, error } = await admin
    .from("leads")
    .select("created_at, name, company, email, phone, company_size, source, message, organisations(name)")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) fail(`Couldn't read leads: ${error.message}`);
  const rows = (data ?? []).map((l) => {
    const r = l as unknown as { created_at: string; name: string; company: string; email: string; phone: string | null; company_size: string | null; source: string; message: string | null; organisations: { name: string } | null };
    return {
      when: r.created_at.slice(0, 16).replace("T", " "),
      name: r.name,
      company: r.company,
      email: r.email,
      phone: r.phone ?? "",
      size: r.company_size ?? "",
      came_from: r.source === "tracking_page" ? `tracking page${r.organisations ? ` (${r.organisations.name})` : ""}` : r.source === "customer_portal" ? "customer portal" : "website",
      message: r.message ?? "",
    };
  });
  if (process.argv.includes("--csv")) {
    const cols = Object.keys(rows[0] ?? { when: "" });
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    console.log(cols.join(","));
    for (const r of rows) console.log(cols.map((c) => q(String((r as Record<string, string>)[c]))).join(","));
  } else if (rows.length === 0) console.log("No leads yet.");
  else console.table(rows);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
