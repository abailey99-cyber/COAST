"use client";

import { useActionState } from "react";
import { saveCustomsSettingsForm, type ShipmentResult } from "@/server/shipment-actions";
import styles from "../shell.module.css";

/** Settings → Customs: the company's EORI number, and decision C6 (Northern Ireland and the islands). */
export function CustomsSettingsForm({ values, editable }: { values: { eori: string | null; territoriesNeedCustoms: boolean }; editable: boolean }) {
  const [state, action, pending] = useActionState(saveCustomsSettingsForm, null as ShipmentResult | null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="customs-eori">Your EORI number</label>
        <input id="customs-eori" name="eori" className="input" defaultValue={values.eori ?? ""} placeholder="e.g. GB123456789000" maxLength={20} disabled={!editable} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Shown on each customs checklist for whoever fills in the paperwork.</span>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="territories" defaultChecked={values.territoriesNeedCustoms} disabled={!editable} style={{ marginTop: 4 }} />
        <span>
          Treat deliveries from the mainland to Northern Ireland, Jersey, Guernsey and the Isle of Man as needing customs
          <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>Either way, each of these shipments asks a person to confirm.</span>
        </span>
      </label>
      {editable && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save customs settings"}</button>
          {state?.ok && <span className={styles.saveStatus} role="status">✓ {state.message}</span>}
          {state && !state.ok && <span className="notice notice-error" role="alert">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
