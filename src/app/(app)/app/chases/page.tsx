import Link from "next/link";
import { WAITING_ON_LABELS } from "@/lib/logic/feed";
import { loadWaiting } from "@/server/insight";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";

export const metadata = { title: "Chases" };

const LEVEL_CLASS = { none: "status-neutral", amber: "status-warn", red: "status-bad", alert: "status-bad" } as const;

type Search = Record<string, string | string[] | undefined>;

export default async function ChasesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const data = await loadWaiting({ filter: typeof sp.filter === "string" ? sp.filter : undefined });
  const pills = [
    { value: "all", label: `Everything · ${data.counts.supplier + data.counts.procurement + data.counts.us + data.counts.carrier + data.counts.customer}` },
    { value: "overdue", label: `Overdue · ${data.counts.overdue}` },
    { value: "supplier", label: `${WAITING_ON_LABELS.supplier} · ${data.counts.supplier}` },
    { value: "procurement", label: `${WAITING_ON_LABELS.procurement} · ${data.counts.procurement}` },
    { value: "us", label: `Customers waiting on us · ${data.counts.us}` },
    { value: "carrier", label: `${WAITING_ON_LABELS.carrier} · ${data.counts.carrier}` },
    { value: "customer", label: `${WAITING_ON_LABELS.customer} · ${data.counts.customer}` },
  ];

  return (
    <>
      <PageHeader title="Chases" subtitle="Everything waiting on someone, most overdue first" />
      <section aria-label="Waiting" className={ui.listCard}>
        <div className={ui.toolbar}>
          {pills.map((p) => (
            <Link key={p.value} href={`/app/chases?filter=${p.value}`} className={ui.pill} aria-current={data.filter === p.value ? "true" : undefined}>
              {p.label}
            </Link>
          ))}
        </div>
        {data.items.length === 0 ? (
          <p className={ui.empty}>Nothing waiting here.</p>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Waiting on</th>
                  <th scope="col">How long</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={i.href} className={ui.rowLink}>{i.title}</Link>
                      {i.detail && <div className={ui.muted}>{i.detail}</div>}
                    </td>
                    <td>{WAITING_ON_LABELS[i.waitingOn]}</td>
                    <td><span className={`status ${LEVEL_CLASS[i.level]}`}>● {i.levelLabel} · {i.wait}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={ui.empty} style={{ paddingTop: 0 }}>
          Counted in working hours, with the overdue levels set in Settings → Chasing.
        </p>
      </section>
    </>
  );
}
