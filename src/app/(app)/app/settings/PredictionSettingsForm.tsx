"use client";

import { startTransition, useActionState } from "react";
import type { PredictionSettings } from "@/lib/logic/prediction";
import { savePredictionSettings, type PredictionResult } from "@/server/prediction-actions";
import styles from "../shell.module.css";

/** The days COAST adds when it works out a delivery date (spec §5.8 "delivery-date prediction defaults"). */
export function PredictionSettingsForm({ values, editable }: { values: PredictionSettings; editable: boolean }) {
  const [state, action, pending] = useActionState<PredictionResult, FormData>(savePredictionSettings, { ok: true });
  const field = (name: keyof PredictionSettings, label: string, hint: string) => (
    <div className="field" style={{ minWidth: 0 }}>
      <label htmlFor={`ps-${name}`}>{label}</label>
      <input id={`ps-${name}`} name={name} type="number" min={0} max={30} defaultValue={values[name]} className="input" disabled={!editable} />
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{hint}</span>
    </div>
  );

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
        {field("handlingDays", "Warehouse turnaround", "Working days from goods arriving to leaving again")}
        {field("deliveryDays", "Your own delivery", "Working days from leaving you to reaching the customer")}
        {field("spreadDays", "Estimate width", "Working days between the earliest and latest date of an estimate")}
      </div>
      {editable && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save delivery-date settings"}</button>
          {state.ok && state.message && <span className={styles.saveStatus} role="status">✓ {state.message}</span>}
          {!state.ok && <span className="notice notice-error" role="alert">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
