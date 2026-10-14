import Link from "next/link";
import { loadUpdates } from "@/server/insight";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";

export const metadata = { title: "Updates" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const data = await loadUpdates({ filter: one(sp.filter), before: one(sp.before) });

  return (
    <>
      <PageHeader title="Updates" subtitle="Every event on every order, newest first" />
      <section aria-label="Updates" className={ui.listCard}>
        <div className={ui.toolbar}>
          {data.filters.map((f) => (
            <Link key={f.value} href={`/app/updates?filter=${f.value}`} className={ui.pill} aria-current={data.filter === f.value ? "true" : undefined}>
              {f.label}
            </Link>
          ))}
        </div>
        {data.items.length === 0 ? (
          <p className={ui.empty}>{data.filter === "problems" ? "No problems. Nice." : "Nothing here yet."}</p>
        ) : (
          <ol className={ui.timeline} style={{ padding: "8px 20px 20px" }}>
            {data.items.map((i) => (
              <li key={i.id}>
                <span className={`${ui.dot} ${i.problem ? "" : ui.dotOld}`} aria-hidden="true" />
                <div>
                  <div className={ui.strong}>
                    <Link href={`/app/orders/${i.orderId}`} className={ui.rowLink}>{i.soNumber}</Link> · {i.text}
                    {i.problem && <> <span className="status status-warn">● Look at this</span></>}
                  </div>
                  <div className={ui.muted}>{i.who} · {i.when}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {data.before && (
          <p className={ui.empty} style={{ paddingTop: 0 }}>
            <Link href={`/app/updates?filter=${data.filter}&before=${data.before}`}>Older updates</Link>
          </p>
        )}
      </section>
    </>
  );
}
