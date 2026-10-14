import "server-only";
import { configHealth, type Health } from "@/lib/logic/health";
import type { EmailMessage } from "@/lib/logic/po-email";

/**
 * Outbound email goes through one channel interface (spec §6, §9.3), so
 * Microsoft 365 (Phase 8) or another provider — or SMS later — plugs in
 * without touching callers. Until a real channel is configured, emails are
 * written and logged but not delivered (CLAUDE.md Phase 2 note).
 */

export interface SendResult {
  status: "logged" | "sent" | "failed";
  error?: string;
}

export interface EmailChannel {
  name: "log" | "m365";
  health(): Health;
  send(message: EmailMessage): Promise<SendResult>;
}

/** Writes nothing anywhere except COAST's own email log (the caller records it). */
const logChannel: EmailChannel = {
  name: "log",
  health: () => ({ status: "warn", reason: "Emails are written and logged, but not sent until Microsoft 365 is connected." }),
  send: async () => ({ status: "logged" }),
};

const M365_VARS = ["M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET", "M365_MAILBOX"];

/** UNVERIFIED: Microsoft Graph sending arrives in Phase 8 (docs/integrations/microsoft365.md). */
const m365Channel: EmailChannel = {
  name: "m365",
  health: () => {
    const h = configHealth("Microsoft 365 mailbox", M365_VARS, process.env);
    return h.status === "ok" ? { status: "warn", reason: "Credentials are set, but sending through Microsoft 365 isn't built yet (Phase 8)." } : h;
  },
  send: async () => ({ status: "failed", error: "Microsoft 365 sending isn't built yet." }),
};

/** The channel to use right now. Falls back to logging, never crashes. */
export function emailChannel(): EmailChannel {
  // Until the Microsoft 365 channel is built and verified (Phase 8), always log.
  void m365Channel;
  return logChannel;
}

export function emailChannelHealth(): Health {
  return emailChannel().health();
}
