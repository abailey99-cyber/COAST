"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { markMessagesRead, newTrackingCode, replyToCustomer, saveOrderUpdates, type CustomerResult } from "@/server/customer-actions";
import type { OrderCustomerPanel } from "@/server/customer-staff";
import { inviteCustomer, stopLinkingAccount, type AccountResult } from "@/server/customer-account-actions";
import ui from "../../ui.module.css";

/** The tracking link, with Copy and "Make a new code". */
export function TrackingLink({ orderId, panel }: { orderId: string; panel: OrderCustomerPanel }) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CustomerResult | null>(null);
  return (
    <>
      <code>{panel.trackingCode}</code>{" "}
      <a href={panel.trackingLink} target="_blank" rel="noopener noreferrer">Customer page</a>{" · "}
      <button
        type="button"
        className={ui.linkButton}
        onClick={async () => {
          await navigator.clipboard?.writeText(panel.trackingLink).catch(() => undefined);
          setCopied(true);
        }}
      >
        {copied ? "Link copied" : "Copy customer tracking link"}
      </button>
      {panel.canManage && (
        <>
          {" · "}
          <button
            type="button"
            className={ui.linkButton}
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Make a new tracking code? The current code and any link with it will stop working.")) return;
              startTransition(async () => setResult(await newTrackingCode(orderId)));
            }}
          >
            Make a new code
          </button>
        </>
      )}
      {result && <div className={result.ok ? ui.muted : ui.fieldError} role={result.ok ? "status" : "alert"}>{result.ok ? result.message : result.error}</div>}
    </>
  );
}

/** Conversation, update settings, what's been sent, and a preview of the customer's page. */
export function OrderCustomer({ orderId, panel }: { orderId: string; panel: OrderCustomerPanel }) {
  const [reply, replyAction, replying] = useActionState(replyToCustomer.bind(null, orderId), { ok: false } as CustomerResult);
  const [prefs, prefsAction, savingPrefs] = useActionState(saveOrderUpdates.bind(null, orderId), { ok: false } as CustomerResult);
  const [marking, startMark] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (reply.ok) form.current?.reset();
  }, [reply]);

  return (
    <section className={ui.panel} aria-labelledby="customer-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2 id="customer-title" style={{ fontSize: 16 }}>Customer</h2>
        {panel.unread > 0 && <span className="status status-warn">● {panel.unread} new {panel.unread === 1 ? "message" : "messages"}</span>}
      </div>

      {panel.preview && (
        <div style={{ fontSize: 13 }}>
          {"blocked" in panel.preview ? (
            <p className={ui.fieldError} style={{ margin: 0 }}>{panel.preview.blocked}</p>
          ) : (
            <p className={ui.muted} style={{ margin: 0 }}>
              <strong>Customer view shows:</strong> “{panel.preview.latest}” · {panel.preview.status}
            </p>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className={ui.strong} style={{ fontSize: 14 }}>Messages</div>
        {panel.messages.length === 0 ? (
          <p className={ui.muted} style={{ margin: 0 }}>No messages yet. Customers can write from their tracking page.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }} aria-label="Messages with the customer">
            {panel.messages.map((m) => (
              <li key={m.id} style={{ fontSize: 13 }}>
                <div className={ui.muted}>
                  {m.who} · {m.when}
                  {m.unread ? " · new" : ""}
                </div>
                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</div>
              </li>
            ))}
          </ul>
        )}
        {panel.canManage && panel.unread > 0 && (
          <div>
            <button type="button" className={ui.linkButton} disabled={marking} onClick={() => startMark(async () => void (await markMessagesRead(orderId)))}>
              Mark as read
            </button>
          </div>
        )}
        {panel.canManage && (
          <form ref={form} action={replyAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="reply-body" className="visually-hidden">Reply to the customer</label>
            <textarea id="reply-body" name="body" rows={3} maxLength={4000} placeholder="Reply to the customer" className={ui.input} style={{ height: "auto", padding: 10 }} />
            <span className={ui.hint}>Replies are checked first: anything naming a supplier or a PO number won&apos;t be sent.</span>
            <div className={ui.actions}>
              <button type="submit" className="btn btn-secondary" disabled={replying}>{replying ? "Sending…" : "Send reply"}</button>
            </div>
            {reply.error && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{reply.error}</p>}
            {reply.ok && <p className={ui.muted} role="status" style={{ margin: 0 }}>{reply.message}</p>}
          </form>
        )}
      </div>

      <details style={{ borderTop: "1px solid var(--divider)", paddingTop: 10 }}>
        <summary className={ui.strong} style={{ fontSize: 14, cursor: "pointer" }}>
          Email updates · {panel.prefs.email ? panel.prefs.email : "no address yet"}
        </summary>
        {panel.canManage ? (
          <form action={prefsAction} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <label htmlFor="upd-email" className={ui.label}>Customer email</label>
            <input id="upd-email" name="email" type="email" defaultValue={panel.prefs.email ?? ""} className={ui.input} />
            <label htmlFor="upd-level" className={ui.label}>How much they hear</label>
            <select id="upd-level" name="level" defaultValue={panel.prefs.level} className={ui.input}>
              {panel.levels.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" name="digest" defaultChecked={panel.prefs.dailyDigest} /> One summary email a day
            </label>
            <div className={ui.actions}>
              <button type="submit" className="btn btn-secondary" disabled={savingPrefs}>{savingPrefs ? "Saving…" : "Save"}</button>
            </div>
            {prefs.error && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{prefs.error}</p>}
            {prefs.ok && <p className={ui.muted} role="status" style={{ margin: 0 }}>✓ {prefs.message}</p>}
          </form>
        ) : (
          <p className={ui.muted}>{panel.levels.find((l) => l.value === panel.prefs.level)?.label}</p>
        )}
      </details>

      {(panel.linkedAccounts.length > 0 || panel.canManage) && (
        <details style={{ borderTop: "1px solid var(--divider)", paddingTop: 10 }}>
          <summary className={ui.strong} style={{ fontSize: 14, cursor: "pointer" }}>COAST accounts · {panel.linkedAccounts.length}</summary>
          <p className={ui.muted} style={{ margin: "8px 0", fontSize: 13 }}>
            People you've vouched for at this customer. Their free COAST account shows all your orders for this customer
            automatically, alongside deliveries from other businesses that use COAST.
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            {panel.linkedAccounts.map((a) => (
              <li key={a.userId}>
                {a.name} <span className={ui.muted}>· {a.email} · since {a.since}</span>{" "}
                {panel.canManage && <StopLink orderId={orderId} userId={a.userId} name={a.name} />}
              </li>
            ))}
          </ul>
          {panel.canManage && <InviteForm orderId={orderId} />}
        </details>
      )}

      <details style={{ borderTop: "1px solid var(--divider)", paddingTop: 10 }}>
        <summary className={ui.strong} style={{ fontSize: 14, cursor: "pointer" }}>What the customer was told · {panel.notifications.length}</summary>
        {panel.notifications.length === 0 ? (
          <p className={ui.muted}>Nothing yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {panel.notifications.map((n) => (
              <li key={n.id} style={{ fontSize: 13 }}>
                <div>{n.summary}</div>
                <div className={ui.muted}>
                  {n.when} · {n.status}
                  {n.to ? ` · to ${n.to}` : ""}
                  {n.reason ? ` · ${n.reason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

/** Invite someone to a customer account; the set-password link is shown once. */
function InviteForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(inviteCustomer.bind(null, orderId), { ok: false } as AccountResult);
  return (
    <div style={{ marginTop: 10 }}>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className={ui.strong} style={{ fontSize: 14 }}>Invite someone</div>
        <p className={ui.muted} style={{ margin: 0, fontSize: 13 }}>Your orders for this customer — this one, the last year's and every new one — will appear in their COAST account automatically.</p>
        <label htmlFor="inv-name" className={ui.label}>Their name</label>
        <input id="inv-name" name="name" maxLength={120} className={ui.input} />
        <label htmlFor="inv-email" className={ui.label}>Their email</label>
        <input id="inv-email" name="email" type="email" className={ui.input} />
        <div className={ui.actions}>
          <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Inviting…" : "Invite"}</button>
        </div>
        {state.error && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{state.error}</p>}
        {state.ok && (
          <div role="status" style={{ fontSize: 13 }}>
            <p className={ui.muted} style={{ margin: 0 }}>{state.message}</p>
            {state.link && <code style={{ overflowWrap: "anywhere", display: "block", marginTop: 4 }}>{state.link}</code>}
          </div>
        )}
      </form>
    </div>
  );
}

/** Stop adding this customer's orders to someone's account automatically. */
function StopLink({ orderId, userId, name }: { orderId: string; userId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  if (done) return <span className={ui.muted}>{done}</span>;
  return (
    <button
      type="button"
      className={ui.linkButton}
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Stop adding this customer's new orders to ${name}'s COAST account? Orders already there stay.`)) return;
        startTransition(async () => {
          const r = await stopLinkingAccount(orderId, userId);
          setDone(r.ok ? "Stopped." : (r.error ?? "That didn't work."));
        });
      }}
    >
      Stop
    </button>
  );
}
