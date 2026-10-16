"use client";

import { useActionState, useState, useTransition } from "react";
import { replaceForwardingAddress, saveForwarding, type InboundResult } from "@/server/inbound-actions";
import type { ForwardingView } from "@/server/inbound-view";
import { startMicrosoftConsent } from "@/server/m365-actions";
import styles from "../shell.module.css";

const M365_OUTCOMES: Record<string, string> = {
  connected: "✓ Microsoft 365 consent granted. Finish by scoping COAST to the mailbox (step 3 below).",
  declined: "Consent wasn't granted in Microsoft 365.",
  "wrong-tenant": "That consent was for a different Microsoft 365 tenant from the one saved under Integrations.",
  expired: "That consent link expired. Start again.",
  "not-allowed": "Only the admin who started it can finish connecting Microsoft 365.",
  unavailable: "COAST couldn't save that just now. Try again.",
};

/** Settings → Supplier replies by email (readiness Task 3). */
export function ForwardingPanel({ view: v, m365Outcome }: { view: ForwardingView; m365Outcome: string | null }) {
  const [state, action, pending] = useActionState(saveForwarding, null as InboundResult | null);
  const [busy, startTransition] = useTransition();
  const [result, setResult] = useState<InboundResult | { ok: false; error: string } | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section aria-labelledby="fwd-title" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h3 id="fwd-title" style={{ fontSize: 14 }}>1. Forward supplier replies to COAST (the simple way)</h3>
        {!v.serviceReady && <p className="notice" style={{ margin: 0 }}>COAST&apos;s inbound email service isn&apos;t switched on yet (INBOUND_EMAIL_DOMAIN and MAILGUN_WEBHOOK_SIGNING_KEY in the hosting settings), so mail can&apos;t arrive yet.</p>}
        {v.address ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 14, padding: "6px 10px", background: "var(--surface-raised)", borderRadius: 8, wordBreak: "break-all" }}>{v.address}</code>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(v.address ?? "").then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className={styles.cardText} style={{ margin: 0 }}>No forwarding address yet{v.canEdit ? " — enter your mailbox's domain to make one." : "."}</p>
        )}
        <p className={styles.cardText} style={{ margin: 0 }}>
          Set your purchasing mailbox to forward supplier replies to this address. COAST matches each one to its PO by the PO number. Forwarded
          replies are always checked by a person before anything changes, because forwarding hides who really sent them. Mail that wasn&apos;t
          forwarded from your own domain is held back for you to look at.
        </p>
        {v.canEdit && (
          <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="field" style={{ maxWidth: 420 }}>
              <label htmlFor="fwd-domains">Your mailbox&apos;s domain(s)</label>
              <input id="fwd-domains" name="domains" className="input" defaultValue={v.allowedDomains.join(", ")} placeholder="yourcompany.co.uk" />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Only mail forwarded from these is accepted. Separate several with commas.</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : v.address ? "Save" : "Make my address"}</button>
              {v.address && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Make a new address? Mail to the current one will stop being accepted straight away.")) return;
                    startTransition(async () => setResult(await replaceForwardingAddress()));
                  }}
                >
                  New address
                </button>
              )}
              {state?.ok && <span className={styles.saveStatus} role="status">✓ {state.message}</span>}
              {state && !state.ok && <span className="notice notice-error" role="alert">{state.error}</span>}
              {result && (result.ok ? <span className={styles.saveStatus} role="status">✓ {result.message}</span> : <span className="notice notice-error" role="alert">{result.error}</span>)}
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="m365-title" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--divider)", paddingTop: 14 }}>
        <h3 id="m365-title" style={{ fontSize: 14 }}>2. Or connect your Microsoft 365 mailbox (optional)</h3>
        <p className={styles.cardText} style={{ margin: 0 }}>
          COAST reads the purchasing mailbox itself, so it can see whether each email really came from the supplier. Only then can a confirmed
          delivery date apply itself — and only from an address COAST knows for that supplier, once COAST has read their emails correctly a few
          times. Prices and quantities are always checked by a person, and the people on the order are told whenever a date moves, with a
          one-click undo.
        </p>
        {m365Outcome && M365_OUTCOMES[m365Outcome] && <p className={m365Outcome === "connected" ? styles.saveStatus : "notice"} role="status" style={{ margin: 0 }}>{M365_OUTCOMES[m365Outcome]}</p>}
        {!v.m365.appReady ? (
          <p className="notice" style={{ margin: 0 }}>COAST&apos;s Microsoft 365 app isn&apos;t set up yet (M365_CLIENT_ID and M365_CLIENT_SECRET in the hosting settings).</p>
        ) : !v.m365.connected ? (
          <p className={styles.cardText} style={{ margin: 0 }}>First save your tenant ID and mailbox under Integrations → Microsoft 365 mailbox.</p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14 }}>
              {v.m365.consented ? <span className="status status-ok">● Consent granted {v.m365.consented}</span> : <span className="status status-neutral">● Waiting for your Microsoft 365 admin to give consent</span>}
              {v.m365.mailbox ? ` · mailbox ${v.m365.mailbox}` : ""}
            </p>
            {v.canEdit && (
              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await startMicrosoftConsent();
                      if (r.ok) window.location.assign(r.url);
                      else setResult(r);
                    })
                  }
                >
                  {v.m365.consented ? "Give consent again" : "Give COAST access in Microsoft 365"}
                </button>
              </div>
            )}
            {v.m365.commands && (
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>3. Limit COAST to that one mailbox (for your IT admin)</summary>
                <p className={styles.cardText}>
                  Run these in Exchange Online PowerShell. They let COAST read and send only the purchasing mailbox — nothing else in your
                  organisation. Don&apos;t also grant COAST mail permissions for the whole organisation in Entra, or this limit has no effect.
                </p>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--surface-raised)", padding: 12, borderRadius: 8, overflowX: "auto" }}>{v.m365.commands}</pre>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
