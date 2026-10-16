import { receiveMailgunWebhook } from "@/server/inbound-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Supplier replies forwarded to an organisation's COAST address arrive here from Mailgun (readiness Task 3). */
export const POST = (request: Request) => receiveMailgunWebhook(request);
