"use client";

import { useActionState, useState, useTransition } from "react";
import { confirmShipmentCustoms, saveCustomerEoriNumber, setCustomsDocument, type ShipmentResult } from "@/server/shipment-actions";
import type { ShipmentCustoms } from "@/server/shipments";
import ui from "../../ui.module.css";

function Result({ result }: { result: ShipmentResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <p className={ui.muted} role="status" style={{ margin: 0 }}>{result.message}</p>
  ) : (
    <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{result.error}</p>
  );
}

/** Customs on a shipment (spec §5.3): confirm whether it applies, then the document checklist. */
export function CustomsCard({ shipmentId, customs: c, canManage }: { shipmentId: string; customs: ShipmentCustoms; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShipmentResult | null>(null);
  const run = (fn: () => Promise<ShipmentResult>) => {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  };
  const [eoriState, eoriAction, eoriPending] = useActionState(saveCustomerEoriNumber.bind(null, shipmentId), null as ShipmentResult | null);

  return (
    <section className={ui.panel} aria-labelledby="customs-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 id="customs-title" style={{ fontSize: 16 }}>Customs</h2>
        {c.territory && !c.confirmed ? <span className="status status-warn">● To confirm</span> : c.needsAttention ? <span className="status status-warn">● Needs attention</span> : c.applies ? <span className="status status-ok">● In hand</span> : <span className="status status-neutral">● Not needed</span>}
      </div>

      {c.territory && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0 }}>
            This delivery goes from the mainland to Northern Ireland, the Channel Islands or the Isle of Man. Whether customs applies depends on the goods and the route
            {c.confirmed ? ` — confirmed: ${c.applies ? "customs applies" : "no customs"}.` : ", so a person needs to confirm it."}
          </p>
          {canManage && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={`btn ${c.confirmed && c.applies ? "btn-primary" : "btn-secondary"}`} disabled={pending} onClick={() => run(() => confirmShipmentCustoms(shipmentId, true))} aria-pressed={c.confirmed && c.applies}>
                Customs applies
              </button>
              <button type="button" className={`btn ${c.confirmed && !c.applies ? "btn-primary" : "btn-secondary"}`} disabled={pending} onClick={() => run(() => confirmShipmentCustoms(shipmentId, false))} aria-pressed={c.confirmed && !c.applies}>
                No customs needed
              </button>
            </div>
          )}
        </div>
      )}

      {c.applies && (
        <>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <caption className="visually-hidden">Customs documents</caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Status</th>
                  {canManage && <th scope="col"><span className="visually-hidden">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {c.docs.map((d) => (
                  <tr key={d.type}>
                    <td className={ui.strong}>{d.label}</td>
                    <td>
                      {!d.required ? (
                        <span className="status status-neutral">● Not needed</span>
                      ) : d.received ? (
                        <span className="status status-ok">● Received</span>
                      ) : (
                        <span className="status status-warn">● Outstanding</span>
                      )}
                      {d.received && <div className={ui.muted}>{d.received}</div>}
                    </td>
                    {canManage && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        {d.required && (
                          <button type="button" className={ui.linkButton} disabled={pending} onClick={() => run(() => setCustomsDocument(shipmentId, d.type, d.received ? "not_received" : "received"))}>
                            {d.received ? "Undo received" : `Mark ${d.label.toLowerCase()} received`}
                          </button>
                        )}
                        {!d.received && (
                          <button type="button" className={ui.linkButton} disabled={pending} onClick={() => run(() => setCustomsDocument(shipmentId, d.type, d.required ? "not_required" : "required"))} style={{ marginLeft: 12 }}>
                            {d.required ? "Not needed" : "Needed"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.missingHsCodes.length > 0 && (
            <p className="status status-warn" style={{ margin: 0 }}>
              ● No commodity (HS) code on line {c.missingHsCodes.join(", ")} — customs will ask for one. Add it by editing the order.
            </p>
          )}
          <dl className={ui.kv}>
            <dt>Our EORI</dt>
            <dd>{c.ourEori ?? <span className={ui.muted}>Not set — add it in Settings → Customs</span>}</dd>
            <dt>Customer&apos;s EORI</dt>
            <dd>
              {canManage && c.customer ? (
                <form action={eoriAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <label htmlFor="customer-eori" className="visually-hidden">{c.customer.name}&apos;s EORI number</label>
                  <input id="customer-eori" name="eori" className={ui.input} style={{ maxWidth: 220 }} defaultValue={c.customer.eori ?? ""} placeholder="e.g. GB123456789000" maxLength={20} />
                  <button type="submit" className="btn btn-secondary" disabled={eoriPending}>{eoriPending ? "Saving…" : "Save"}</button>
                  <Result result={eoriState} />
                </form>
              ) : (
                (c.customer?.eori ?? <span className={ui.muted}>Not recorded</span>)
              )}
            </dd>
          </dl>
          <p className={ui.hint} style={{ margin: 0 }}>
            The checklist is a starting point from the shipment and its lines — change what&apos;s needed for this one. Customers only ever see “Customs checks in progress — we&apos;re on it.” while it&apos;s held.
          </p>
        </>
      )}
      <Result result={result} />
    </section>
  );
}
