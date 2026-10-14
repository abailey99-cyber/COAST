import Link from "next/link";
import { SHIPMENT_VIEWS, SHIPMENT_VIEW_LABELS, loadShipments } from "@/server/shipments";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";
import { TONE_CLASS } from "./tone";

export const metadata = { title: "Shipments" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const data = await loadShipments({ view: one(sp.view), q: one(sp.q) });
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: data.view, q: data.q || undefined, ...over })) if (v) p.set(k, v);
    return `/app/shipments?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Shipments" subtitle="Every parcel on its way, checked with the carrier for you">
        <form action="/app/shipments" method="get" role="search">
          <input type="hidden" name="view" value={data.view} />
          <label htmlFor="shipment-search" className="visually-hidden">Search shipments</label>
          <input id="shipment-search" name="q" type="search" defaultValue={data.q} placeholder="Search tracking number, order, customer…" className={ui.search} />
        </form>
      </PageHeader>

      <section aria-label="Shipment list" className={ui.listCard}>
        <div className={ui.toolbar}>
          {SHIPMENT_VIEWS.map((v) => (
            <Link key={v} href={href({ view: v })} className={ui.pill} aria-current={data.view === v ? "true" : undefined}>
              {SHIPMENT_VIEW_LABELS[v]} · {data.counts[v]}
            </Link>
          ))}
        </div>
        {data.q && (
          <p className={ui.empty} style={{ paddingTop: 0 }}>
            Showing results for “{data.q}”. <Link href={href({ q: undefined })}>Clear search</Link>
          </p>
        )}
        {data.shipments.length === 0 ? (
          <p className={ui.empty}>
            {data.q ? "No shipments match that search." : data.view === "attention" ? "Nothing needs attention." : "No shipments here yet. Add one from an order's page, or they appear when a supplier sends tracking numbers."}
          </p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">Tracking</th>
                  <th scope="col">Order</th>
                  <th scope="col">Going</th>
                  <th scope="col">Status</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Customs</th>
                  <th scope="col">Last checked</th>
                </tr>
              </thead>
              <tbody>
                {data.shipments.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/app/shipments/${s.id}`} className={ui.rowLink}>{s.trackingNumber ?? "No tracking number"}</Link>
                      <div className={ui.muted}>{s.carrierLabel}</div>
                    </td>
                    <td>
                      {s.soNumber}
                      <div className={ui.muted}>{s.customerName}</div>
                    </td>
                    <td>{s.legLabel}</td>
                    <td>
                      <span className={`status ${TONE_CLASS[s.tone]}`}>● {s.statusLabel}</span>
                      {s.manual && <div className={ui.muted}>Set by hand</div>}
                      {s.carrier === "unknown" && <div className={ui.muted}>Choose the carrier</div>}
                    </td>
                    <td>{s.status === "delivered" ? (s.delivered ? `Delivered ${s.delivered}` : "Delivered") : (s.eta ?? <span className={ui.muted}>Not known yet</span>)}</td>
                    <td>{s.customs ? <span className={`status ${TONE_CLASS[s.customs.tone]}`}>● {s.customs.label}</span> : <span className={ui.muted}>—</span>}</td>
                    <td>
                      {s.live ? (s.lastChecked ?? <span className={ui.muted}>Not yet</span>) : <span className={ui.muted}>Not checked automatically</span>}
                      {s.checkProblem && <div className={ui.fieldError}>{s.checkProblem}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.supplierLegsHidden && (
          <p className={ui.empty}>Shipments coming from suppliers are hidden, because your company doesn&apos;t show supplier details to your role.</p>
        )}
      </section>
    </>
  );
}
