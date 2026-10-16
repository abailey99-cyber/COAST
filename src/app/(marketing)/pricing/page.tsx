import type { Metadata } from "next";
import Link from "next/link";
import { SHOW_PLANS, carriersAnswer } from "@/content/site-status";
import styles from "../marketing.module.css";

export const metadata: Metadata = { title: "Pricing", description: "COAST pricing, security and frequently asked questions." };

// Structure and approved copy from Pricing.dc.html (handoff §7.7), corrected to
// what's true today (readiness plan Task 1, decisions N1). Prices stay hidden
// until they're set: SHOW_PLANS in src/content/site-status.ts.

const PLANS = [
  { name: "Starter", band: "Up to [X] orders a month", price: "[£ PRICE]", items: ["Order tracking from PO to doorstep", "Carrier tracking and automatic chasing", "Customer tracking links", "Up to [X] team users"] },
  { name: "Growth", band: "Up to [X] orders a month", price: "[£ PRICE]", items: ["Everything in Starter", "Supplier email reading and review queue", "Customer accounts and your branding", "Supplier performance metrics", "Up to [X] team users"] },
  { name: "Scale", band: "[X]+ orders a month", price: "Let's talk", items: ["Everything in Growth", "ERP integration (NetSuite, when live)", "Director reporting view", "Unlimited team users", "Onboarding support"] },
];

const TRUST = [
  {
    title: "Supplier details are masked everywhere in COAST",
    body: "Customer pages and emails are built from a masked copy of each order that has no place for supplier names, PO numbers, costs or where a direct delivery came from. Automated tests prove it on every release.",
    note: "Carrier labels and carriers' own tracking pages are outside COAST's control, so a direct delivery's carrier link isn't shown to customers unless you switch it on.",
  },
  { title: "Leak guard", body: "Every reply your team sends a customer is checked against your supplier names and the order's PO numbers, and held back if one appears." },
  { title: "Role-based access", body: "Admin, procurement, sales and director roles are enforced in the database, not just hidden in the interface, and each company chooses who sees what." },
  { title: "Activity history on every order", body: "Each order keeps its own history: status changes, supplier answers, chases, shipments, delivery problems and customer messages, with who and when." },
  { title: "Every change recorded", body: "Changes to orders, POs, suppliers, shipments, permissions and settings are written to an audit log by the database itself: who, what and when. Admins and directors can look back through it." },
];

const FAQS = [
  { q: "Does COAST replace our ERP?", a: "No. COAST sits alongside your ERP and focuses on one job: an honest, up-to-date answer to where each order is and when it will arrive." },
  {
    q: "Do our suppliers need an account?",
    a: "No. Suppliers confirm dates from a link in the PO email. If they reply by email instead, paste the reply into COAST and it reads it for you. Reading your mailbox automatically is in development.",
  },
  {
    q: "Will customers ever see who our supplier is?",
    a: "No. Supplier names, PO numbers, costs and the origin address of direct shipments are masked everywhere in COAST, and tested on every release. Carrier labels and carriers' own tracking pages are outside COAST's control.",
  },
  { q: "What happens when COAST is not sure about an email?", a: "Anything below high confidence goes to a review queue. Nothing changes on an order until a person accepts, edits or rejects it." },
  { q: "Which carriers do you support?", a: carriersAnswer() },
  { q: "Does COAST use AI?", a: "No. Matching and date-reading are rule-based and traceable, so you can always see why COAST reached a decision." },
];

export default function PricingPage() {
  return (
    <>
      <section className={`${styles.pageHero} band-dark`} aria-labelledby="pricing-title">
        <div className={`${styles.pageHeroInner} ${styles.pageHeroCentred}`}>
          <p className="eyebrow">Pricing</p>
          <h1 id="pricing-title" className={styles.pageTitle}>Pay for the orders you track.</h1>
          <p className={styles.pageLead}>
            {SHOW_PLANS
              ? "Simple bands based on monthly order volume. Every plan includes supplier masking, the customer portal and automatic chasing."
              : "Plans will be simple bands based on monthly order volume, and every one will include supplier masking, the customer portal and automatic chasing. We're setting them with our first customers."}
          </p>
        </div>
      </section>

      {SHOW_PLANS ? (
        <section aria-label="Plans" className={styles.partner}>
          <div className={styles.cardGrid}>
            {PLANS.map((p) => (
              <div key={p.name} className={styles.card}>
                <h2 className={styles.cardTitle}>{p.name}</h2>
                <p className={styles.small}>{p.band}</p>
                <p style={{ fontSize: 36, fontWeight: 700 }}>{p.price}</p>
                <ul className={styles.ticks}>
                  {p.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <Link href="/get-coast?ref=pricing" className="btn btn-secondary" style={{ marginTop: "auto" }}>Register interest</Link>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section aria-labelledby="partner-title" className={styles.partner}>
          <div className={styles.partnerCard}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p className="eyebrow">Founding partner programme</p>
              <h2 id="partner-title" className={styles.sectionTitle}>Help us set COAST up for businesses like yours.</h2>
              <p className={styles.sectionLead}>
                We&apos;re working with a small group of founding partners on real orders before plans are published. Register interest and
                we&apos;ll be in touch.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <ul className={styles.ticks}>
                <li>Use COAST on your own orders, suppliers and customers</li>
                <li>Tell us what matters most and see it shape the roadmap</li>
                <li>Set up with you, one to one</li>
              </ul>
              <Link href="/get-coast?ref=pricing" className="btn btn-primary btn-lg" style={{ alignSelf: "flex-start" }}>Register interest</Link>
            </div>
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="trust-title" style={{ paddingTop: 96 }}>
        <div>
          <p className="eyebrow">Security &amp; trust</p>
          <h2 id="trust-title" className={styles.sectionTitleLarge}>Your suppliers stay your business.</h2>
        </div>
        <ul className={styles.cardGrid} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {TRUST.map((t) => (
            <li key={t.title} className={styles.card}>
              <h3 className={styles.cardTitle} style={{ fontSize: 16 }}>{t.title}</h3>
              <p className={styles.cardBody}>{t.body}</p>
              {t.note && <p className={styles.small}>{t.note}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.faqs} aria-labelledby="faq-title">
        <h2 id="faq-title" className={styles.sectionTitleLarge} style={{ textAlign: "center", marginBottom: 8 }}>Frequently asked questions</h2>
        {FAQS.map((f) => (
          <details key={f.q} className={styles.faq}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section className={styles.cta} aria-labelledby="cta-title">
        <div className={`${styles.ctaInner} band-dark`} style={{ background: "var(--coast-deep-sea)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 id="cta-title" style={{ fontSize: 28 }}>Ready to stop chasing?</h2>
            <p style={{ color: "var(--text-secondary)" }}>Register interest and we&apos;ll walk you through COAST.</p>
          </div>
          <Link href="/get-coast?ref=pricing" className="btn btn-primary btn-lg">Register interest</Link>
        </div>
      </section>
    </>
  );
}
