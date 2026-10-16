import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Mailgun inbound routing (readiness plan Task 3, decision: Mailgun, EU
 * region). Mailgun posts each email to /api/inbound/mailgun, signed with the
 * account's webhook signing key: HMAC-SHA256 of timestamp + token.
 * UNVERIFIED: field names from Mailgun's "Receiving, forwarding and storing
 * messages" docs (forward() route action, parsed message); confirm against a
 * real message in staging.
 */

/** Constant-time check of Mailgun's signature. Never logs the key. */
export function verifyMailgunSignature(signingKey: string, timestamp: string, token: string, signature: string): boolean {
  if (!signingKey || !timestamp || !token || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface MailgunMessage {
  recipient: string;
  envelopeSender: string | null;
  from: string | null;
  subject: string;
  text: string;
  headers: [string, string][];
  messageId: string | null;
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

/** The parts of Mailgun's posted form COAST uses. Attachments are ignored. */
export function parseMailgunForm(f: FormData): MailgunMessage {
  let headers: [string, string][] = [];
  try {
    const parsed: unknown = JSON.parse(str(f, "message-headers") || "[]");
    if (Array.isArray(parsed)) headers = parsed.filter((h): h is [string, string] => Array.isArray(h) && typeof h[0] === "string" && typeof h[1] === "string").slice(0, 200);
  } catch {
    headers = [];
  }
  const header = (name: string) => headers.find(([n]) => n.toLowerCase() === name)?.[1] ?? null;
  return {
    recipient: str(f, "recipient").split(",")[0]!.trim(),
    envelopeSender: str(f, "sender") || null,
    from: str(f, "from") || header("from"),
    subject: str(f, "subject").slice(0, 1000),
    // The reply without the quoted history when Mailgun can tell; otherwise the whole text.
    text: (str(f, "body-plain") || str(f, "stripped-text")).slice(0, 50000),
    headers,
    messageId: str(f, "Message-Id") || header("message-id"),
  };
}
