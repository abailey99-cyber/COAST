"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { guessCarrier } from "@/lib/logic/carriers";
import { ROUTE_LEGS } from "@/lib/logic/shipments";
import { addShipment, type ShipmentResult } from "@/server/shipment-actions";
import type { OrderShipments as Data } from "@/server/shipments";
import { TONE_CLASS } from "../../shipments/tone";
import ui from "../../ui.module.css";

/** The order page's Shipments panel: what's on its way, and adding a shipment. */
export function OrderShipments({ orderId, data }: { orderId: string; data: Data }) {
  return (
    <section className={ui.panel} aria-labelledby="shipments-title">
      <h2 id="shipments-title" style={{ fontSize: 16 }}>Shipments</h2>
      {data.shipments.length === 0 ? (
        <p className={ui.muted} style={{ margin: 0 }}>No shipments yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {data.shipments.map((s) => (
            <li key={s.id} style={{ fontSize: 13 }}>
              <div className={ui.strong}>
                {data.canOpenShipments ? (
                  <Link href={`/app/shipments/${s.id}`} className={ui.rowLink}>{s.trackingNumber ?? "No tracking number"}</Link>
                ) : (
                  (s.trackingNumber ?? "No tracking number")
                )}
                <span className={ui.muted}> · {s.carrierLabel} · {s.legLabel}</span>
              </div>
              <div>
                <span className={`status ${TONE_CLASS[s.tone]}`}>● {s.statusLabel}</span>
                {s.status === "delivered" ? (s.delivered ? <span className={ui.muted}> · {s.delivered}</span> : null) : s.eta ? <span className={ui.muted}> · expected {s.eta}</span> : null}
              </div>
              {s.statusText && <div className={ui.muted}>{s.statusText}</div>}
              {s.customs && <div className={ui.muted}>Customs: {s.customs.label}</div>}
            </li>
          ))}
        </ul>
      )}
      {data.form && <AddShipmentForm orderId={orderId} form={data.form} />}
    </section>
  );
}

function AddShipmentForm({ orderId, form }: { orderId: string; form: NonNullable<Data["form"]> }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addShipment.bind(null, orderId), { ok: false } as ShipmentResult);
  const [leg, setLeg] = useState(form.lines[0]?.defaultLeg ?? form.legs[0]?.value ?? "outbound");
  const [carrier, setCarrier] = useState("");
  const [carrierTouched, setCarrierTouched] = useState(false);
  const fits = form.lines.filter((l) => ROUTE_LEGS[l.route].includes(leg));
  const errors = state.fieldErrors ?? {};

  if (!open) {
    return (
      <div style={{ borderTop: "1px solid var(--divider)", paddingTop: 12 }}>
        {state.ok && state.message && <p className={ui.muted} role="status">{state.message}</p>}
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>Add a shipment</button>
      </div>
    );
  }

  return (
    <form
      action={action}
      style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--divider)", paddingTop: 12 }}
    >
      <div className={ui.strong} style={{ fontSize: 14 }}>Add a shipment</div>

      <div className={ui.field}>
        <label htmlFor="ship-leg" className={ui.label}>Going</label>
        <select id="ship-leg" name="leg" value={leg} onChange={(e) => setLeg(e.target.value as typeof leg)} className={ui.input}>
          {form.legs.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
        {errors.leg && <span className={ui.fieldError}>{errors.leg}</span>}
      </div>

      <fieldset className={ui.fieldset} style={{ margin: 0 }}>
        <legend className={ui.label}>Lines on it</legend>
        {fits.length === 0 ? (
          <p className={ui.muted} style={{ margin: 0 }}>No open lines travel this way.</p>
        ) : (
          fits.map((l) => (
            <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" name="lineIds" value={l.id} defaultChecked={fits.length === 1} /> {l.label}
            </label>
          ))
        )}
        {errors.lines && <span className={ui.fieldError}>{errors.lines}</span>}
      </fieldset>

      <div className={ui.field}>
        <label htmlFor="ship-tracking" className={ui.label}>Tracking number</label>
        <input
          id="ship-tracking"
          name="trackingNumber"
          className={ui.input}
          autoComplete="off"
          onChange={(e) => {
            const guess = guessCarrier(e.target.value);
            if (guess && !carrierTouched && form.carriers.some((c) => c.key === guess)) setCarrier(guess);
          }}
          aria-invalid={errors.trackingNumber ? true : undefined}
        />
        {errors.trackingNumber && <span className={ui.fieldError}>{errors.trackingNumber}</span>}
      </div>

      <div className={ui.field}>
        <label htmlFor="ship-carrier" className={ui.label}>Carrier</label>
        <select
          id="ship-carrier"
          name="carrier"
          value={carrier}
          onChange={(e) => {
            setCarrier(e.target.value);
            setCarrierTouched(true);
          }}
          className={ui.input}
          aria-invalid={errors.carrier ? true : undefined}
        >
          <option value="">Choose…</option>
          {form.carriers.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <span className={ui.hint}>Filled in for you when the tracking number makes it obvious.</span>
        {errors.carrier && <span className={ui.fieldError}>{errors.carrier}</span>}
      </div>

      <div className={ui.field}>
        <label htmlFor="ship-note" className={ui.label}>Note (optional)</label>
        <input id="ship-note" name="note" maxLength={1000} className={ui.input} />
      </div>

      <div className={ui.actions}>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Adding…" : "Add shipment"}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {!state.ok && state.error && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{state.error}</p>}
      {state.ok && state.message && <p className={ui.muted} role="status" style={{ margin: 0 }}>{state.message}</p>}
    </form>
  );
}
