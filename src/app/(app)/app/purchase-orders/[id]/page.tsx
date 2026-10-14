import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPurchaseOrder } from "@/server/procurement";
import { loadPoCommunication } from "@/server/supplier-loop";
import { PageHeader } from "../../PageHeader";
import ui from "../../ui.module.css";
import { PasteReplyForm } from "./PasteReplyForm";
import { PoStatusButtons } from "./PoStatusButtons";
import { RevokeLinkButton, SupplierActions } from "./SupplierActions";

export const metadata = { title: "Purchase order" };

const LEVEL_CLASS = { none: "status-neutral", amber: "status-warn", red: "status-bad", alert: "status-bad" } as const;

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await loadPurchaseOrder(id);
  if (!page) notFound();
  const { po } = page;
  const comms = await loadPoCommunication(po);
  const confirmations = new Map(comms.lineConfirmations.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title={po.poNumber} subtitle={`${po.supplierName} · created ${page.created}`}>
        <Link href="/app/purchase-orders" className="btn btn-secondary">All purchase orders</Link>
      </PageHeader>

      <div className={ui.split}>
        <div className={ui.main} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className={ui.panel} aria-labelledby="po-summary">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 id="po-summary" style={{ fontSize: 16 }}>Status</h2>
              <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span className="status status-neutral">● {page.statusLabel}</span>
                {comms.waiting && (
                  <span className={`status ${LEVEL_CLASS[comms.waiting.level]}`}>
                    ● {comms.waiting.label} · waiting {comms.waiting.wait}
                  </span>
                )}
              </span>
            </div>
            <dl className={ui.kv}>
              <dt>Supplier</dt>
              <dd>{po.supplierName}</dd>
              <dt>Supplier email</dt>
              <dd>{po.supplierEmail ?? "Not set"}</dd>
              <dt>Currency</dt>
              <dd>{po.currency}</dd>
              {page.total && (
                <>
                  <dt>Total cost</dt>
                  <dd>{page.total}</dd>
                </>
              )}
              <dt>Sent</dt>
              <dd>{comms.sentAt ?? "Not yet"}</dd>
              <dt>Confirmed</dt>
              <dd>{comms.confirmedAt ?? "Not yet"}</dd>
              {comms.openChase && (
                <>
                  <dt>Chasing</dt>
                  <dd>
                    Chased {comms.openChase.count} {comms.openChase.count === 1 ? "time" : "times"}
                    {comms.openChase.last ? `, last ${comms.openChase.last}` : ""}
                  </dd>
                </>
              )}
            </dl>
            {comms.canManage && <SupplierActions poId={po.id} status={po.status} hasEmail={comms.hasSupplierEmail} />}
            {page.nextStatuses.length > 0 && (
              <details>
                <summary className={ui.muted} style={{ cursor: "pointer" }}>Change the status by hand</summary>
                <div style={{ paddingTop: 10 }}>
                  <PoStatusButtons poId={po.id} options={page.nextStatuses} />
                </div>
              </details>
            )}
          </section>

          <section className={ui.listCard} aria-labelledby="po-lines">
            <h2 id="po-lines" style={{ fontSize: 16, padding: "12px 20px 0" }}>Lines</h2>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">For order</th>
                    <th scope="col">Qty</th>
                    {page.canSeeCosts && <th scope="col">Unit cost</th>}
                    <th scope="col">Needed by</th>
                    <th scope="col">Supplier confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {page.lines.map((l) => {
                    const c = confirmations.get(l.id);
                    return (
                      <tr key={l.id}>
                        <td>
                          <div className={ui.strong}>{l.description}</div>
                          {l.sku && <div className={ui.muted}>{l.sku}</div>}
                        </td>
                        <td>
                          <Link href={`/app/orders/${l.orderId}`}>{l.soNumber}</Link>
                          <div className={ui.muted}>{l.customerName}</div>
                        </td>
                        <td>{l.quantityText}</td>
                        {page.canSeeCosts && <td>{l.unitCost ?? "—"}</td>}
                        <td>{l.requested}</td>
                        <td>
                          {c?.confirmed ? (
                            <>
                              <span className="status status-ok">● {c.confirmed}</span>
                              <div className={ui.muted}>
                                {c.quantity ? `Qty ${c.quantity}` : ""}
                                {c.price ? ` · ${c.price} each` : ""}
                              </div>
                            </>
                          ) : (
                            <span className={ui.muted}>Not yet</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {comms.canManage && po.status !== "cancelled" && <PasteReplyForm poId={po.id} />}
        </div>

        <aside className={ui.aside} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className={ui.panel} aria-labelledby="answers-title">
            <h2 id="answers-title" style={{ fontSize: 16 }}>Supplier answers</h2>
            {comms.responses.length === 0 ? (
              <p className={ui.muted}>Nothing yet.</p>
            ) : (
              <ol className={ui.timeline}>
                {comms.responses.map((r) => (
                  <li key={r.id}>
                    <span className={ui.dot} aria-hidden="true" />
                    <div>
                      <div className={ui.strong}>
                        {r.status}
                        {r.needsReview && (
                          <>
                            {" · "}
                            <Link href="/app/review-queue">Review</Link>
                          </>
                        )}
                      </div>
                      <div className={ui.muted}>
                        {r.source}
                        {r.confidence ? ` · ${r.confidence}` : ""} · {r.when}
                      </div>
                      {r.reasons.length > 0 && (
                        <ul className={ui.muted} style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                          {r.reasons.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      )}
                      {r.tracking.length > 0 && <div className={ui.muted}>Tracking: {r.tracking.join(", ")}</div>}
                      {r.note && <div className={ui.muted}>Note: “{r.note}”</div>}
                      {r.reviewNote && <div className={ui.muted}>Review note: “{r.reviewNote}”</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={ui.panel} aria-labelledby="links-title">
            <h2 id="links-title" style={{ fontSize: 16 }}>Confirmation links</h2>
            {comms.links.length === 0 ? (
              <p className={ui.muted}>No link yet. Sending the PO makes one.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                {comms.links.map((l) => (
                  <li key={l.id}>
                    <span className={`status ${l.state === "Active" ? "status-ok" : "status-neutral"}`}>● {l.state}</span>
                    <div className={ui.muted}>
                      Made {l.created} · {l.state === "Active" ? `works until ${l.expires}` : `was valid until ${l.expires}`}
                      {l.opened ? ` · last opened ${l.opened}` : " · not opened yet"}
                    </div>
                    {l.state === "Active" && comms.canManage && <RevokeLinkButton poId={po.id} linkId={l.id} />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={ui.panel} aria-labelledby="emails-title">
            <h2 id="emails-title" style={{ fontSize: 16 }}>Emails</h2>
            {comms.emails.length === 0 ? (
              <p className={ui.muted}>None yet.</p>
            ) : (
              comms.emails.map((e) => (
                <details key={e.id}>
                  <summary style={{ cursor: "pointer", fontSize: 13 }}>
                    <span className={ui.strong}>{e.kind}</span> · {e.when}
                  </summary>
                  <div className={ui.muted} style={{ padding: "6px 0" }}>To {e.to} · {e.status}</div>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: 0 }}>{`Subject: ${e.subject}\n\n${e.body}`}</pre>
                </details>
              ))
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
