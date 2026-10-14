import "server-only";
import { NextResponse } from "next/server";
import { isAuthorisedCronRequest } from "@/lib/logic/security";

/**
 * Wraps a scheduled-job handler (decisions B12). Rejects any request that
 * doesn't carry `Authorization: Bearer ${CRON_SECRET}`. Recording each run
 * for the health screens arrives with the first real job (Phase 2/3).
 */
export function cronHandler(job: (request: Request) => Promise<Record<string, unknown>>) {
  return async (request: Request) => {
    if (!isAuthorisedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
    const result = await job(request);
    return NextResponse.json({ ok: true, ...result });
  };
}
