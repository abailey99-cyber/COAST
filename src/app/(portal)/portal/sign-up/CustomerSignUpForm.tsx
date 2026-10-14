"use client";

import { useActionState } from "react";
import { signUpCustomer, type AccountResult } from "@/server/customer-account-actions";
import styles from "../../portal.module.css";

export function CustomerSignUpForm({ add }: { add: string }) {
  const [state, action, pending] = useActionState(signUpCustomer, { ok: false } as AccountResult);
  return (
    <form action={action} className={styles.form}>
      <label htmlFor="su-code">Tracking code of an order to add (optional)</label>
      <input id="su-code" name="code" defaultValue={add} placeholder="e.g. K7Q-4M2-XP9" autoComplete="off" className="input" />
      <label htmlFor="su-name">Your name</label>
      <input id="su-name" name="name" required maxLength={120} autoComplete="name" className="input" />
      <label htmlFor="su-email">Email</label>
      <input id="su-email" name="email" type="email" required autoComplete="email" className="input" />
      <label htmlFor="su-password">Choose a password</label>
      <input id="su-password" name="password" type="password" required minLength={12} autoComplete="new-password" className="input" />
      <span className={styles.quiet} style={{ fontSize: 13 }}>At least 12 characters.</span>
      <label htmlFor="su-confirm">Type it again</label>
      <input id="su-confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" className="input" />
      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      {state.ok && <p className={styles.ok} role="status">{state.message}</p>}
    </form>
  );
}
