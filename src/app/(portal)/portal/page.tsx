import type { Metadata } from "next";
import Link from "next/link";
import { signOutCustomer } from "@/server/customer-account-actions";
import { loadPortal } from "@/server/portal";
import styles from "../portal.module.css";
import { AddOrderForm } from "./AddOrderForm";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PortalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const data = await loadPortal({ q: typeof sp.q === "string" ? sp.q : undefined });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}>My orders</span>
          <form action={signOutCustomer} style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className={styles.credit}>{data.name}</span>
            <button type="submit" className="btn btn-secondary" style={{ minHeight: 36, background: "transparent", color: "#FFFFFF" }}>Sign out</button>
          </form>
        </div>
        <div className={styles.hero} style={{ paddingBottom: 48 }}>
          <h1 className={styles.heroTitle} style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)" }}>Your orders</h1>
          <div className={styles.heroStatus}>
            {data.total} {data.total === 1 ? "order" : "orders"}
            {data.spend.length > 0 && <> · spend {data.spend.map((s) => s.total).join(" · ")}</>}
          </div>
        </div>
      </header>
      <main id="main" className={styles.main}>
        <section className={styles.card} aria-labelledby="orders-title">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <h2 id="orders-title">Orders</h2>
            <form action="/portal" method="get" role="search" style={{ display: "flex", gap: 8 }}>
              <label htmlFor="portal-q" className="visually-hidden">Search by your PO number or our order number</label>
              <input id="portal-q" name="q" type="search" defaultValue={data.q} placeholder="Your PO number or order number" className="input" style={{ minWidth: 240 }} />
            </form>
          </div>
          {data.q && (
            <p className={styles.quiet} style={{ margin: 0 }}>
              Showing results for “{data.q}”. <Link href="/portal">Show all</Link>
            </p>
          )}
          {data.orders.length === 0 ? (
            <p className={styles.quiet}>{data.q ? "No orders match that." : "No orders yet. Add one with its tracking code below."}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 520 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                    <th scope="col" style={{ padding: "8px 10px" }}>Order</th>
                    <th scope="col" style={{ padding: "8px 10px" }}>Your reference</th>
                    <th scope="col" style={{ padding: "8px 10px" }}>Placed</th>
                    <th scope="col" style={{ padding: "8px 10px" }}>Where it is</th>
                    <th scope="col" style={{ padding: "8px 10px" }}>Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.soNumber} style={{ borderTop: "1px solid var(--divider)" }}>
                      <td style={{ padding: 10 }}><Link href={`/track/${o.trackingCode}`}>{o.soNumber}</Link></td>
                      <td style={{ padding: 10 }}>{o.reference ?? "—"}</td>
                      <td style={{ padding: 10 }}>{o.placed}</td>
                      <td style={{ padding: 10 }}>{o.stage}</td>
                      <td style={{ padding: 10 }}>{o.expected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className={styles.card} aria-labelledby="add-title" style={{ maxWidth: 520 }}>
          <h2 id="add-title" style={{ fontSize: 16 }}>Add an order</h2>
          <p className={styles.quiet} style={{ margin: 0, fontSize: 14 }}>Enter the tracking code from your order confirmation.</p>
          <AddOrderForm />
        </section>
      </main>
    </div>
  );
}
