import type { Metadata } from "next";
import Link from "next/link";
import { CUSTOMER_STAGES, type CustomerOrderView } from "@/lib/logic/masking";
import { formatDateTime, formatLongDate } from "@/lib/logic/format";
import { NOTIFY_LEVELS, NOTIFY_LEVEL_LABELS } from "@/lib/logic/notifications";
import { formatRange } from "@/lib/logic/prediction";
import { loadTrackingPage } from "@/server/customer-view";
import { getCustomerSession } from "@/server/customer-session";
import styles from "../../portal.module.css";
import { AddToAccount, InAccount, MessageForm, UpdatesForm } from "./CustomerForms";

// Each tracking page is private to whoever holds the code.
export const metadata: Metadata = { title: "Order tracking", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

function headline(v: CustomerOrderView): string {
  const h = v.headline;
  if (h.kind === "cancelled") return "This order has been cancelled";
  if (h.kind === "delivered") return h.from ? `Delivered ${formatLongDate(new Date(`${h.from}T12:00:00Z`), "UTC")}` : "Delivered";
  if (h.kind === "arriving" && h.from) return `Arriving ${formatLongDate(new Date(`${h.from}T12:00:00Z`), "UTC")}`;
  if (h.kind === "estimated" && h.from) return `Expected ${formatRange(h.from, h.to)}`;
  return "Delivery date to follow";
}

const PILL = { ok: styles.pillOk, warn: styles.pillWarn, neutral: styles.pillNeutral } as const;

export default async function TrackingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const account = await getCustomerSession();
  const page = await loadTrackingPage(code, account?.userId ?? null);
  const signedIn = account !== null;

  if (typeof page === "string") {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <span className={styles.brand}>Order tracking</span>
            <span className={styles.credit}>Tracking by <strong>COAST</strong></span>
          </div>
        </header>
        <main id="main" className={styles.narrow}>
          <h1 style={{ fontSize: 26 }}>{page === "slow_down" ? "Please wait a moment" : page === "unavailable" ? "Tracking isn't available right now" : "We couldn't find that order"}</h1>
          <p className={styles.quiet}>
            {page === "slow_down"
              ? "There have been too many tries from here. Please wait a few minutes and try again."
              : page === "unavailable"
                ? "Please try again later."
                : "Check the tracking code — it looks like K7Q-4M2-XP9. If the business sent you a new link, use that one."}
          </p>
          <p><Link href="/track">Enter a tracking code</Link></p>
        </main>
      </div>
    );
  }

  const v = page.view;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the business's own logo, from its settings */}
            {v.branding.logoUrl && <img src={v.branding.logoUrl} alt="" width={40} height={40} />}
            <span>{v.branding.displayName}</span>
          </div>
          <div className={styles.credit}>
            Tracking by
            <svg width="18" height="18" viewBox="0 0 120 120" aria-hidden="true">
              <path d="M50 60 L118 40 L118 80 Z" fill="var(--coast-tide-teal)" fillOpacity="0.5" />
              <path d="M88.1 38 A44 44 0 1 0 88.1 82" fill="none" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" />
              <circle cx="50" cy="60" r="14" fill="var(--coast-tide-teal)" />
            </svg>
            <strong>COAST</strong>
          </div>
        </div>
        <div className={styles.hero}>
          <div className={styles.heroMeta}>
            Order {v.soNumber}
            {v.customerReference ? ` · your ref ${v.customerReference}` : ""} · placed {formatDateTime(new Date(v.placedAt)).split(",")[0]}
          </div>
          <h1 className={styles.heroTitle}>{headline(v)}</h1>
          <div className={styles.heroStatus}>
            <span className={`${styles.pill} ${PILL[v.status.tone]}`}>● {v.status.label}</span>
            <span>Last updated {formatDateTime(new Date(v.lastUpdated))}</span>
          </div>
          {/* Top left, where it's seen first: keep this order with all their others. */}
          <div className={styles.heroAction}>
            {signedIn && page.inAccount ? (
              <InAccount />
            ) : signedIn ? (
              <AddToAccount code={page.code} />
            ) : (
              <Link href={`/portal/sign-in?add=${page.code}`} className="btn btn-primary">Add to my COAST account</Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className={styles.main}>
        <section aria-label="Progress" className={styles.card}>
          <div className={styles.bars} aria-hidden="true">
            {CUSTOMER_STAGES.map((s, i) => (
              <div key={s} className={`${styles.bar} ${v.stage !== null && i <= v.stage ? styles.barDone : ""}`} />
            ))}
          </div>
          <ol className={styles.stageNames} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {CUSTOMER_STAGES.map((s, i) => (
              <li key={s} aria-current={v.stage === i ? "step" : undefined}>
                {s}
                {v.stage !== null && i < v.stage ? <span className="visually-hidden"> (done)</span> : null}
              </li>
            ))}
          </ol>
          <p className={styles.latest}>{v.latest}</p>
        </section>

        <div className={styles.columns}>
          <section aria-labelledby="updates-title" className={`${styles.card} ${styles.wide}`}>
            <h2 id="updates-title">Updates</h2>
            <ol className={styles.timeline}>
              {v.updates.map((u) => (
                <li key={u.id}>
                  <span className={`${styles.dot} ${u.current ? styles.dotNow : ""}`} aria-hidden="true" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div className={styles.eventTitle}>
                      <span>{u.title}</span>
                      {u.badge && <span className={u.badge.kind === "carrier" ? styles.badgeCarrier : styles.badgeShipper}>{u.badge.label}</span>}
                    </div>
                    <div className={styles.eventMeta}>
                      {formatDateTime(new Date(u.at))}
                      {u.detail ? ` · ${u.detail}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className={styles.side}>
            <section aria-labelledby="order-title" className={styles.card} style={{ padding: 24 }}>
              <h2 id="order-title" style={{ fontSize: 16 }}>In this order</h2>
              {v.lines.map((l, i) => (
                <div key={i} className={styles.lineRow}>
                  <span>{l.description}</span>
                  <span className={styles.quiet}>× {l.quantity}</span>
                </div>
              ))}
              <div className={styles.divider}>
                <div className={styles.quiet} style={{ fontSize: 13 }}>Delivering to</div>
                <div>{v.deliverTo.join(", ")}</div>
              </div>
              {v.tracking.length > 0 && (
                <div className={styles.divider}>
                  <div className={styles.quiet} style={{ fontSize: 13 }}>Carrier tracking</div>
                  {v.tracking.map((t, i) => (
                    <div key={i}>
                      {t.carrier}
                      {t.trackingNumber ? " · " : ""}
                      {t.trackingUrl ? <a href={t.trackingUrl} target="_blank" rel="noopener noreferrer">{t.trackingNumber}</a> : t.trackingNumber}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="help-title" className={styles.help}>
              <h2 id="help-title">Questions about this order?</h2>
              <p>{v.repName ? `Your account manager is ${v.repName}.` : `Send ${v.branding.displayName} a message and they'll reply here.`}</p>
              {v.messages.length > 0 && (
                <ul className={styles.messages} aria-label="Messages" style={{ background: "#FFFFFF", borderRadius: 12, padding: 12, color: "var(--coast-deep-sea)" }}>
                  {v.messages.map((m) => (
                    <li key={m.id}>
                      <div className={styles.msgMeta}>{m.from === "you" ? "You" : (m.name ?? v.branding.displayName)} · {formatDateTime(new Date(m.at))}</div>
                      <div className={m.from === "you" ? styles.msgYou : styles.msgUs}>{m.body}</div>
                    </li>
                  ))}
                </ul>
              )}
              <MessageForm code={page.code} />
            </section>

            <section aria-labelledby="updates-settings-title" className={styles.card} style={{ padding: 24 }} id="updates">
              <h2 id="updates-settings-title" style={{ fontSize: 16 }}>Email updates</h2>
              <UpdatesForm
                code={page.code}
                emailHint={page.updates.emailHint}
                level={page.updates.level}
                dailyDigest={page.updates.dailyDigest}
                levels={NOTIFY_LEVELS.map((l) => ({ value: l, label: NOTIFY_LEVEL_LABELS[l] }))}
              />
            </section>

          </div>
        </div>

        <div className={styles.ctaRow}>
          {!signedIn && (
            <section className={styles.cta} aria-labelledby="cta-account">
              <h2 id="cta-account">Track all your deliveries in one place</h2>
              <p>A free COAST account shows this order, and deliveries from every other business that uses COAST, on one page — soonest first.</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Link href={`/portal/sign-up?add=${page.code}`} className="btn btn-primary">Create a free account</Link>
                <Link href={`/portal/sign-in?add=${page.code}`}>I have one — add this order</Link>
              </div>
            </section>
          )}
          <section className={styles.cta} aria-labelledby="cta-business">
            <h2 id="cta-business">Run a business?</h2>
            <p>Give your customers a page like this. COAST chases your suppliers, tracks every carrier and keeps delivery dates honest.</p>
            <div>
              <Link href={`/get-coast?ref=track${page.businessSlug ? `&b=${page.businessSlug}` : ""}`} className="btn btn-secondary">Get COAST for your business</Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
