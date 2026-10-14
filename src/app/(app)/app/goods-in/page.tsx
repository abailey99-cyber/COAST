import { loadGoodsIn } from "@/server/insight";
import { PageHeader } from "../PageHeader";
import ui from "../ui.module.css";
import { GoodsInBoard } from "./GoodsInBoard";

export const metadata = { title: "Goods-in" };

export default async function GoodsInPage() {
  const data = await loadGoodsIn();

  return (
    <>
      <PageHeader title="Goods-in" subtitle="What's due into the warehouse, and checking it in" />
      {!data.canCheckIn ? (
        <section className={ui.panel}>
          <p className={ui.muted} style={{ margin: 0 }}>Your role can&apos;t check deliveries in. Ask an admin if you need to.</p>
        </section>
      ) : (
        <GoodsInBoard lines={data.lines} conditions={data.conditions} />
      )}

      {data.recent.length > 0 && (
        <section aria-labelledby="recent-title" className={ui.panel}>
          <h2 id="recent-title" style={{ fontSize: 16 }}>Recently checked in</h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            {data.recent.map((r) => (
              <li key={r.id}>
                {r.what} <span className={ui.muted}>· {r.who} · {r.when}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
