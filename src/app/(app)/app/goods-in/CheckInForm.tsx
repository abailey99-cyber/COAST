"use client";

import { useState, useTransition } from "react";
import { checkIn, type GoodsInResult } from "@/server/goods-in-actions";
import ui from "../ui.module.css";

/** One line's check-in: big, simple controls for the warehouse floor (works on a tablet or phone). */
export function CheckInForm({
  lineId,
  outstanding,
  conditions,
  shipments,
  onDone,
}: {
  lineId: string;
  outstanding: number;
  conditions: { value: string; label: string }[];
  shipments: { id: string; label: string }[];
  onDone: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [condition, setCondition] = useState("ok");
  // The result goes straight up to the list: a fully received line leaves the list, taking this form with it.
  const action = (fd: FormData) =>
    startTransition(async () => {
      setError(null);
      const r: GoodsInResult = await checkIn(lineId, { ok: false }, fd);
      if (r.ok && r.message) onDone(r.message);
      else setError(r.error ?? "That didn't work. Try again.");
    });

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--divider)", paddingTop: 12 }}>
      <fieldset className={ui.fieldset} style={{ margin: 0 }}>
        <legend className={ui.label}>What arrived?</legend>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {conditions.map((c) => (
            <label key={c.value} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14, minHeight: 44, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 10 }}>
              <input type="radio" name="condition" value={c.value} checked={condition === c.value} onChange={() => setCondition(c.value)} /> {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        {condition !== "ok" && (
          <div className={ui.field} style={{ maxWidth: 160 }}>
            <label htmlFor={`qty-${lineId}`} className={ui.label}>How many arrived</label>
            <input id={`qty-${lineId}`} name="quantity" inputMode="decimal" className={ui.input} placeholder={condition === "short" ? "" : "0"} />
          </div>
        )}
        {condition === "ok" && <input type="hidden" name="quantity" value={String(outstanding)} />}
        {shipments.length > 0 && (
          <div className={ui.field}>
            <label htmlFor={`ship-${lineId}`} className={ui.label}>Parcel</label>
            <select id={`ship-${lineId}`} name="shipment" className={ui.input} defaultValue={shipments[0]!.id}>
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
              <option value="">Not one of these</option>
            </select>
          </div>
        )}
        <div className={ui.field} style={{ flex: "1 1 200px" }}>
          <label htmlFor={`note-${lineId}`} className={ui.label}>{condition === "damaged" || condition === "wrong_item" ? "What's wrong" : "Note (optional)"}</label>
          <input id={`note-${lineId}`} name="note" maxLength={1000} className={ui.input} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Check in"}</button>
      </div>
      {error && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{error}</p>}
    </form>
  );
}
