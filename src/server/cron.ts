import "server-only";
import { NextResponse } from "next/server";
import { finishCronRun, startCronRun } from "@/lib/data/cron";
import { isAuthorisedCronRequest } from "@/lib/logic/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "@/lib/data/customer-portal";
import { emailChannel } from "@/lib/email/channel";

export type CronOutcome = "ok" | "partial" | "error";

/**
 * Wraps a scheduled-job handler (decisions B12). Rejects any request that
 * doesn't carry `Authorization: Bearer ${CRON_SECRET}`, and records every
 * run and its outcome in cron_runs for the health screens. A job that fails
 * (or partly fails) alerts the founder, and a failed run answers 500 so the
 * scheduler marks it failed too — nothing breaks silently (readiness Task 5B).
 */
export function cronHandler(job: string, run: (request: Request) => Promise<{ outcome?: CronOutcome } & Record<string, unknown>>) {
  return async (request: Request) => {
    if (!isAuthorisedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
    const admin = createSupabaseAdminClient();
    const runId = admin ? await startCronRun(admin, job) : null;
    try {
      const { outcome = "ok", ...result } = await run(request);
      if (admin && runId !== null) await finishCronRun(admin, runId, outcome, result);
      if (outcome !== "ok") await alertJobProblem(job, outcome, JSON.stringify(result).slice(0, 1500));
      return NextResponse.json({ ok: outcome !== "error", job, outcome, ...result }, { status: outcome === "error" ? 500 : 200 });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      if (admin && runId !== null) await finishCronRun(admin, runId, "error", { message });
      console.error(`[cron:${job}] failed`, message);
      await alertJobProblem(job, "error", message);
      return NextResponse.json({ ok: false, job, outcome: "error" }, { status: 500 });
    }
  };
}

/** Tell the founder a scheduled job failed or partly failed — at most once an hour per job, so a broken job doesn't flood the inbox. */
export async function alertJobProblem(job: string, outcome: "partial" | "error", detail: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    if (admin && !(await hitRateLimit(admin, `job-alert:${job}:${outcome}`, 1, 3600))) return;
    console.error(`[cron:${job}] ${outcome === "error" ? "FAILED" : "partly failed"}: ${detail}`);
    const to = process.env.FOUNDER_ALERT_EMAIL?.trim();
    if (!to) return;
    await emailChannel().send({
      to,
      subject: `COAST: the ${job} job ${outcome === "error" ? "failed" : "partly failed"}`,
      text: `The scheduled ${job} job ${outcome === "error" ? "failed" : "partly failed"} (${process.env.COAST_ENV ?? "unknown environment"}).

${detail}

Runs are listed under Settings → Carrier connections and in the cron_runs table.`,
      html: `<p>The scheduled <strong>${job}</strong> job ${outcome === "error" ? "failed" : "partly failed"} (${process.env.COAST_ENV ?? "unknown environment"}).</p><pre>${detail.replace(/[<>&]/g, "")}</pre>`,
    });
  } catch (e) {
    console.error("[cron] couldn't send a job alert", e instanceof Error ? e.message : e);
  }
}
