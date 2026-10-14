"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { acceptReviewedResponse, rejectReviewedResponse, type LoopResult } from "@/server/supplier-actions";
import type { ReviewItem } from "@/server/supplier-loop";
import ui from "../ui.module.css";

/** The values COAST read, pre-filled, for a person to correct and accept — or reject. */
export function ReviewForm({ item }: { item: ReviewItem }) {
  const [state, action, pending] = useActionState<LoopResult, FormData>(acceptReviewedResponse.bind(null, item.id), { ok: true });
  const [rejecting, startReject] = useTransition();
  const [rejected, setRejected] = useState<LoopResult | null>(null);
  const [note, setNote] = useState("");
  const [available, setAvailable] = useState<Record<string, boolean>>(Object.fromEntries(item.lines.map((l) => [l.poLineId, l.available])));

  if ((state.ok && state.message) || rejected?.ok) {
    return <p className="notice" role="status">{state.message ?? rejected?.message}</p>;
  }

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {!state.ok && <p className="notice notice-error" role="alert">{state.error}</p>}
      {rejected && !rejected.ok && <p className="notice notice-error" role="alert">{rejected.error}</p>}
      <div className={ui.tableWrap}>
        <table className={ui.lineTable}>
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Can supply</th>
              <th scope="col">Quantity</th>
              <th scope="col">Confirmed date</th>
              {item.canSeeCosts && <th scope="col">Unit price ({item.currency})</th>}
            </tr>
          </thead>
          <tbody>
            {item.lines.map((l) => (
              <tr key={l.poLineId}>
                <td style={{ paddingTop: 10 }}>
                  <div className={ui.strong}>{l.label}</div>
                  <div className={ui.muted}>
                    Ordered {l.orderedQuantity} · needed by {l.requested}
                    {l.expectedCost ? ` · expected ${l.expectedCost}` : ""}
                  </div>
                </td>
                <td>
                  <input
                    type="checkbox"
                    name={`available.${l.poLineId}`}
                    checked={available[l.poLineId] ?? true}
                    onChange={(e) => setAvailable((a) => ({ ...a, [l.poLineId]: e.target.checked }))}
                    aria-label={`${l.label} can be supplied`}
                    style={{ width: 20, height: 20, marginTop: 12 }}
                  />
                </td>
                <td>
                  <input name={`quantity.${l.poLineId}`} defaultValue={l.quantity} inputMode="decimal" className={ui.input} style={{ width: 90 }} aria-label={`${l.label} quantity`} disabled={!available[l.poLineId]} />
                </td>
                <td>
                  <input name={`date.${l.poLineId}`} type="date" defaultValue={l.date} className={ui.input} style={{ width: 160 }} aria-label={`${l.label} confirmed date`} disabled={!available[l.poLineId]} />
                </td>
                {item.canSeeCosts && (
                  <td>
                    <input name={`price.${l.poLineId}`} defaultValue={l.unitPrice} inputMode="decimal" className={ui.input} style={{ width: 110 }} aria-label={`${l.label} unit price`} disabled={!available[l.poLineId]} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={ui.actions}>
        <button type="submit" className="btn btn-primary" disabled={pending || rejecting}>{pending ? "Saving…" : "Accept and apply"}</button>
        <label htmlFor={`note-${item.id}`} className="visually-hidden">Why it&apos;s not relevant</label>
        <input id={`note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional)" className={ui.input} style={{ width: 220 }} />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || rejecting}
          onClick={() => startReject(async () => setRejected(await rejectReviewedResponse(item.id, note)))}
        >
          Not about this PO
        </button>
      </div>
    </form>
  );
}
