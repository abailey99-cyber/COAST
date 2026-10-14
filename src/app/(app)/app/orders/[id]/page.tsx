import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOrder } from "@/server/orders";
import { PageHeader } from "../../PageHeader";
import ui from "../../ui.module.css";
import { RaisePoForm } from "./RaisePoForm";
import { StageSelect } from "./StageSelect";

export const metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await loadOrder(id);
  if (!page) notFound();
  const { order, lines, history, can } = page;
  const poCandidates = lines.filter((l) => l.canRaisePo);

  return (
    <>
      <PageHeader title={order.soNumber} subtitle={`${order.customerName} · ${page.fulfilment} · created ${page.createdAt}`}>
        <Link href="/app/orders" className="btn btn-secondary">All orders</Link>
      </PageHeader>

      <div className={ui.split}>
        <div className={ui.main} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className={ui.panel} aria-labelledby="summary-title">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 id="summary-title" style={{ fontSize: 16 }}>Summary</h2>
              <span className="status status-neutral">● {page.statusLabel} · {page.stage}</span>
            </div>
            <dl className={ui.kv}>
              <dt>Customer</dt>
              <dd>{order.customerName}</dd>
              <dt>Their reference</dt>
              <dd>{order.customerReference ?? "—"}</dd>
              <dt>Sales rep</dt>
              <dd>{order.salesRepName ?? "Not assigned"}</dd>
              <dt>Promised</dt>
              <dd>{page.promised}</dd>
              <dt>Predicted</dt>
              <dd className={ui.muted}>Delivery-date prediction arrives in Phase 4</dd>
              <dt>Deliver to</dt>
              <dd>
                {order.delivery.name}, {order.delivery.line1}
                {order.delivery.line2 ? `, ${order.delivery.line2}` : ""}, {order.delivery.town} {order.delivery.postcode}, {order.delivery.country}
              </dd>
              <dt>Tracking code</dt>
              <dd>
                <code>{order.trackingCode}</code> <span className={ui.muted}>· the customer tracking page opens in Phase 5</span>
              </dd>
            </dl>
          </section>

          <section className={ui.listCard} aria-labelledby="lines-title">
            <h2 id="lines-title" style={{ fontSize: 16, padding: "12px 20px 0" }}>Lines</h2>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Item</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Price</th>
                    <th scope="col">Fulfilment</th>
                    <th scope="col">Stage</th>
                    {can.seeSuppliers && <th scope="col">Purchase order</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.lineNo}</td>
                      <td>
                        <div className={ui.strong}>{l.description}</div>
                        {l.sku && <div className={ui.muted}>{l.sku}</div>}
                      </td>
                      <td>{l.quantity}</td>
                      <td>{l.unitPrice}</td>
                      <td>{l.route}</td>
                      <td>
                        {l.nextStages.length > 0 ? (
                          <StageSelect lineId={l.id} lineNo={l.lineNo} current={l.stage} currentLabel={l.stageLabel} options={l.nextStages} />
                        ) : (
                          l.stageLabel
                        )}
                      </td>
                      {can.seeSuppliers && (
                        <td>
                          {l.pos.length === 0 ? (
                            <span className={ui.muted}>{l.canRaisePo ? "Needs a PO" : "—"}</span>
                          ) : (
                            l.pos.map((p) => (
                              <div key={p.id}>
                                <Link href={`/app/purchase-orders/${p.id}`} className={ui.rowLink}>{p.poNumber}</Link>{" "}
                                <span className={ui.muted}>
                                  · {p.supplierName} · {p.status}
                                  {p.unitCost ? ` · ${p.unitCost} each` : ""}
                                </span>
                              </div>
                            ))
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {poCandidates.length > 0 && (
            <RaisePoForm
              orderId={order.id}
              currency={order.currency}
              canEnterCosts={can.seeCosts}
              suppliers={page.suppliers.map((s) => ({ id: s.id, name: s.name, currency: s.currency }))}
              lines={poCandidates.map((l) => ({ id: l.id, lineNo: l.lineNo, description: l.description, quantity: l.quantityValue }))}
            />
          )}
        </div>

        <aside className={`${ui.panel} ${ui.aside}`} aria-labelledby="history-title">
          <h2 id="history-title" style={{ fontSize: 16 }}>History</h2>
          {history.length === 0 ? (
            <p className={ui.muted}>Nothing yet.</p>
          ) : (
            <ol className={ui.timeline}>
              {history.map((h, i) => (
                <li key={h.id}>
                  <span className={`${ui.dot} ${i > 0 ? ui.dotOld : ""}`} aria-hidden="true" />
                  <div>
                    <div className={ui.strong}>{h.text}</div>
                    <div className={ui.muted}>{h.who} · {h.when}</div>
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
