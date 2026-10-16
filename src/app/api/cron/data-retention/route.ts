import { cronHandler } from "@/server/cron";
import { scheduledRetention } from "@/server/data-protection";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Once a day: clear customer contact details and message text on old closed orders, for organisations that switched it on (readiness Task 6). */
export const GET = cronHandler("data-retention", () => scheduledRetention());
