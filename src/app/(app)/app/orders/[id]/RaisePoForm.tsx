"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { CURRENCIES, formatQuantity } from "@/lib/logic/format";
import { createPoAction, type ActionState } from "@/server/order-actions";
import ui from "../../ui.module.css";

interface Props {
  orderId: string;
  currency: string;
  canEnterCosts: boolean;
  suppliers: { id: string; name: string; currency: string }[];
  lines: { id: string; lineNo: number; description: string; quantity: number }[];
}

/** Raise a purchase order to a supplier for one or more lines that need one. */
export function RaisePoForm({ orderId, currency, canEnterCosts, suppliers, lines }: Props) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createPoAction.bind(null, orderId), {});
  const [poCurrency, setPoCurrency] = useState(currency);
  const e = state.fieldErrors ?? {};

  if (suppliers.length === 0) {
    return (
      <section className={ui.panel} aria-labelledby="po-title">
        <h2 id="po-title" style={{ fontSize: 16 }}>Raise a purchase order</h2>
        <p className={ui.muted}>
          {lines.length === 1 ? "A line needs" : `${lines.length} lines need`} a purchase order, but there are no suppliers yet.{" "}
          <Link href="/app/suppliers">Add a supplier</Link> first.
        </p>
      </section>
    );
  }

  return (
    <form
      className={ui.fieldset}
      aria-labelledby="po-title"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <h2 id="po-title" style={{ fontSize: 16 }}>Raise a purchase order</h2>
      <p className={ui.muted}>
        The PO is saved as a draft. On the next page, send it to the supplier — COAST writes the email and a confirmation link they
        can use without logging in.
      </p>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      <div className={ui.grid2}>
        <div className={ui.field}>
          <label htmlFor="po-supplier" className={ui.label}>Supplier</label>
          <select
            id="po-supplier"
            name="supplierId"
            className={ui.input}
            defaultValue=""
            aria-invalid={e.supplierId ? true : undefined}
            onChange={(ev) => {
              const s = suppliers.find((x) => x.id === ev.target.value);
              if (s) setPoCurrency(s.currency);
            }}
          >
            <option value="" disabled>Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {e.supplierId && <span className={ui.fieldError}>{e.supplierId}</span>}
        </div>
        <div className={ui.field}>
          <label htmlFor="po-currency" className={ui.label}>Currency</label>
          <select id="po-currency" name="currency" className={ui.input} value={poCurrency} onChange={(ev) => setPoCurrency(ev.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      {e.lines && <p className={ui.fieldError}>{e.lines}</p>}
      <div className={ui.tableWrap}>
        <table className={ui.lineTable}>
          <thead>
            <tr>
              <th scope="col">Include</th>
              <th scope="col">Line</th>
              <th scope="col">Qty</th>
              {canEnterCosts && <th scope="col">Unit cost</th>}
              <th scope="col">Needed by</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const errs = Object.entries(e).filter(([k]) => k === `line.${l.id}` || k.startsWith(`line.${l.id}.`)).map(([, m]) => m);
              return (
                <tr key={l.id}>
                  <td>
                    <input type="checkbox" name="line" value={l.id} defaultChecked aria-label={`Include line ${l.lineNo}`} style={{ width: 20, height: 20, marginTop: 12 }} />
                  </td>
                  <td>
                    <div className={ui.strong} style={{ paddingTop: 10 }}>{l.lineNo}. {l.description}</div>
                    {errs.map((m) => (
                      <div key={m} className={ui.fieldError}>{m}</div>
                    ))}
                  </td>
                  <td>
                    <input name={`qty.${l.id}`} defaultValue={formatQuantity(l.quantity).replace(/,/g, "")} inputMode="decimal" aria-label={`Quantity for line ${l.lineNo}`} className={ui.input} style={{ width: 90 }} />
                  </td>
                  {canEnterCosts && (
                    <td>
                      <input name={`cost.${l.id}`} inputMode="decimal" aria-label={`Unit cost for line ${l.lineNo}`} className={ui.input} style={{ width: 110 }} />
                    </td>
                  )}
                  <td>
                    <input name={`date.${l.id}`} type="date" aria-label={`Needed by for line ${l.lineNo}`} className={ui.input} style={{ width: 160 }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={ui.actions}>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Create purchase order"}</button>
      </div>
    </form>
  );
}
