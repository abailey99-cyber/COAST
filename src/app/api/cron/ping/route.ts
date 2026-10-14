import { cronHandler } from "@/server/cron";

export const dynamic = "force-dynamic";

/** Lets you check the scheduler can reach COAST with the right secret. Does nothing else. */
export const GET = cronHandler("ping", async () => ({}));
