import { cronHandler } from "@/server/cron";
import { scheduledMailboxRead } from "@/server/m365";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 15 minutes: read each organisation's connected Microsoft 365 mailbox (readiness Task 3). */
export const GET = cronHandler("inbound-mailbox", () => scheduledMailboxRead());
