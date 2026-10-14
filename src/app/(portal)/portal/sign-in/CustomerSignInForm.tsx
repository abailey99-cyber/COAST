"use client";

import { useActionState } from "react";
import { signInCustomer, type AccountResult } from "@/server/customer-account-actions";
import styles from "../../portal.module.css";

export function CustomerSignInForm() {
  const [state, action, pending] = useActionState(signInCustomer, { ok: false } as AccountResult);
  return (
    <form action={action} className={styles.form}>
      <label htmlFor="cs-email">Email</label>
      <input id="cs-email" name="email" type="email" autoComplete="email" required className="input" />
      <label htmlFor="cs-password">Password</label>
      <input id="cs-password" name="password" type="password" autoComplete="current-password" required className="input" />
      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
    </form>
  );
}
