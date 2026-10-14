"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { CURRENCIES } from "@/lib/logic/format";
import { createSupplierAction, type ActionState } from "@/server/order-actions";
import ui from "../ui.module.css";

export function AddSupplierForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSupplierAction, {});
  const form = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};

  // Clear the form only once a supplier has actually been added.
  useEffect(() => {
    if (state.message) form.current?.reset();
  }, [state]);

  return (
    <form
      ref={form}
      className={ui.fieldset}
      aria-labelledby="add-supplier-title"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <h2 id="add-supplier-title" style={{ fontSize: 16 }}>Add a supplier</h2>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      {state.message && <p className="notice" role="status">{state.message}</p>}
      <div className={ui.grid2}>
        <div className={ui.field}>
          <label htmlFor="s-name" className={ui.label}>Name</label>
          <input id="s-name" name="name" className={ui.input} aria-invalid={e.name ? true : undefined} autoComplete="off" />
          {e.name && <span className={ui.fieldError}>{e.name}</span>}
        </div>
        <div className={ui.field}>
          <label htmlFor="s-email" className={ui.label}>Email for purchase orders (optional)</label>
          <input id="s-email" name="email" type="email" className={ui.input} aria-invalid={e.email ? true : undefined} autoComplete="off" />
          {e.email && <span className={ui.fieldError}>{e.email}</span>}
        </div>
        <div className={ui.field}>
          <label htmlFor="s-phone" className={ui.label}>Phone (optional)</label>
          <input id="s-phone" name="phone" type="tel" className={ui.input} autoComplete="off" />
        </div>
        <div className={ui.field}>
          <label htmlFor="s-currency" className={ui.label}>Usual currency</label>
          <select id="s-currency" name="currency" className={ui.input} defaultValue="GBP">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className={ui.field}>
          <label htmlFor="s-lead" className={ui.label}>Typical lead time in working days (optional)</label>
          <input id="s-lead" name="leadTimeDays" inputMode="numeric" className={ui.input} aria-invalid={e.leadTimeDays ? true : undefined} />
          {e.leadTimeDays && <span className={ui.fieldError}>{e.leadTimeDays}</span>}
        </div>
      </div>
      <div className={ui.actions}>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Add supplier"}</button>
      </div>
    </form>
  );
}
