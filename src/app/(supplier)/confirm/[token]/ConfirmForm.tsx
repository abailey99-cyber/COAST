"use client";

import { startTransition, useActionState, useState } from "react";
import { submitSupplierConfirmation, type ConfirmState } from "@/server/confirm-actions";
import styles from "./confirm.module.css";

interface Line {
  poLineId: string;
  description: string;
  sku: string | null;
  quantity: string;
  quantityValue: number;
  requested: string;
  requestedIso: string;
  price: string | null;
  priceValue: string;
  confirmed: string | null;
  deliverTo: string | null;
}

export function ConfirmForm({ token, lines, currency }: { token: string; lines: Line[]; currency: string }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(submitSupplierConfirmation.bind(null, token), {});
  const [cannot, setCannot] = useState<Record<string, boolean>>({});
  const e = state.fieldErrors ?? {};

  if (state.done) {
    return (
      <section className={styles.card} role="status">
        <h2 className={styles.subtitle}>Thank you</h2>
        <p className={styles.lede}>
          {state.done === "applied"
            ? "Your confirmation has been received. There's nothing more you need to do."
            : "Your answer has been received. It differs from the order in some way, so someone will check it and be in touch if needed."}
        </p>
      </section>
    );
  }

  return (
    <form
      className={styles.card}
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
    >
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      {lines.map((l, i) => {
        const off = cannot[l.poLineId] ?? false;
        const errs = Object.entries(e).filter(([k]) => k.startsWith(`${l.poLineId}.`)).map(([, m]) => m);
        return (
          <fieldset key={l.poLineId} className={styles.line}>
            <legend className={styles.lineTitle}>
              {i + 1}. {l.description} {l.sku && <span className={styles.muted}>· {l.sku}</span>}
            </legend>
            <p className={styles.muted}>
              Ordered: <strong>{l.quantity}</strong>
              {l.requestedIso && <> · needed by <strong>{l.requested}</strong></>}
              {l.price && <> · {l.price} each</>}
              {l.confirmed && <> · you confirmed {l.confirmed}</>}
            </p>
            {l.deliverTo && (
              <p className={styles.deliver}>
                <strong>Deliver directly to:</strong> {l.deliverTo}
              </p>
            )}
            <label className={styles.check}>
              <input type="checkbox" name={`cannot.${l.poLineId}`} checked={off} onChange={(ev) => setCannot((c) => ({ ...c, [l.poLineId]: ev.target.checked }))} />
              We can&apos;t supply this line
            </label>
            {!off && (
              <div className={styles.grid}>
                <div className="field">
                  <label htmlFor={`q-${l.poLineId}`}>Quantity you can supply</label>
                  <input id={`q-${l.poLineId}`} name={`quantity.${l.poLineId}`} defaultValue={String(l.quantityValue)} inputMode="decimal" className="input" />
                </div>
                <div className="field">
                  <label htmlFor={`d-${l.poLineId}`}>Delivery date</label>
                  <input id={`d-${l.poLineId}`} name={`date.${l.poLineId}`} type="date" defaultValue={l.requestedIso} className="input" />
                </div>
                <div className="field">
                  <label htmlFor={`p-${l.poLineId}`}>Unit price in {currency} (optional)</label>
                  <input id={`p-${l.poLineId}`} name={`price.${l.poLineId}`} defaultValue={l.priceValue} inputMode="decimal" className="input" />
                </div>
              </div>
            )}
            {errs.map((m) => (
              <p key={m} className={styles.error}>{m}</p>
            ))}
          </fieldset>
        );
      })}
      <div className={styles.grid}>
        <div className="field">
          <label htmlFor="reference">Your reference (optional)</label>
          <input id="reference" name="reference" className="input" autoComplete="off" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="note">Anything else we should know? (optional)</label>
        <textarea id="note" name="note" rows={3} className={`input ${styles.textarea}`} />
      </div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Sending…" : "Send confirmation"}</button>
    </form>
  );
}
