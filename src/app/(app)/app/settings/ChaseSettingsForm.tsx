"use client";

import { startTransition, useActionState } from "react";
import { saveChaseSettings, type LoopResult } from "@/server/supplier-actions";
import styles from "../shell.module.css";

interface Values {
  amberHours: number;
  redHours: number;
  alertHours: number;
  dayStartHour: number;
  dayEndHour: number;
}

/** When something waiting on someone turns amber, red and "needs attention" (decisions B14). */
export function ChaseSettingsForm({ values, editable }: { values: Values; editable: boolean }) {
  const [state, action, pending] = useActionState<LoopResult, FormData>(saveChaseSettings, { ok: true });
  const field = (name: keyof Values, label: string, hint: string) => (
    <div className="field" style={{ minWidth: 0 }}>
      <label htmlFor={`cs-${name}`}>{label}</label>
      <input id={`cs-${name}`} name={name} type="number" min={0} max={2000} defaultValue={values[name]} className="input" disabled={!editable} />
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
        {field("amberHours", "Overdue (amber) after", "Working hours")}
        {field("redHours", "Very overdue (red) after", "Working hours")}
        {field("alertHours", "Needs attention after", "Working hours")}
        {field("dayStartHour", "Working day starts", "Hour, 0–23 (UK time)")}
        {field("dayEndHour", "Working day ends", "Hour, 1–24 (UK time)")}
      </div>
      {editable && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save chasing settings"}</button>
          {state.ok && state.message && <span className={styles.saveStatus} role="status">✓ {state.message}</span>}
          {!state.ok && <span className="notice notice-error" role="alert">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
