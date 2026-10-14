import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The scheduled-job log (decisions B12): every run and its outcome. Reads and writes only. */

export async function startCronRun(admin: SupabaseClient, job: string): Promise<number | null> {
  const { data, error } = await admin.from("cron_runs").insert({ job }).select("id").single<{ id: number }>();
  if (error) return null;
  return data.id;
}

export async function finishCronRun(admin: SupabaseClient, id: number, outcome: "ok" | "partial" | "error", detail: Record<string, unknown>): Promise<void> {
  await admin.from("cron_runs").update({ finished_at: new Date().toISOString(), outcome, detail }).eq("id", id);
}

export interface CronRun {
  startedAt: string;
  finishedAt: string | null;
  outcome: "ok" | "partial" | "error" | null;
}

export async function lastCronRun(client: SupabaseClient, job: string): Promise<CronRun | null> {
  const { data, error } = await client
    .from("cron_runs")
    .select("started_at, finished_at, outcome")
    .eq("job", job)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ started_at: string; finished_at: string | null; outcome: CronRun["outcome"] }>();
  if (error || !data) return null;
  return { startedAt: data.started_at, finishedAt: data.finished_at, outcome: data.outcome };
}
