import Link from "next/link";
import { ORDER_VIEWS, ORDER_VIEW_LABELS } from "@/lib/logic/order-list";
import { loadOrder, loadOrders } from "@/server/orders";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";
import { RepFilterSelect } from "./RepFilterSelect";

export const metadata = { title: "Orders" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const STATUS_CLASS = { open: "status-neutral", delivered: "status-neutral", cancelled: "status-neutral" } as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const data = await loadOrders({ view: one(sp.view), q: one(sp.q), rep: one(sp.rep) });
  const selectedId = one(sp.selected);
  const selected = selectedId ? await loadOrder(selectedId) : null;

  const repParam = data.repFilter === "mine" || data.repFilter === "all" ? data.repFilter : data.repFilter.repId;
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view: data.view, q: data.q || undefined, rep: repParam, selected: selectedId, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/app/orders?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order from PO to doorstep">
        <form action="/app/orders" method="get" role="search">
          <input type="hidden" name="view" value={data.view} />
          <input type="hidden" name="rep" value={repParam} />
          <label htmlFor="order-search" className="visually-hidden">Search orders</label>
          <input id="order-search" name="q" type="search" defaultValue={data.q} placeholder="Search order, customer, PO…" className={ui.search} />
        </form>
        {data.canCreate && <Link href="/app/orders/new" className="btn btn-primary">New order</Link>}
      </PageHeader>

      <div className={ui.kpis}>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Open orders</span>
          <span className={ui.kpiValue}>{data.kpis.open}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Awaiting supplier</span>
          <span className={ui.kpiValue}>{data.kpis.awaitingSupplier}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Need a purchase order</span>
          <span className={`${ui.kpiValue} ${data.kpis.needsPo ? ui.kpiValueWarn : ""}`}>{data.kpis.needsPo}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>At risk</span>
          <span className={`${ui.kpiValue} ${data.kpis.atRisk ? ui.kpiValueWarn : ""}`}>{data.kpis.atRisk}</span>
        </div>
      </div>

      <div className={ui.split}>
        <section aria-label="Order list" className={`${ui.listCard} ${ui.main}`}>
          <div className={ui.toolbar}>
            {ORDER_VIEWS.map((v) => (
              <Link key={v} href={href({ view: v, selected: undefined })} className={ui.pill} aria-current={data.view === v ? "true" : undefined}>
                {ORDER_VIEW_LABELS[v]}
              </Link>
            ))}
            <span className={ui.spacer} />
            {data.canSeeAllOrders && <RepFilterSelect value={repParam} reps={data.reps} view={data.view} q={data.q} />}
          </div>
          {data.q && (
            <p className={ui.empty} style={{ paddingTop: 0 }}>
              Showing results for “{data.q}”. <Link href={href({ q: undefined, selected: undefined })}>Clear search</Link>
            </p>
          )}
          {data.rows.length === 0 ? (
            <p className={ui.empty}>
              {data.q ? "No orders match that search." : data.repFilter === "mine" ? "You have no orders here yet." : "No orders here yet."}
              {data.canCreate && !data.q && (
                <>
                  {" "}
                  <Link href="/app/orders/new">Create one</Link>.
                </>
              )}
            </p>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Fulfilment</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Promised</th>
                    <th scope="col">Predicted</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} aria-selected={r.id === selectedId ? "true" : undefined}>
                      <td>
                        <Link href={href({ selected: r.id })} className={ui.rowLink} scroll={false}>{r.soNumber}</Link>
                        {r.customerReference && <div className={ui.muted}>Ref {r.customerReference}</div>}
                      </td>
                      <td>
                        {r.customerName}
                        {r.salesRepName && <div className={ui.muted}>{r.salesRepName}</div>}
                      </td>
                      <td>{r.fulfilment}</td>
                      <td>{r.stage}</td>
                      <td>{r.promised}</td>
                      <td>
                        {r.predicted}
                        {r.predictedEstimate && <div className={ui.muted}>Estimate</div>}
                      </td>
                      <td>
                        {r.atRisk ? <span className="status status-warn">● At risk</span> : <span className={`status ${STATUS_CLASS[r.status]}`}>● {r.statusLabel}</span>}
                        {r.newMessages > 0 && <div className="status status-warn">● {r.newMessages} new {r.newMessages === 1 ? "message" : "messages"}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.truncated && <p className={ui.empty}>Showing the newest 500 orders. Search to find older ones.</p>}
        </section>

        {selected && (
          <aside aria-label="Selected order" className={`${ui.panel} ${ui.aside}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={{ fontSize: 16 }}>{selected.order.soNumber}</h2>
              <span className="status status-neutral">● {selected.statusLabel}</span>
            </div>
            <dl className={ui.kv}>
              <dt>Customer</dt>
              <dd>{selected.order.customerName}</dd>
              <dt>Stage</dt>
              <dd>{selected.stage}</dd>
              <dt>Promised</dt>
              <dd>{selected.promised}</dd>
              <dt>Predicted</dt>
              <dd>
                {selected.prediction?.label ?? "Not known yet"}
                {selected.prediction?.atRisk && <> · <span className="status status-warn">● At risk</span></>}
                {selected.prediction?.estimate && <div className={ui.muted}>Estimate · {selected.prediction.reason}</div>}
              </dd>
            </dl>
            <ol className={ui.timeline} aria-label="History">
              {selected.history.slice(0, 5).map((h, i) => (
                <li key={h.id}>
                  <span className={`${ui.dot} ${i > 0 ? ui.dotOld : ""}`} aria-hidden="true" />
                  <div>
                    <div className={ui.strong}>{h.text}</div>
                    <div className={ui.muted}>{h.who} · {h.when}</div>
                  </div>
                </li>
              ))}
            </ol>
            <Link href={`/app/orders/${selected.order.id}`} className="btn btn-secondary">Open order</Link>
          </aside>
        )}
      </div>
    </>
  );
}
