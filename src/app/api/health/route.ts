import { NextResponse } from "next/server";
import { supabasePublicConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Uptime check. Reports configuration only — never values. */
export function GET() {
  return NextResponse.json({
    app: "ok",
    database: supabasePublicConfig() ? "configured" : "unconfigured",
  });
}
