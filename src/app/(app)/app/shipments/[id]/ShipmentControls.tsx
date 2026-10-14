"use client";

import { useActionState, useState, useTransition } from "react";
import {
  changeShipmentTracking,
  checkShipmentNow,
  handShipmentBackToCarrier,
  setShipmentCustoms,
  setShipmentStatus,
  type ShipmentResult,
} from "@/server/shipment-actions";
import ui from "../../ui.module.css";

function Result({ result }: { result: ShipmentResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <p className={ui.muted} role="status" style={{ margin: 0 }}>{result.message}</p>
  ) : result.error ? (
    <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{result.error}</p>
  ) : null;
}

export function CheckNowButton({ shipmentId }: { shipmentId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShipmentResult | null>(null);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => setResult(await checkShipmentNow(shipmentId)));
        }}
      >
        {pending ? "Checking…" : "Check now"}
      </button>
      <Result result={result} />
    </span>
  );
}

export function StatusControl({
  shipmentId,
  current,
  manual,
  options,
}: {
  shipmentId: string;
  current: string;
  manual: boolean;
  options: { value: string; label: string }[];
}) {
  const [status, setStatus] = useState(current);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShipmentResult | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        startTransition(async () => {
          const r = await setShipmentStatus(shipmentId, status, note);
          setResult(r);
          if (r.ok) setNote("");
        });
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--divider)", paddingTop: 12 }}
    >
      <div className={ui.strong} style={{ fontSize: 14 }}>Status</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor="shipment-status" className="visually-hidden">Status</label>
        <select id="shipment-status" value={status} onChange={(e) => setStatus(e.target.value)} className={ui.input} style={{ flex: "0 1 240px" }}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label htmlFor="shipment-status-note" className="visually-hidden">Note (optional)</label>
        <input id="shipment-status-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={300} className={ui.input} style={{ flex: "1 1 200px" }} />
        <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Set status"}</button>
      </div>
      {manual && (
        <div>
          <button
            type="button"
            className={ui.linkButton}
            disabled={pending}
            onClick={() => {
              setResult(null);
              startTransition(async () => setResult(await handShipmentBackToCarrier(shipmentId)));
            }}
          >
            Hand the status back to the carrier
          </button>
        </div>
      )}
      <Result result={result} />
    </form>
  );
}

export function CustomsControl({ shipmentId, manual, options }: { shipmentId: string; manual: boolean; options: { value: string; label: string }[] }) {
  const [value, setValue] = useState(options[0]?.value ?? "unknown");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShipmentResult | null>(null);
  const save = (v: string) => {
    setResult(null);
    startTransition(async () => setResult(await setShipmentCustoms(shipmentId, v)));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(value);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--divider)", paddingTop: 12 }}
    >
      <div className={ui.strong} style={{ fontSize: 14 }}>Customs</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor="shipment-customs" className="visually-hidden">Customs status</label>
        <select id="shipment-customs" value={value} onChange={(e) => setValue(e.target.value)} className={ui.input} style={{ flex: "0 1 240px" }}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Set customs"}</button>
      </div>
      {manual && (
        <div>
          <button type="button" className={ui.linkButton} disabled={pending} onClick={() => save("carrier")}>
            Read customs from the carrier again
          </button>
        </div>
      )}
      <Result result={result} />
    </form>
  );
}

export function ChangeTrackingForm({
  shipmentId,
  carrier,
  trackingNumber,
  carriers,
}: {
  shipmentId: string;
  carrier: string;
  trackingNumber: string;
  carriers: { key: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(changeShipmentTracking.bind(null, shipmentId), { ok: false } as ShipmentResult);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--divider)", paddingTop: 12 }}>
      <div className={ui.strong} style={{ fontSize: 14 }}>Carrier and tracking number</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor="change-carrier" className="visually-hidden">Carrier</label>
        <select id="change-carrier" name="carrier" defaultValue={carrier} className={ui.input} style={{ flex: "0 1 240px" }} aria-invalid={state.fieldErrors?.carrier ? true : undefined}>
          {carriers.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <label htmlFor="change-tracking" className="visually-hidden">Tracking number</label>
        <input id="change-tracking" name="trackingNumber" defaultValue={trackingNumber} placeholder="Tracking number" className={ui.input} style={{ flex: "1 1 200px" }} aria-invalid={state.fieldErrors?.trackingNumber ? true : undefined} />
        <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      {state.fieldErrors?.carrier && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{state.fieldErrors.carrier}</p>}
      {state.fieldErrors?.trackingNumber && <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{state.fieldErrors.trackingNumber}</p>}
      <Result result={state} />
    </form>
  );
}
