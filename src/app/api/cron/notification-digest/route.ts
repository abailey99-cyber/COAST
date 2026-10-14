import { cronHandler } from "@/server/cron";
import { scheduledDigest } from "@/server/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Once a day: one summary email for each customer who chose it (spec §5.5, decisions B12). */
export const GET = cronHandler("notification-digest", scheduledDigest);
