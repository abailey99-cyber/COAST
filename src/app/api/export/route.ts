import { exportOrganisation } from "@/server/data-protection";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** An admin downloads all of their organisation's data (readiness Task 6). */
export const GET = () => exportOrganisation();
