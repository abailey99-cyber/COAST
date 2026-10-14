import Link from "next/link";
import { loadHome } from "@/server/insight";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";

export const metadata = { title: "Home" };

const LEVEL_CLASS = { none: "status-neutral", amber: "status-warn", red: "status-bad", alert: "status-bad" } as const;

/** What needs attention today (spec §5.6), showing only what this person's role can see. */
export default async function HomePage() {
  const h = await loadHome();
  const nothing = (h.waiting?.top.length ?? 0) === 0 && (h.atRisk?.count ?? 0) === 0 && (h.goodsIn?.due ?? 0) === 0 && (h.problems?.length ?? 0) === 0;

  return (
    <>
      <PageHeader title={`Hello, ${h.name}`} subtitle="What needs attention today" />

      <div className={ui.kpis}>
        {h.waiting && (
          <Link href="/app/chases?filter=overdue" className={ui.kpi} style={{ textDecoration: "none", color: "inherit" }}>
            <span className={ui.kpiLabel}>Overdue</span>
            <span className={`${ui.kpiValue} ${h.waiting.overdue ? ui.kpiValueWarn : ""}`}>{h.waiting.overdue}</span>
          </Link>
        )}
        {h.atRisk && (
          <Link href="/app/orders?view=at_risk&rep=all" className={ui.kpi} style={{ textDecoration: "none", color: "inherit" }}>
            <span className={ui.kpiLabel}>Orders at risk</span>
            <span className={`${ui.kpiValue} ${h.atRisk.count ? ui.kpiValueWarn : ""}`}>{h.atRisk.count}</span>
          </Link>
        )}
        {h.reviewCount !== null && (
          <Link href="/app/review-queue" className={ui.kpi} style={{ textDecoration: "none", color: "inherit" }}>
            <span className={ui.kpiLabel}>Answers to check</span>
            <span className={ui.kpiValue}>{h.reviewCount}</span>
          </Link>
        )}
        {h.goodsIn && (
          <Link href="/app/goods-in" className={ui.kpi} style={{ textDecoration: "none", color: "inherit" }}>
            <span className={ui.kpiLabel}>Due into the warehouse</span>
            <span className={ui.kpiValue}>{h.goodsIn.due}</span>
            {h.goodsIn.late > 0 && <span className="status status-warn">● {h.goodsIn.late} late</span>}
          </Link>
        )}
      </div>

      {nothing && (
        <section className={ui.panel}>
          <p className="status status-ok" style={{ margin: 0 }}>● Nothing needs you right now.</p>
        </section>
      )}

      <div className={ui.split}>
        {h.waiting && h.waiting.top.length > 0 && (
          <section aria-labelledby="waiting-title" className={`${ui.listCard} ${ui.main}`}>
            <h2 id="waiting-title" style={{ fontSize: 16, padding: "12px 20px 0" }}>Waiting on someone</h2>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <tbody>
                  {h.waiting.top.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={i.href} className={ui.rowLink}>{i.title}</Link>
                        {i.detail && <div className={ui.muted}>{i.detail}</div>}
                      </td>
                      <td><span className={`status ${LEVEL_CLASS[i.level]}`}>● {i.levelLabel} · {i.wait}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={ui.empty} style={{ paddingTop: 0 }}><Link href="/app/chases">Everything waiting</Link></p>
          </section>
        )}

        <div className={ui.aside} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {h.atRisk && h.atRisk.top.length > 0 && (
            <section aria-labelledby="risk-title" className={ui.panel}>
              <h2 id="risk-title" style={{ fontSize: 16 }}>At risk</h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                {h.atRisk.top.map((o) => (
                  <li key={o.id}>
                    <Link href={`/app/orders/${o.id}`} className={ui.rowLink}>{o.soNumber}</Link> <span className={ui.muted}>· {o.customer} · expected {o.predicted}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {h.problems && h.problems.length > 0 && (
            <section aria-labelledby="problems-title" className={ui.panel}>
              <h2 id="problems-title" style={{ fontSize: 16 }}>Recent problems</h2>
              <ol className={ui.timeline}>
                {h.problems.map((p) => (
                  <li key={p.id}>
                    <span className={ui.dot} aria-hidden="true" />
                    <div>
                      <div className={ui.strong}><Link href={`/app/orders/${p.orderId}`}>{p.soNumber}</Link> · {p.text}</div>
                      <div className={ui.muted}>{p.when}</div>
                    </div>
                  </li>
                ))}
              </ol>
              <Link href="/app/updates?filter=problems">All problems</Link>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
