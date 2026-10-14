"use client";

import { useActionState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/logic/security";
import { setNewPassword, type FormState } from "@/server/auth-actions";
import styles from "../../auth.module.css";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(setNewPassword, {});

  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.title}>Set your password</h1>
        <p className={styles.lede}>Use at least {MIN_PASSWORD_LENGTH} characters. A short phrase is easier to remember.</p>
      </div>
      <form action={action} className={styles.form}>
        {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className="input" />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Type it again</label>
          <input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className="input" />
        </div>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </button>
      </form>
    </>
  );
}
