import Link from "next/link";
import { notFound } from "next/navigation";
import { loadShipment } from "@/server/shipments";
import { PageHeader } from "../../PageHeader";
import ui from "../../ui.module.css";
import { TONE_CLASS } from "../tone";
import { CheckNowButton, ChangeTrackingForm, CustomsControl, StatusControl } from "./ShipmentControls";

export const metadata = { title: "Shipment" };

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await loadShipment(id);
  if (!page) notFound();
  const { shipment: s, can } = page;

  return (
    <>
      <PageHeader title={s.trackingNumber ?? "Shipment"} subtitle={`${s.carrierLabel} · ${s.legLabel} · for ${s.soNumber}, ${s.customerName}`}>
        {can.checkNow && <CheckNowButton shipmentId={s.id} />}
        {can.openOrder && <Link href={`/app/orders/${s.orderId}`} className="btn btn-secondary">Open order</Link>}
        <Link href="/app/shipments" className="btn btn-secondary">All shipments</Link>
      </PageHeader>

      <div className={ui.split}>
        <div className={ui.main} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className={ui.panel} aria-labelledby="summary-title">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 id="summary-title" style={{ fontSize: 16 }}>Where it is</h2>
              <span className={`status ${TONE_CLASS[s.tone]}`}>● {s.statusLabel}{s.manual ? " · set by hand" : ""}</span>
            </div>
            <dl className={ui.kv}>
              <dt>Latest</dt>
              <dd>{s.statusText ?? <span className={ui.muted}>Nothing from the carrier yet</span>}</dd>
              <dt>{s.status === "delivered" ? "Delivered" : "Expected"}</dt>
              <dd>
                {s.status === "delivered"
                  ? (s.delivered ?? "Yes")
                  : s.eta
                    ? `${s.eta} (carrier's estimate)`
                    : <span className={ui.muted}>Not known yet</span>}
              </dd>
              {s.customs && (
                <>
                  <dt>Customs</dt>
                  <dd>
                    <span className={`status ${TONE_CLASS[s.customs.tone]}`}>● {s.customs.label}</span>
                    <span className={ui.muted}> · {s.customs.manual ? "set by hand" : "read from the carrier's updates"}</span>
                  </dd>
                </>
              )}
              <dt>Carrier</dt>
              <dd>
                {s.carrierLabel}
                {s.trackingUrl && (
                  <>
                    {" · "}
                    <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">Carrier&apos;s tracking page</a>
                  </>
                )}
              </dd>
              <dt>Checked</dt>
              <dd>
                {s.live ? (
                  <>
                    {s.lastChecked ? `Last ${s.lastChecked}` : "Not yet"}
                    {page.nextCheck ? ` · next ${page.nextCheck}` : s.status === "delivered" ? " · checks stopped (delivered)" : ""}
                  </>
                ) : (
                  <span className={ui.muted}>Not checked automatically — {page.checkNowReason ?? "update it by hand"}</span>
                )}
                {s.checkProblem && <div className={ui.fieldError}>{s.checkProblem}</div>}
                {s.live && page.checkNowReason && <div className={ui.muted}>{page.checkNowReason}</div>}
              </dd>
              <dt>Lines</dt>
              <dd>
                {page.lines.map((l) => (
                  <div key={l.id}>
                    {l.label} <span className={ui.muted}>· {l.stage}</span>
                  </div>
                ))}
              </dd>
              {page.note && (
                <>
                  <dt>Note</dt>
                  <dd>{page.note}</dd>
                </>
              )}
              <dt>Added</dt>
              <dd>{page.createdBy} · {page.createdAt}</dd>
            </dl>
          </section>

          {can.manage && (
            <section className={ui.panel} aria-labelledby="manage-title">
              <h2 id="manage-title" style={{ fontSize: 16 }}>Change it by hand</h2>
              <p className={ui.muted} style={{ margin: 0 }}>
                For deliveries COAST can&apos;t check, or when the carrier is wrong. Anything you set stays until you hand it back to the carrier.
              </p>
              <StatusControl shipmentId={s.id} current={s.status} manual={s.manual} options={page.statusOptions} />
              {s.customs && <CustomsControl shipmentId={s.id} manual={s.customs.manual} options={page.customsOptions} />}
              <ChangeTrackingForm shipmentId={s.id} carrier={s.carrier} trackingNumber={s.trackingNumber ?? ""} carriers={page.carriers} />
            </section>
          )}
        </div>

        <aside className={`${ui.panel} ${ui.aside}`} aria-labelledby="events-title">
          <h2 id="events-title" style={{ fontSize: 16 }}>Tracking updates</h2>
          {page.events.length === 0 ? (
            <p className={ui.muted}>None yet.</p>
          ) : (
            <ol className={ui.timeline}>
              {page.events.map((e, i) => (
                <li key={e.id}>
                  <span className={`${ui.dot} ${i > 0 ? ui.dotOld : ""}`} aria-hidden="true" />
                  <div>
                    <div className={ui.strong}>{e.description}</div>
                    <div className={ui.muted}>
                      {e.when}
                      {e.location ? ` · ${e.location}` : ""} · <span className={ui.badge}>{e.source}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </>
  );
}
