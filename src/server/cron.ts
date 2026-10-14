import "server-only";
import { NextResponse } from "next/server";
import { finishCronRun, startCronRun } from "@/lib/data/cron";
import { isAuthorisedCronRequest } from "@/lib/logic/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CronOutcome = "ok" | "partial" | "error";

/**
 * Wraps a scheduled-job handler (decisions B12). Rejects any request that
 * doesn't carry `Authorization: Bearer ${CRON_SECRET}`, and records every
 * run and its outcome in cron_runs for the health screens.
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
      return NextResponse.json({ ok: true, job, outcome, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      if (admin && runId !== null) await finishCronRun(admin, runId, "error", { message });
      console.error(`[cron:${job}] failed`, message);
      return NextResponse.json({ ok: false, job, outcome: "error" }, { status: 500 });
    }
  };
}
