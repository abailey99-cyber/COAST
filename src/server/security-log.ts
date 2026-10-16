import "server-only";
import { listSecurityEvents } from "@/lib/data/credentials";
import { listStaffInOrg } from "@/lib/data/staff";
import { formatDateTime } from "@/lib/logic/format";
import { describeSecurityEvent } from "@/lib/logic/security-events";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffContext } from "./session";

/** Settings → Security log: an organisation's admins see its security events (readiness Task 5B). RLS also limits it to admins. */
export async function loadSecurityLog(staff: StaffContext): Promise<{ id: number; when: string; who: string; text: string; attention: boolean }[] | null> {
  if (staff.role !== "admin") return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const [events, team] = await Promise.all([listSecurityEvents(supabase, 100), listStaffInOrg(supabase)]);
  const names = new Map(team.map((t) => [t.id, t.fullName]));
  return events.map((e) => {
    const d = describeSecurityEvent(e.kind, e.detail, names);
    return { id: e.id, when: formatDateTime(new Date(e.createdAt)), who: e.actorId ? (names.get(e.actorId) ?? "Someone") : "COAST", text: d.text, attention: d.attention };
  });
}
