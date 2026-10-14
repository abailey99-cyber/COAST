"use client";

import { startTransition, useActionState } from "react";
import { saveCustomerPageSettings, type CustomerResult } from "@/server/customer-actions";
import type { CustomerPageSettings } from "@/server/settings";
import styles from "../shell.module.css";

/** Settings → Customer page: the name customers see, the word for a supplier, carrier display, update limits. */
export function CustomerPageForm({ values, orgName, editable }: { values: CustomerPageSettings; orgName: string; editable: boolean }) {
  const [state, action, pending] = useActionState<CustomerResult, FormData>(saveCustomerPageSettings, { ok: true });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div className={styles.grid}>
        <div className="field">
          <label htmlFor="cp-name">Name customers see</label>
          <input id="cp-name" name="displayName" maxLength={120} defaultValue={values.displayName ?? ""} placeholder={orgName} className="input" disabled={!editable} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Blank uses your company name</span>
        </div>
        <div className="field">
          <label htmlFor="cp-logo">Logo web address</label>
          <input id="cp-logo" name="logoUrl" type="url" defaultValue={values.logoUrl ?? ""} placeholder="https://…" className="input" disabled={!editable} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>A square image, shown top-left on the customer page</span>
        </div>
        <div className="field">
          <label htmlFor="cp-word">Word for a supplier</label>
          <input id="cp-word" name="supplierWord" maxLength={24} defaultValue={values.supplierWord} className="input" disabled={!editable} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Shown as “{values.supplierWord.toUpperCase()} UPDATE”</span>
        </div>
        <div className="field">
          <label htmlFor="cp-gap">Hours between routine updates</label>
          <input id="cp-gap" name="minGapHours" type="number" min={0} max={72} defaultValue={values.minGapHours} className="input" disabled={!editable} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Problems and replies always go at once</span>
        </div>
        <div className="field">
          <label htmlFor="cp-shift">Tell customers when the date moves by</label>
          <input id="cp-shift" name="dateShiftDays" type="number" min={0} max={30} defaultValue={values.dateShiftDays} className="input" disabled={!editable} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Days — or whenever it crosses the promised date</span>
        </div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" name="showDirectCarrier" defaultChecked={values.showDirectCarrier} disabled={!editable} />
        Show the carrier and tracking number for orders shipped straight from a supplier
      </label>
      <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8 }}>
        Off by default: a carrier&apos;s own tracking page can show where a parcel started, which can give away who your supplier is.
      </span>
      {editable && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save customer page settings"}</button>
          {state.ok && state.message && <span className={styles.saveStatus} role="status">✓ {state.message}</span>}
          {!state.ok && <span className="notice notice-error" role="alert">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
