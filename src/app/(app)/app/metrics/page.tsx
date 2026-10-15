import { loadMetrics } from "@/server/insight";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";

export const metadata = { title: "Metrics" };

const pct = (n: number | null) => (n === null ? "Not enough data yet" : `${n}%`);

export default async function MetricsPage() {
  const m = await loadMetrics();
  const o = m.orders;

  return (
    <>
      <PageHeader title="Metrics" subtitle={`Orders and suppliers over the last ${m.periodDays} days`} />

      <div className={ui.kpis}>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Open orders</span>
          <span className={ui.kpiValue}>{o.open}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>At risk</span>
          <span className={`${ui.kpiValue} ${o.atRisk ? ui.kpiValueWarn : ""}`}>{o.atRisk}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Delivered</span>
          <span className={ui.kpiValue}>{o.delivered}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Delivered on time</span>
          {o.onTime.percent === null ? (
            <span className={ui.kpiPending}>Not enough data yet: needs delivered orders with a promised date.</span>
          ) : (
            <>
              <span className={ui.kpiValue}>{o.onTime.percent}%</span>
              <span className={ui.muted}>{o.onTime.onTime} of {o.onTime.measured} with a promised date</span>
            </>
          )}
        </div>
      </div>

      {m.suppliers === null ? (
        <section className={ui.panel}>
          <p className={ui.muted} style={{ margin: 0 }}>Supplier figures are hidden because your company doesn&apos;t show supplier details to your role.</p>
        </section>
      ) : (
        <section aria-labelledby="suppliers-title" className={ui.listCard}>
          <h2 id="suppliers-title" style={{ fontSize: 16, padding: "12px 20px 0" }}>Supplier reliability</h2>
          {m.suppliers.length === 0 ? (
            <p className={ui.empty}>No purchase orders in this period.</p>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">Supplier</th>
                    <th scope="col">POs</th>
                    <th scope="col">Answered</th>
                    <th scope="col">Typical time to answer</th>
                    <th scope="col">Arrived by their date</th>
                    <th scope="col">Real lead time</th>
                  </tr>
                </thead>
                <tbody>
                  {m.suppliers.map((s) => (
                    <tr key={s.supplierId}>
                      <td className={ui.strong}>{s.supplierName}</td>
                      <td>{s.pos}</td>
                      <td>{pct(s.respondedPercent)}</td>
                      <td>{s.responseLabel}</td>
                      <td>
                        {pct(s.onTimePercent)}
                        {s.arrivalsMeasured > 0 && <div className={ui.muted}>{s.arrivalsMeasured} measured</div>}
                      </td>
                      <td>
                        {s.medianActualLeadDays === null ? <span className={ui.muted}>Not enough data yet</span> : `${s.medianActualLeadDays} working days`}
                        {s.typicalLeadDays !== null && <div className={ui.muted}>They say {s.typicalLeadDays}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {m.spend && (
        <section aria-labelledby="spend-title" className={ui.panel}>
          <h2 id="spend-title" style={{ fontSize: 16 }}>Spend by supplier</h2>
          {m.spend.length === 0 ? (
            <p className={ui.muted} style={{ margin: 0 }}>No costs recorded in this period.</p>
          ) : (
            m.spend.map((c) => (
              <div key={c.currency} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className={ui.strong}>{c.total} in {c.currency}{c.top ? ` · ${c.top}` : ""}</div>
                {c.rows.map((r) => (
                  <div key={r.name} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 3fr auto", gap: 12, alignItems: "center", fontSize: 13 }}>
                    <span>{r.name}</span>
                    <span aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "var(--divider)" }}>
                      <span style={{ display: "block", height: 8, borderRadius: 4, width: `${r.percent}%`, background: "var(--coast-tide-teal)" }} />
                    </span>
                    <span>{r.amount} · {r.percent}%</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </section>
      )}

      {m.reading && (
        <section aria-labelledby="reading-title" className={ui.panel}>
          <h2 id="reading-title" style={{ fontSize: 16 }}>How supplier answers came in</h2>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Answers</th>
                  <th scope="col">Applied automatically</th>
                  <th scope="col">Accepted after review</th>
                  <th scope="col">Not relevant</th>
                  <th scope="col">Waiting for review</th>
                </tr>
              </thead>
              <tbody>
                {m.reading.map((r) => (
                  <tr key={r.source}>
                    <td>{r.source === "email" ? "Emails (pasted or received)" : "Confirmation links"}</td>
                    <td>{r.total}</td>
                    <td>{r.automatic}{r.automaticPercent !== null ? ` (${r.automaticPercent}%)` : ""}</td>
                    <td>{r.reviewedAccepted}</td>
                    <td>{r.notRelevant}</td>
                    <td>{r.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {m.problemRates && (
        <section aria-labelledby="problem-rates-title" className={ui.panel}>
          <h2 id="problem-rates-title" style={{ fontSize: 16 }}>Delivery problems</h2>
          <p className={ui.muted} style={{ margin: 0 }}>
            {m.problemRates.total} reported in this period. Rates are problems per 100 delivered; under 5 deliveries there isn&apos;t enough to tell.
          </p>
          <RateTable title="By carrier" rows={m.problemRates.byCarrier} unit="Shipments delivered" />
          {m.problemRates.bySupplier && <RateTable title="By supplier" rows={m.problemRates.bySupplier} unit="Lines delivered" />}
        </section>
      )}
    </>
  );
}

function RateTable({ title, rows, unit }: { title: string; rows: { key: string; name: string; delivered: number; problems: number; ratePercent: number | null }[]; unit: string }) {
  if (rows.length === 0) return <p className={ui.muted} style={{ margin: 0 }}>{title}: nothing delivered in this period.</p>;
  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <caption style={{ textAlign: "left", fontWeight: 600, padding: "4px 0" }}>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">{unit}</th>
            <th scope="col">Problems</th>
            <th scope="col">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={ui.strong}>{r.name}</td>
              <td>{r.delivered}</td>
              <td>{r.problems}</td>
              <td>{pct(r.ratePercent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
