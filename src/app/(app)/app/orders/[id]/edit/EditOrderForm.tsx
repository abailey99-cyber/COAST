"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { CURRENCIES } from "@/lib/logic/format";
import { FULFILMENT_ROUTES, ROUTE_LABELS } from "@/lib/logic/orders";
import { updateOrderAction, type ActionState } from "@/server/order-actions";
import type { OrderEditPage } from "@/server/orders";
import ui from "../../../ui.module.css";

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={ui.field}>
      <label htmlFor={id} className={ui.label}>{label}</label>
      {children}
      {hint && <span className={ui.hint}>{hint}</span>}
      {error && <span className={ui.fieldError} id={`${id}-error`}>{error}</span>}
    </div>
  );
}

export function EditOrderForm({ page }: { page: OrderEditPage }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateOrderAction.bind(null, page.id), {});
  const [newCount, setNewCount] = useState(0);
  const e = state.fieldErrors ?? {};
  const v = page.values;
  const invalid = (k: string) => (e[k] ? { "aria-invalid": true as const, "aria-describedby": `${k}-error` } : {});
  const nextLineNo = page.lines.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1;

  return (
    <form
      className={ui.form}
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
    >
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      <input type="hidden" name="newLineCount" value={newCount} />

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend}>Customer</legend>
        <div className={ui.grid2}>
          <Field id="customerName" label="Customer" error={e.customerName} hint="Typing a new name adds a new customer.">
            <input id="customerName" name="customerName" defaultValue={v.customerName} className={ui.input} autoComplete="off" {...invalid("customerName")} />
          </Field>
          <Field id="customerReference" label="Customer's own reference (optional)">
            <input id="customerReference" name="customerReference" defaultValue={v.customerReference} className={ui.input} autoComplete="off" />
          </Field>
          <Field id="salesRepId" label="Sales rep" error={e.salesRepId}>
            <select id="salesRepId" name="salesRepId" defaultValue={v.salesRepId} className={ui.input} {...invalid("salesRepId")}>
              {!page.mustBeOwnRep && <option value="">No rep</option>}
              {page.reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field id="currency" label="Currency" error={e.currency}>
            <select id="currency" name="currency" defaultValue={v.currency} className={ui.input}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field id="promisedDate" label="Promised delivery date (optional)" error={e.promisedDate}>
            <input id="promisedDate" name="promisedDate" type="date" defaultValue={v.promisedDate} className={ui.input} {...invalid("promisedDate")} />
          </Field>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend}>Delivery address</legend>
        <div className={ui.grid2}>
          <Field id="deliveryName" label="Deliver to" error={e.deliveryName}>
            <input id="deliveryName" name="deliveryName" defaultValue={v.deliveryName} className={ui.input} autoComplete="off" {...invalid("deliveryName")} />
          </Field>
          <Field id="deliveryLine1" label="Address line 1" error={e.deliveryLine1}>
            <input id="deliveryLine1" name="deliveryLine1" defaultValue={v.deliveryLine1} className={ui.input} autoComplete="off" {...invalid("deliveryLine1")} />
          </Field>
          <Field id="deliveryLine2" label="Address line 2 (optional)">
            <input id="deliveryLine2" name="deliveryLine2" defaultValue={v.deliveryLine2} className={ui.input} autoComplete="off" />
          </Field>
          <Field id="deliveryTown" label="Town or city" error={e.deliveryTown}>
            <input id="deliveryTown" name="deliveryTown" defaultValue={v.deliveryTown} className={ui.input} autoComplete="off" {...invalid("deliveryTown")} />
          </Field>
          <Field id="deliveryPostcode" label="Postcode" error={e.deliveryPostcode}>
            <input id="deliveryPostcode" name="deliveryPostcode" defaultValue={v.deliveryPostcode} className={ui.input} autoComplete="off" {...invalid("deliveryPostcode")} />
          </Field>
          <Field id="deliveryCountry" label="Country code" error={e.deliveryCountry}>
            <input id="deliveryCountry" name="deliveryCountry" defaultValue={v.deliveryCountry} maxLength={2} className={ui.input} autoComplete="off" {...invalid("deliveryCountry")} />
          </Field>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend}>Lines</legend>
        <p className={ui.muted}>
          How a line is fulfilled can&apos;t change once it&apos;s created — cancel the line and add a new one instead. Delivered and
          cancelled lines are locked.
        </p>
        {e.newLines && <p className={ui.fieldError}>{e.newLines}</p>}
        <div className={ui.tableWrap}>
          <table className={ui.lineTable}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Product code</th>
                <th scope="col">Description</th>
                <th scope="col">Qty</th>
                <th scope="col">Unit price</th>
                <th scope="col">Fulfilled</th>
              </tr>
            </thead>
            <tbody>
              {page.lines.map((l) => {
                const errs = Object.entries(e).filter(([k]) => k.startsWith(`line.${l.id}`)).map(([, m]) => m);
                if (l.locked) {
                  return (
                    <tr key={l.id}>
                      <td className={ui.muted} style={{ paddingTop: 14 }}>{l.lineNo}</td>
                      <td className={ui.muted} style={{ paddingTop: 14 }}>{l.sku || "—"}</td>
                      <td style={{ paddingTop: 14 }}>
                        {l.description} <span className={ui.badge}>{l.stageLabel}</span>
                      </td>
                      <td className={ui.muted} style={{ paddingTop: 14 }}>{l.quantity}</td>
                      <td className={ui.muted} style={{ paddingTop: 14 }}>{l.unitPrice || "—"}</td>
                      <td className={ui.muted} style={{ paddingTop: 14 }}>{l.route}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={l.id}>
                    <td className={ui.muted} style={{ paddingTop: 14 }}>
                      <input type="hidden" name="lineId" value={l.id} />
                      {l.lineNo}
                    </td>
                    <td>
                      <input name={`line.${l.id}.sku`} defaultValue={l.sku} aria-label={`Line ${l.lineNo} product code`} className={ui.input} style={{ width: 120 }} autoComplete="off" />
                    </td>
                    <td>
                      <input name={`line.${l.id}.description`} defaultValue={l.description} aria-label={`Line ${l.lineNo} description`} className={ui.input} aria-invalid={e[`line.${l.id}.description`] ? true : undefined} autoComplete="off" />
                      {errs.map((m) => (
                        <div key={m} className={ui.fieldError}>{m}</div>
                      ))}
                    </td>
                    <td>
                      <input name={`line.${l.id}.quantity`} defaultValue={l.quantity} aria-label={`Line ${l.lineNo} quantity`} inputMode="decimal" className={ui.input} style={{ width: 80 }} aria-invalid={e[`line.${l.id}.quantity`] ? true : undefined} />
                      {l.quantityOnLivePos > 0 && <div className={ui.hint}>{l.quantityOnLivePos} on a PO</div>}
                    </td>
                    <td>
                      <input name={`line.${l.id}.unitPrice`} defaultValue={l.unitPrice} aria-label={`Line ${l.lineNo} unit price`} inputMode="decimal" className={ui.input} style={{ width: 100 }} aria-invalid={e[`line.${l.id}.unitPrice`] ? true : undefined} />
                    </td>
                    <td className={ui.muted} style={{ paddingTop: 14 }}>{l.route}</td>
                  </tr>
                );
              })}
              {Array.from({ length: newCount }, (_, i) => {
                const n = nextLineNo + i;
                const errs = ["description", "quantity", "unitPrice", "route"].map((f) => e[`newLines.${i}.${f}`]).filter(Boolean);
                return (
                  <tr key={`new-${i}`}>
                    <td className={ui.muted} style={{ paddingTop: 14 }}>{n}</td>
                    <td>
                      <input name={`newLines.${i}.sku`} aria-label={`Line ${n} product code`} className={ui.input} style={{ width: 120 }} autoComplete="off" />
                    </td>
                    <td>
                      <input name={`newLines.${i}.description`} aria-label={`Line ${n} description`} className={ui.input} autoComplete="off" />
                      {errs.map((m) => (
                        <div key={m} className={ui.fieldError}>{m}</div>
                      ))}
                    </td>
                    <td>
                      <input name={`newLines.${i}.quantity`} aria-label={`Line ${n} quantity`} inputMode="decimal" className={ui.input} style={{ width: 80 }} />
                    </td>
                    <td>
                      <input name={`newLines.${i}.unitPrice`} aria-label={`Line ${n} unit price`} inputMode="decimal" className={ui.input} style={{ width: 100 }} />
                    </td>
                    <td>
                      <select name={`newLines.${i}.route`} aria-label={`Line ${n} fulfilled`} className={ui.input} defaultValue="direct_ship" style={{ width: 150 }}>
                        {FULFILMENT_ROUTES.map((r) => (
                          <option key={r} value={r}>{ROUTE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <button type="button" className={ui.linkButton} onClick={() => setNewCount((c) => Math.min(c + 1, 50))}>
            Add a line
          </button>
        </div>
      </fieldset>

      <div className={ui.actions}>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
        <Link href={`/app/orders/${page.id}`} className="btn btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
