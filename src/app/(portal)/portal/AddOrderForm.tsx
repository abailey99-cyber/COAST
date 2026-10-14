"use client";

import { useActionState, useEffect, useRef } from "react";
import { addOrderByCode, type AccountResult } from "@/server/customer-account-actions";
import styles from "../portal.module.css";

export function AddOrderForm() {
  const [state, action, pending] = useActionState(addOrderByCode, { ok: false } as AccountResult);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className={styles.form}>
      <label htmlFor="add-code">Tracking code</label>
      <input id="add-code" name="code" required placeholder="e.g. K7Q-4M2-XP9" autoComplete="off" className="input" />
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Adding…" : "Add order"}</button>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      {state.ok && <p className={styles.ok} role="status">{state.message}</p>}
    </form>
  );
}
