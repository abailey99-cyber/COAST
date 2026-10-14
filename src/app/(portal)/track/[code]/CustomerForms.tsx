"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveCustomerUpdates, sendCustomerMessage, type PortalResult } from "@/server/portal-actions";
import styles from "../../portal.module.css";

export function MessageForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(sendCustomerMessage.bind(null, code), { ok: false } as PortalResult);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className={styles.form}>
      <label htmlFor="msg-body">Your message</label>
      <textarea id="msg-body" name="body" rows={3} required maxLength={4000} className="input" style={{ height: "auto", padding: 10 }} />
      <label htmlFor="msg-name">Your name (optional)</label>
      <input id="msg-name" name="name" maxLength={120} autoComplete="name" className="input" />
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Sending…" : "Send a message"}</button>
      {state.error && <p className={styles.helpError} role="alert">{state.error}</p>}
      {state.ok && <p className={styles.helpOk} role="status">{state.message}</p>}
    </form>
  );
}

export function UpdatesForm({
  code,
  emailHint,
  level,
  dailyDigest,
  levels,
}: {
  code: string;
  emailHint: string | null;
  level: string;
  dailyDigest: boolean;
  levels: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(saveCustomerUpdates.bind(null, code), { ok: false } as PortalResult);
  return (
    <form action={action} className={styles.form}>
      <p className={styles.quiet} style={{ margin: 0, fontSize: 14 }}>
        {emailHint ? `Updates go to ${emailHint}.` : "Add your email address to hear about this order without checking."} Problems and replies always come straight away.
      </p>
      <label htmlFor="upd-email" style={{ fontSize: 13 }}>{emailHint ? "Change the email address (leave blank to keep it)" : "Email address"}</label>
      <input id="upd-email" name="email" type="email" autoComplete="email" maxLength={254} className="input" />
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ fontSize: 13, marginBottom: 4 }}>How much would you like to hear?</legend>
        {levels.map((l) => (
          <label key={l.value} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="radio" name="level" value={l.value} defaultChecked={l.value === level} /> {l.label}
          </label>
        ))}
      </fieldset>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" name="digest" defaultChecked={dailyDigest} /> One summary email a day instead
      </label>
      <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save email updates"}</button>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      {state.ok && <p className={styles.ok} role="status">{state.message}</p>}
    </form>
  );
}
