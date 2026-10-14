import { cronHandler } from "@/server/cron";
import { scheduledTrackingPoll } from "@/server/tracking-poll";

export const dynamic = "force-dynamic";
// DHL allows one call every 5 seconds, so a run takes up to ~50 s.
export const maxDuration = 60;

/** Every 30 minutes: checks due shipments with every configured carrier (decisions B12). */
export const GET = cronHandler("tracking-poll", scheduledTrackingPoll);
