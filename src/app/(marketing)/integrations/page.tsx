import type { Metadata } from "next";
import Link from "next/link";
import { CARRIERS, RECENTLY_ADDED, ROADMAP, STATUS_LABELS, SYSTEMS, checkSiteStatus } from "@/content/site-status";
import styles from "../marketing.module.css";
import { StatusPill } from "../StatusPill";

export const metadata: Metadata = { title: "Integrations", description: "What COAST connects to today, what's coming next, and what's on the roadmap." };

// Refuse to build a page that would call something Live that isn't (handoff §8).
const problems = checkSiteStatus();
if (problems.length > 0) throw new Error(`Website status config: ${problems.join("; ")}`);

// Approved structure and copy from Integrations.dc.html (handoff §7.6), with statuses from the config.
export default function IntegrationsPage() {
  const anyCarrierLive = CARRIERS.some((c) => c.status === "live");
  return (
    <>
      <section className={`${styles.pageHero} band-dark`} aria-labelledby="integrations-title">
        <div className={styles.pageHeroInner}>
          <p className="eyebrow">Integrations</p>
          <h1 id="integrations-title" className={styles.pageTitle}>Works with the carriers and systems you already use.</h1>
          <p className={styles.pageLead}>
            Here&apos;s what COAST connects to today, what&apos;s coming next, and what&apos;s on the roadmap. Every status is honest. If it&apos;s not
            live, we say so.
          </p>
          <div className={styles.legend} aria-label="Status key">
            <span className={`${styles.legendPill} status status-ok`}>● {STATUS_LABELS.live}</span>
            <span className={`${styles.legendPill} status status-neutral`}>● {STATUS_LABELS.beta}</span>
            <span className={`${styles.legendPill} status status-warn`}>● {STATUS_LABELS.in_development}</span>
            <span className={`${styles.legendPill} status status-neutral`}>● {STATUS_LABELS.planned}</span>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="carriers-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="carriers-title" className={styles.sectionTitle}>Carrier tracking</h2>
            <p className={styles.sectionLead}>
              {anyCarrierLive
                ? "Live status pulled automatically, with a health check on every connection."
                : "Connections are built and being verified against real carrier accounts. Until then, shipments can be updated by hand."}
            </p>
          </div>
        </div>
        <ul className={styles.tileGrid} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {CARRIERS.map((c) => (
            <li key={c.key} className={styles.tile}>
              <span className={styles.mono} aria-hidden="true">{c.mono}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className={styles.tileName}>{c.name}</span>
                <span className={styles.tileNote}>{c.note}</span>
                <StatusPill item={c} />
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.small}>
          A carrier shows as Live only once it has been seen working on a real account. COAST shows each connection&apos;s health in the app rather
          than overstating it.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="systems-title">
        <h2 id="systems-title" className={styles.sectionTitle}>Systems, email and suppliers</h2>
        <ul className={styles.cardGrid} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {SYSTEMS.map((s) => (
            <li key={s.key} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.mono} aria-hidden="true">{s.mono}</span>
                <StatusPill item={s} />
              </div>
              <h3 className={styles.cardTitle}>{s.name}</h3>
              <p className={styles.cardBody}>{s.note}</p>
            </li>
          ))}
          <li style={{ display: "flex" }}>
            <Link href="/get-coast?ref=integration" className={`${styles.card} ${styles.cardDark}`} style={{ flex: 1 }}>
              <span className={styles.cardTitle}>Need something else?</span>
              <span className={styles.cardBody}>Tell us which ERP, WMS or carrier you use. Requests shape the roadmap.</span>
              <span style={{ marginTop: "auto", fontSize: 14, fontWeight: 600, color: "var(--coast-accent-soft)" }}>Request an integration →</span>
            </Link>
          </li>
        </ul>
      </section>

      <section className={`${styles.section} ${styles.sectionLast}`} aria-labelledby="roadmap-title">
        <div>
          <p className="eyebrow">Roadmap</p>
          <h2 id="roadmap-title" className={styles.sectionTitleLarge}>What&apos;s coming to COAST</h2>
        </div>
        <div className={styles.columns}>
          <div className={styles.column}>
            <h3 className={`${styles.columnHead} status status-ok`}>● Recently added</h3>
            {RECENTLY_ADDED.map((i) => (
              <div key={i.name} className={styles.roadItem}>
                <span className={styles.roadName}>{i.name}</span>
                <span className={styles.roadNote}>{i.note}</span>
              </div>
            ))}
          </div>
          {ROADMAP.map((col, n) => (
            <div key={col.heading} className={styles.column}>
              <h3 className={`${styles.columnHead} status ${n === 0 ? "status-warn" : "status-neutral"}`}>● {col.heading}</h3>
              {col.items.map((i) => (
                <div key={i.name} className={styles.roadItem}>
                  <span className={styles.roadName}>{i.name}</span>
                  <span className={styles.roadNote}>{i.note}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className={styles.small}>Roadmap items are plans, not promises. Timings may change.</p>
      </section>
    </>
  );
}
