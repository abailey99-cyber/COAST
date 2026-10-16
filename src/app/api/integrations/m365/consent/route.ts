import { completeMicrosoftConsent } from "@/server/m365";

export const dynamic = "force-dynamic";

/** Microsoft sends an organisation's admin back here after granting consent (readiness Task 3). */
export const GET = (request: Request) => completeMicrosoftConsent(request);
