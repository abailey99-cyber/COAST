"use client";

import { useActionState, useState, useTransition } from "react";
import { clearDeliveryDate, setDeliveryDateByHand, setLeadTimeByHand, type PredictionResult } from "@/server/prediction-actions";
import ui from "../../ui.module.css";

/** Set the order's delivery date by hand, or hand it back to COAST. Sticky until handed back. */
export function DeliveryDateControl({ orderId, override }: { orderId: string; override: { from: string; to: string | null; note: string | null } | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setDeliveryDateByHand.bind(null, orderId), { ok: false } as PredictionResult);
  const [clearing, startClear] = useTransition();
  const [cleared, setCleared] = useState<PredictionResult | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {!open && (
          <button type="button" className={ui.linkButton} onClick={() => setOpen(true)}>
            {override ? "Change the date set by hand" : "Set the date by hand"}
          </button>
        )}
        {override && (
          <button
            type="button"
            className={ui.linkButton}
            disabled={clearing}
            onClick={() => startClear(async () => setCleared(await clearDeliveryDate(orderId)))}
          >
            Let COAST work it out again
          </button>
        )}
      </div>
      {open && (
        <form action={action} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className={ui.field}>
            <label htmlFor="dd-from" className={ui.label}>Delivery date</label>
            <input id="dd-from" name="from" type="date" defaultValue={override?.from ?? ""} required className={ui.input} />
          </div>
          <div className={ui.field}>
            <label htmlFor="dd-to" className={ui.label}>Latest (optional)</label>
            <input id="dd-to" name="to" type="date" defaultValue={override?.to ?? ""} className={ui.input} />
          </div>
          <div className={ui.field} style={{ flex: "1 1 200px" }}>
            <label htmlFor="dd-note" className={ui.label}>Why (optional)</label>
            <input id="dd-note" name="note" maxLength={300} defaultValue={override?.note ?? ""} className={ui.input} />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save date"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
        </form>
      )}
      {state.error && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{state.error}</p>}
      {state.ok && <p className={ui.muted} role="status" style={{ margin: 0 }}>{state.message}</p>}
      {cleared && (cleared.ok ? <p className={ui.muted} role="status" style={{ margin: 0 }}>{cleared.message}</p> : <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{cleared.error}</p>)}
    </div>
  );
}

/** A line's lead time, set by hand (blank = automatic). */
export function LeadTimeInput({ lineId, lineNo, manualDays }: { lineId: string; lineNo: number; manualDays: number | null }) {
  const [value, setValue] = useState(manualDays === null ? "" : String(manualDays));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PredictionResult | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        startTransition(async () => setResult(await setLeadTimeByHand(lineId, value)));
      }}
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}
    >
      <label htmlFor={`lt-${lineId}`} className="visually-hidden">Lead time for line {lineNo}, in working days (blank for automatic)</label>
      <input id={`lt-${lineId}`} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Auto" className={ui.input} style={{ width: 64, height: 32 }} />
      <button type="submit" className={ui.linkButton} disabled={pending}>{pending ? "Saving…" : "Set days"}</button>
      {result && (result.ok ? <span className={ui.muted} role="status">✓ Saved</span> : <span className={ui.fieldError} role="alert">{result.error}</span>)}
    </form>
  );
}
