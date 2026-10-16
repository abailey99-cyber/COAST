"use client";

import { useActionState, useState, useTransition } from "react";
import { attachEmailToPo, dismissEmail, type InboundResult } from "@/server/inbound-actions";
import type { EmailToSort } from "@/server/inbound-view";
import ui from "../ui.module.css";

/** Emails COAST couldn't match to one PO, or held back: a person attaches them to the right PO, or dismisses them. */
export function EmailsToSort({ items }: { items: EmailToSort[] }) {
  return (
    <section className={ui.panel} aria-labelledby="emails-title">
      <h2 id="emails-title" style={{ fontSize: 16 }}>Emails to sort out · {items.length}</h2>
      <p className={ui.muted} style={{ margin: 0 }}>
        Supplier emails COAST couldn&apos;t match to exactly one of your POs, or held back because they didn&apos;t come through your own mailbox.
        Attach one to the right PO and COAST reads it — a person still checks anything forwarded.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((i) => (
          <Email key={i.id} item={i} />
        ))}
      </ul>
    </section>
  );
}

function Email({ item: i }: { item: EmailToSort }) {
  const [state, action, pending] = useActionState(attachEmailToPo.bind(null, i.id), null as InboundResult | null);
  const [dismissing, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<InboundResult | null>(null);
  const done = state?.ok ? state : dismissed?.ok ? dismissed : null;
  return (
    <li style={{ border: "1px solid var(--divider)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className={ui.strong}>{i.subject}</div>
      <div className={ui.muted}>
        {i.from} · {i.channel} · {i.when}
      </div>
      <div>
        <span className={`status ${i.status === "quarantined" ? "status-warn" : "status-neutral"}`}>● {i.status === "quarantined" ? "Held back" : "Not matched"}</span>
        <span className={ui.muted}> · {i.reason}</span>
      </div>
      {i.excerpt && <p style={{ margin: 0, fontSize: 13 }}>{i.excerpt}</p>}
      {done ? (
        <p className="status status-ok" role="status" style={{ margin: 0 }}>● {done.message}</p>
      ) : (
        <form action={action} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor={`po-${i.id}`} className="visually-hidden">PO number</label>
          <input id={`po-${i.id}`} name="poNumber" className={ui.input} placeholder="PO number, e.g. PO-5017" style={{ maxWidth: 220 }} required />
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Reading…" : "Attach to PO"}</button>
          <button type="button" className="btn btn-secondary" disabled={dismissing} onClick={() => startTransition(async () => setDismissed(await dismissEmail(i.id)))}>
            Dismiss
          </button>
          {state && !state.ok && <span className={ui.fieldError} role="alert">{state.error}</span>}
          {dismissed && !dismissed.ok && <span className={ui.fieldError} role="alert">{dismissed.error}</span>}
        </form>
      )}
    </li>
  );
}
