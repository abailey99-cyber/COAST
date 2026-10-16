import type { Metadata } from "next";
import Link from "next/link";
import styles from "../marketing.module.css";

export const metadata: Metadata = { title: "Privacy notice", description: "How COAST handles personal data." };

// PLACEHOLDER (readiness plan Task 6): the founder is writing the legal text. These are the facts it
// must reflect; nothing here is a legal promise until the final notice replaces it.
export default function PrivacyPage() {
  return (
    <section className={styles.section} style={{ maxWidth: 820 }} aria-labelledby="privacy-title">
      <p className="notice" role="note" style={{ margin: 0 }}>
        Draft placeholder: the full privacy notice is being written. Until it&apos;s published, contact us with any questions about your data.
      </p>
      <h1 id="privacy-title" className={styles.pageTitle} style={{ color: "var(--text-strong)" }}>Privacy notice</h1>
      <div className={styles.cardBody} style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 15 }}>
        <h2 className={styles.sectionTitle}>What COAST is</h2>
        <p>
          COAST tracks orders for the businesses that use it. When you track an order from one of them, that business decides what COAST holds
          about you; COAST processes it for them.
        </p>
        <h2 className={styles.sectionTitle}>What we hold</h2>
        <p>
          For customers: the delivery details on your order, an email address if you ask for updates, messages you send about an order, and any
          delivery problem you report (with photos). If you create a COAST account: your name, email and the orders you follow. For staff of the
          businesses using COAST: name, work email and what you do in COAST.
        </p>
        <h2 className={styles.sectionTitle}>Where it&apos;s kept</h2>
        <p>
          In the EU (Ireland). The services COAST uses are on the <Link href="/sub-processors">sub-processor list</Link>.
        </p>
        <h2 className={styles.sectionTitle}>How long</h2>
        <p>Each business sets how long customer contact details and messages are kept after an order closes. Order records themselves are kept.</p>
        <h2 className={styles.sectionTitle}>Your rights</h2>
        <p>
          You can ask the business you ordered from for a copy of what it holds about you, or for it to be removed. COAST gives every business the
          tools to do that.
        </p>
        <h2 className={styles.sectionTitle}>Cookies</h2>
        <p>COAST only uses cookies it needs to work: to keep you signed in and to remember a setting you chose. There are no analytics or advertising cookies.</p>
      </div>
    </section>
  );
}
