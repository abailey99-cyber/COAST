"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type FormState } from "@/server/auth-actions";
import styles from "../../auth.module.css";

export function ForgottenForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordReset, {});

  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.lede}>We&apos;ll email you a link to set a new one.</p>
      </div>
      <form action={action} className={styles.form}>
        {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
        {state.message && <p className="notice" role="status">{state.message}</p>}
        <div className="field">
          <label htmlFor="reset-email">Work email</label>
          <input id="reset-email" name="email" type="email" autoComplete="username" required placeholder="you@company.co.uk" className="input" />
        </div>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={pending}>
          {pending ? "Sending…" : "Email me a link"}
        </button>
      </form>
      <p className={styles.foot}>
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </>
  );
}
