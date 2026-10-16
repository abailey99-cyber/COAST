import "server-only";
import { createHash } from "node:crypto";
import { hitRateLimit } from "@/lib/data/customer-portal";
import { findAddress } from "@/lib/data/inbound";
import { parseMailgunForm, verifyMailgunSignature } from "@/lib/inbound/mailgun";
import { inboundLocalPart, webhookFresh } from "@/lib/logic/inbound-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { handleInboundEmail } from "./inbound";

/**
 * POST /api/inbound/mailgun (readiness Task 3, forwarding mode). Unsigned,
 * stale or replayed requests are refused; the organisation comes only from
 * the random address the mail was sent to. Answers: 200 handled (or
 * deliberately ignored), 401 bad signature, 406 "don't retry", 503 "retry
 * later" (Mailgun retries on 5xx).
 */
export async function receiveMailgunWebhook(request: Request, now: Date = new Date()): Promise<Response> {
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY?.trim();
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim();
  if (!key || !domain) return new Response("Inbound email isn't set up.", { status: 406 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request.", { status: 400 });
  }
  const timestamp = String(form.get("timestamp") ?? "");
  const token = String(form.get("token") ?? "");
  const signature = String(form.get("signature") ?? "");
  if (!verifyMailgunSignature(key, timestamp, token, signature) || !webhookFresh(timestamp, now)) return new Response("Not signed.", { status: 401 });

  const admin = createSupabaseAdminClient();
  if (!admin) return new Response("Try again later.", { status: 503 });
  // A signed request can be used once.
  if (!(await hitRateLimit(admin, `mailgun-token:${token.slice(0, 100)}`, 1, 3600))) return new Response("Already received.", { status: 200 });

  const msg = parseMailgunForm(form);
  const local = inboundLocalPart(msg.recipient, domain);
  const address = local ? await findAddress(admin, local) : null;
  // Unknown address: tell Mailgun not to retry, and reveal nothing.
  if (!address) return new Response("No such address.", { status: 406 });

  try {
    const outcome = await handleInboundEmail(admin, {
      orgId: address.orgId,
      channel: "forward",
      // No Message-Id: fall back to a fingerprint of the content, so a retry is still recognised.
      messageId: msg.messageId ?? `no-id:${createHash("sha256").update(`${msg.from}|${msg.subject}|${msg.text}`).digest("hex")}`,
      from: msg.from,
      envelopeSender: msg.envelopeSender,
      subject: msg.subject,
      text: msg.text,
      headers: msg.headers,
      allowedDomains: address.allowedDomains,
    }, now);
    return Response.json({ status: outcome.status });
  } catch (e) {
    console.warn("[inbound] couldn't handle a forwarded email", e instanceof Error ? e.message : e);
    return new Response("Try again later.", { status: 503 });
  }
}
