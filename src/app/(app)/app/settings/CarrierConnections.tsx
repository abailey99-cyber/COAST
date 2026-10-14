"use client";

import { useState, useTransition } from "react";
import { HEALTH_LABELS, type HealthStatus } from "@/lib/logic/health";
import { saveCarrierClaimWindow, type ShipmentResult } from "@/server/shipment-actions";
import type { CarrierConnection } from "@/server/shipments";
import styles from "../shell.module.css";
import ui from "../ui.module.css";

const STATUS_CLASS: Record<HealthStatus, string> = {
  ok: "status-ok",
  warn: "status-warn",
  error: "status-bad",
  unconfigured: "status-neutral",
};

/** Carrier connections (spec §5.2): health per carrier, and each one's claim window (decision C9). */
export function CarrierConnections({ carriers, editable }: { carriers: CarrierConnection[]; editable: boolean }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Carrier</th>
            <th scope="col">Status</th>
            <th scope="col">Detail</th>
            <th scope="col">Claim window</th>
          </tr>
        </thead>
        <tbody>
          {carriers.map((c) => (
            <tr key={c.key}>
              <td>
                <span className={ui.badge} aria-hidden="true">{c.monogram}</span> {c.label}
                {c.beta && <div className={ui.muted}>Beta</div>}
              </td>
              <td>
                <span className={`status ${STATUS_CLASS[c.status]}`}>● {HEALTH_LABELS[c.status]}</span>
              </td>
              <td>
                {c.reason}
                {c.usage && <div className={ui.muted}>{c.usage}</div>}
              </td>
              <td>
                <ClaimWindow carrier={c.key} label={c.label} days={c.claimWindowDays} editable={editable} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimWindow({ carrier, label, days, editable }: { carrier: string; label: string; days: number | null; editable: boolean }) {
  const [value, setValue] = useState(days === null ? "" : String(days));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShipmentResult | null>(null);

  if (!editable) return <>{days === null ? <span className={ui.muted}>Not set</span> : `${days} days`}</>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        startTransition(async () => setResult(await saveCarrierClaimWindow(carrier, value)));
      }}
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
    >
      <label htmlFor={`claim-${carrier}`} className="visually-hidden">Claim window for {label}, in days</label>
      <input
        id={`claim-${carrier}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Not set"
        className={ui.input}
        style={{ width: 90, height: 36 }}
      />
      <span className={ui.muted}>days</span>
      <button type="submit" className="btn btn-secondary" disabled={pending} style={{ minHeight: 36 }}>{pending ? "Saving…" : "Save"}</button>
      {result && (result.ok ? <span className={ui.muted} role="status">✓ Saved</span> : <span className={ui.fieldError} role="alert">{result.error}</span>)}
    </form>
  );
}
