"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { CURRENCIES } from "@/lib/logic/format";
import { FULFILMENT_ROUTES, ROUTE_LABELS } from "@/lib/logic/orders";
import { createOrderAction, type ActionState } from "@/server/order-actions";
import ui from "../../ui.module.css";

interface Props {
  reps: { id: string; name: string }[];
  defaultRepId: string | null;
  mustBeOwnRep: boolean;
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={ui.field}>
      <label htmlFor={id} className={ui.label}>{label}</label>
      {children}
      {hint && <span className={ui.hint} id={`${id}-hint`}>{hint}</span>}
      {error && <span className={ui.fieldError} id={`${id}-error`}>{error}</span>}
    </div>
  );
}

export function NewOrderForm({ reps, defaultRepId, mustBeOwnRep }: Props) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createOrderAction, {});
  const [lineCount, setLineCount] = useState(3);
  const e = state.fieldErrors ?? {};
  const invalid = (k: string) => (e[k] ? { "aria-invalid": true as const, "aria-describedby": `${k}-error` } : {});

  return (
    <form
      className={ui.form}
      noValidate
      onSubmit={(ev) => {
        // Submit by hand: a plain form action clears every field when there's an error.
        ev.preventDefault();
        const data = new FormData(ev.currentTarget);
        startTransition(() => action(data));
      }}
    >
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      <input type="hidden" name="lineCount" value={lineCount} />

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend}>Customer</legend>
        <div className={ui.grid2}>
          <Field id="customerName" label="Customer" error={e.customerName} hint="Type the name. A new customer is added if it isn't known yet.">
            <input id="customerName" name="customerName" className={ui.input} required autoComplete="off" {...invalid("customerName")} />
          </Field>
          <Field id="customerReference" label="Customer's own reference (optional)" hint="Their PO number — what they'll quote when they ask.">
            <input id="customerReference" name="customerReference" className={ui.input} autoComplete="off" />
          </Field>
          <Field id="soNumber" label="SO number (optional)" error={e.soNumber} hint="Leave blank and COAST numbers it for you.">
            <input id="soNumber" name="soNumber" className={ui.input} autoComplete="off" {...invalid("soNumber")} />
          </Field>
          <Field id="salesRepId" label="Sales rep" error={e.salesRepId}>
            <select id="salesRepId" name="salesRepId" className={ui.input} defaultValue={defaultRepId ?? ""} {...invalid("salesRepId")}>
              {!mustBeOwnRep && <option value="">No rep yet</option>}
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field id="currency" label="Currency" error={e.currency}>
            <select id="currency" name="currency" className={ui.input} defaultValue="GBP">
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field id="promisedDate" label="Promised delivery date (optional)" error={e.promisedDate} hint="What the customer was told.">
            <input id="promisedDate" name="promisedDate" type="date" className={ui.input} {...invalid("promisedDate")} />
          </Field>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend}>Delivery address</legend>
        <div className={ui.grid2}>
          <Field id="deliveryName" label="Deliver to" error={e.deliveryName}>
            <input id="deliveryName" name="deliveryName" className={ui.input} autoComplete="off" {...invalid("deliveryName")} />
          </Field>
          <Field id="deliveryLine1" label="Address line 1" error={e.deliveryLine1}>
            <input id="deliveryLine1" name="deliveryLine1" className={ui.input} autoComplete="off" {...invalid("deliveryLine1")} />
          </Field>
          <Field id="deliveryLine2" label="Address line 2 (optional)">
            <input id="deliveryLine2" name="deliveryLine2" className={ui.input} autoComplete="off" />
          </Field>
          <Field id="deliveryTown" label="Town or city" error={e.deliveryTown}>
            <input id="deliveryTown" name="deliveryTown" className={ui.input} autoComplete="off" {...invalid("deliveryTown")} />
          </Field>
          <Field id="deliveryPostcode" label="Postcode" error={e.deliveryPostcode}>
            <input id="deliveryPostcode" name="deliveryPostcode" className={ui.input} autoComplete="off" {...invalid("deliveryPostcode")} />
          </Field>
          <Field id="deliveryCountry" label="Country code" error={e.deliveryCountry} hint="Two letters, e.g. GB, IE, FR.">
            <input id="deliveryCountry" name="deliveryCountry" className={ui.input} defaultValue="GB" maxLength={2} autoComplete="off" {...invalid("deliveryCountry")} />
          </Field>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend}>Lines</legend>
        <p className={ui.muted}>Blank rows are ignored. &quot;Direct ship&quot; and &quot;Via warehouse&quot; lines need a purchase order to a supplier.</p>
        {e.lines && <p className={ui.fieldError}>{e.lines}</p>}
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
              {Array.from({ length: lineCount }, (_, i) => {
                const errs = ["sku", "description", "quantity", "unitPrice", "route"].map((f) => e[`lines.${i}.${f}`]).filter(Boolean);
                return (
                  <tr key={i}>
                    <td className={ui.muted} style={{ paddingTop: 14 }}>{i + 1}</td>
                    <td>
                      <input name={`lines.${i}.sku`} aria-label={`Line ${i + 1} product code`} className={ui.input} style={{ width: 120 }} autoComplete="off" />
                    </td>
                    <td>
                      <input name={`lines.${i}.description`} aria-label={`Line ${i + 1} description`} className={ui.input} aria-invalid={e[`lines.${i}.description`] ? true : undefined} autoComplete="off" />
                      {errs.map((m) => (
                        <div key={m} className={ui.fieldError}>{m}</div>
                      ))}
                    </td>
                    <td>
                      <input name={`lines.${i}.quantity`} aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className={ui.input} style={{ width: 80 }} aria-invalid={e[`lines.${i}.quantity`] ? true : undefined} />
                    </td>
                    <td>
                      <input name={`lines.${i}.unitPrice`} aria-label={`Line ${i + 1} unit price`} inputMode="decimal" className={ui.input} style={{ width: 100 }} aria-invalid={e[`lines.${i}.unitPrice`] ? true : undefined} />
                    </td>
                    <td>
                      <select name={`lines.${i}.route`} aria-label={`Line ${i + 1} fulfilled`} className={ui.input} defaultValue="direct_ship" style={{ width: 150 }}>
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
          <button type="button" className={ui.linkButton} onClick={() => setLineCount((n) => Math.min(n + 3, 200))}>
            Add more lines
          </button>
        </div>
      </fieldset>

      <div className={ui.actions}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Create order"}
        </button>
        <Link href="/app/orders" className="btn btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
