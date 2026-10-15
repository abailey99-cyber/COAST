import Link from "next/link";
import { loadProblems } from "@/server/problems";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";
import { LEVEL_CLASS } from "./level";

export const metadata = { title: "Delivery problems" };

type Search = Record<string, string | string[] | undefined>;

export default async function ProblemsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const data = await loadProblems({ view: typeof sp.view === "string" ? sp.view : undefined });

  return (
    <>
      <PageHeader title="Delivery problems" subtitle="Damaged, short, wrong or missing deliveries — from first report to resolution" />

      <div className={ui.kpis}>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Open</span>
          <span className={ui.kpiValue}>{data.counts.open}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Overdue</span>
          <span className={`${ui.kpiValue} ${data.counts.overdue ? ui.kpiValueWarn : ""}`}>{data.counts.overdue}</span>
        </div>
        <div className={ui.kpi}>
          <span className={ui.kpiLabel}>Carrier claims due soon</span>
          <span className={`${ui.kpiValue} ${data.counts.claimsDue ? ui.kpiValueWarn : ""}`}>{data.counts.claimsDue}</span>
        </div>
      </div>

      <section aria-label="Delivery problems" className={ui.listCard}>
        <div className={ui.toolbar}>
          {data.views.map((v) => (
            <Link key={v.value} href={`/app/problems?view=${v.value}`} className={ui.pill} aria-current={data.view === v.value ? "true" : undefined}>
              {v.label}
            </Link>
          ))}
        </div>
        {data.items.length === 0 ? (
          <p className={ui.empty}>
            {data.view === "open" ? "No open delivery problems." : data.view === "mine" ? "Nothing assigned to you." : "None here yet."} Problems arrive from customers, carriers and goods-in, or report one from an order&apos;s page.
          </p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">Problem</th>
                  <th scope="col">Order</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reported</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/app/problems/${p.id}`} className={ui.rowLink}>{p.what}</Link>
                      <div className={ui.muted}>{p.lines}{p.photos ? ` · ${p.photos} photo${p.photos === 1 ? "" : "s"}` : ""}</div>
                    </td>
                    <td>
                      {p.soNumber}
                      <div className={ui.muted}>{p.customer}</div>
                    </td>
                    <td>
                      <span className={`status ${p.open ? "status-neutral" : "status-ok"}`}>● {p.status}</span>
                      {p.claim && <div><span className={`status ${LEVEL_CLASS[p.claim.level]}`}>● {p.claim.label}</span></div>}
                    </td>
                    <td>
                      {p.via}
                      <div className={ui.muted}>{p.raised}</div>
                    </td>
                    <td>{p.owner ?? <span className={ui.muted}>Nobody yet</span>}</td>
                    <td>{p.open ? <span className={`status ${LEVEL_CLASS[p.level]}`}>● {p.levelLabel} · {p.wait}</span> : <span className={ui.muted}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={ui.empty} style={{ paddingTop: 0 }}>
          The wait restarts each time a problem moves on, and is counted in working hours with the levels in Settings → Chasing. Claim deadlines come from each carrier&apos;s claim window in Settings → Carrier connections.
        </p>
      </section>
    </>
  );
}
