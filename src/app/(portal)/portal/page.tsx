import type { Metadata } from "next";
import Link from "next/link";
import { formatIsoDate } from "@/lib/logic/format";
import { signOutCustomer } from "@/server/customer-account-actions";
import { loadPortal, type PortalOrder } from "@/server/portal";
import styles from "../portal.module.css";
import { AddOrderForm } from "./AddOrderForm";
import { OrderMenu, StopFollowing } from "./PortalActions";

export const metadata: Metadata = { title: "My deliveries", robots: { index: false } };
export const dynamic = "force-dynamic";

function OrderRow({ o, showBusiness }: { o: PortalOrder; showBusiness: boolean }) {
  return (
    <tr style={{ borderTop: "1px solid var(--divider)" }}>
      <td style={{ padding: 10 }}>
        <Link href={`/track/${o.trackingCode}`} className={styles.orderLink}>{o.soNumber}</Link>
        {o.reference && <div className={styles.quiet} style={{ fontSize: 13 }}>Your ref {o.reference}</div>}
        {showBusiness && <div className={styles.quiet} style={{ fontSize: 13 }}>{o.business}</div>}
      </td>
      <td style={{ padding: 10 }}>{o.stageLabel}</td>
      <td style={{ padding: 10 }}>
        {o.expected}
        {o.due && <div className={o.due === "Later than expected" ? styles.dueLate : styles.dueSoon}>● {o.due}</div>}
      </td>
      <td style={{ padding: 10, textAlign: "right" }}>
        <OrderMenu code={o.trackingCode} label={o.soNumber} />
      </td>
    </tr>
  );
}

function OrdersTable({ orders, showBusiness, caption }: { orders: PortalOrder[]; showBusiness: boolean; caption: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 480 }}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-secondary)", fontSize: 13 }}>
            <th scope="col" style={{ padding: "6px 10px" }}>Order</th>
            <th scope="col" style={{ padding: "6px 10px" }}>Where it is</th>
            <th scope="col" style={{ padding: "6px 10px" }}>Expected</th>
            <th scope="col" style={{ padding: "6px 10px" }}><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <OrderRow key={o.key} o={o} showBusiness={showBusiness} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PortalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const data = await loadPortal({ q: typeof sp.q === "string" ? sp.q : undefined });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}>
            <strong style={{ letterSpacing: "0.1em" }}>COAST</strong>
            <span style={{ fontWeight: 400, color: "#9fb4bc" }}>· your deliveries</span>
          </span>
          <form action={signOutCustomer} style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className={styles.credit}>{data.name}</span>
            <button type="submit" className="btn btn-secondary" style={{ minHeight: 36, background: "transparent", color: "#FFFFFF" }}>Sign out</button>
          </form>
        </div>
        <div className={styles.hero} style={{ paddingBottom: 48 }}>
          <h1 className={styles.heroTitle} style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)" }}>Everything on its way to you</h1>
          <div className={styles.heroStatus}>
            {data.total} {data.total === 1 ? "order" : "orders"} from {data.groups.length} {data.groups.length === 1 ? "supplier" : "suppliers"}
            {data.spend.length > 0 && <> · {data.spend.map((s) => s.total).join(" · ")}</>}
          </div>
        </div>
      </header>

      <main id="main" className={styles.main}>
        <form action="/portal" method="get" role="search" className={styles.card} style={{ padding: 16, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <label htmlFor="portal-q" style={{ fontSize: 14, fontWeight: 600 }}>Find an order</label>
          <input id="portal-q" name="q" type="search" defaultValue={data.q} placeholder="Your PO number, their order number, or supplier" className="input" style={{ flex: "1 1 260px" }} />
          {data.q && <Link href="/portal">Show everything</Link>}
        </form>

        {data.soon.length > 0 && (
          <section aria-labelledby="soon-title" className={styles.card}>
            <h2 id="soon-title">Arriving soon</h2>
            <p className={styles.quiet} style={{ margin: 0, fontSize: 14 }}>The next 7 days, from every supplier.</p>
            <OrdersTable orders={data.soon} showBusiness caption="Arriving in the next 7 days" />
          </section>
        )}

        {data.groups.length === 0 ? (
          <section className={styles.card}>
            <h2>{data.q ? "No orders match that" : "No orders yet"}</h2>
            <p className={styles.quiet} style={{ margin: 0 }}>
              {data.q ? "Try your PO number, the order number, or the supplier's name." : "Add an order with the tracking code from any business that uses COAST, or use “Add to my COAST account” on a tracking page."}
            </p>
          </section>
        ) : (
          data.groups.map((g) => (
            <section key={g.businessId} aria-labelledby={`sup-${g.businessId}`} className={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the business's own logo, from its settings */}
                  {g.logoUrl ? <img src={g.logoUrl} alt="" width={36} height={36} style={{ borderRadius: 8, objectFit: "contain" }} /> : <span className={styles.monogram} aria-hidden="true">{g.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}</span>}
                  <div>
                    <h2 id={`sup-${g.businessId}`} style={{ fontSize: 17 }}>{g.name}</h2>
                    <div className={styles.quiet} style={{ fontSize: 13 }}>
                      {g.open.length} on the way{g.next ? ` · next ${formatIsoDate(g.next)}` : ""}
                      {g.done.length > 0 ? ` · ${g.done.length} delivered or closed` : ""}
                    </div>
                  </div>
                </div>
                {g.automatic && <StopFollowing businessId={g.businessId} name={g.name} />}
              </div>
              {g.open.length > 0 ? <OrdersTable orders={g.open} showBusiness={false} caption={`On the way from ${g.name}`} /> : <p className={styles.quiet} style={{ margin: 0, fontSize: 14 }}>Nothing on the way.</p>}
              {g.done.length > 0 && (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 14 }}>Delivered and closed ({g.done.length})</summary>
                  <OrdersTable orders={g.done} showBusiness={false} caption={`Delivered and closed orders from ${g.name}`} />
                </details>
              )}
            </section>
          ))
        )}

        <div className={styles.columns}>
          <section className={`${styles.card} ${styles.wide}`} aria-labelledby="add-title" style={{ maxWidth: 560 }}>
            <h2 id="add-title" style={{ fontSize: 16 }}>Add an order</h2>
            <p className={styles.quiet} style={{ margin: 0, fontSize: 14 }}>Enter the tracking code from any business that uses COAST.</p>
            <AddOrderForm />
          </section>
          <aside className={styles.help} style={{ flex: "1 1 280px" }}>
            <h2>Run a business?</h2>
            <p>Give your own customers a page like this — honest delivery dates, chased suppliers, no spreadsheets.</p>
            <Link href="/get-coast?ref=portal" className="btn btn-primary">Get COAST for your business</Link>
          </aside>
        </div>
      </main>
    </div>
  );
}
