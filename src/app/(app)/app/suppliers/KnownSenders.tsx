"use client";

import { useActionState, useState } from "react";
import { saveSupplierSenders, type InboundResult } from "@/server/inbound-actions";
import ui from "../ui.module.css";

/** Other addresses a supplier's replies come from: only these and its main email count as known contacts (readiness Task 3). */
export function KnownSenders({ supplierId, name, senders, canEdit }: { supplierId: string; name: string; senders: string[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveSupplierSenders.bind(null, supplierId), null as InboundResult | null);
  if (!open) {
    return (
      <div className={ui.muted} style={{ fontSize: 12 }}>
        {senders.length ? `Also: ${senders.join(", ")}` : null}
        {canEdit && (
          <button type="button" className={ui.linkButton} onClick={() => setOpen(true)} style={{ marginLeft: senders.length ? 8 : 0, fontSize: 12 }}>
            {senders.length ? "Change" : "Other addresses"}
          </button>
        )}
      </div>
    );
  }
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      <label htmlFor={`senders-${supplierId}`} style={{ fontSize: 12 }}>Other addresses {name}&apos;s replies come from</label>
      <input id={`senders-${supplierId}`} name="senders" className={ui.input} defaultValue={senders.join(", ")} placeholder="sales@supplier.example, jo@supplier.example" />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" className={ui.linkButton} onClick={() => setOpen(false)}>Close</button>
        {state && (state.ok ? <span className={ui.muted} role="status">✓ {state.message}</span> : <span className={ui.fieldError} role="alert">{state.error}</span>)}
      </div>
    </form>
  );
}
