import type { Metadata } from "next";
import Link from "next/link";
import styles from "../portal.module.css";
import { TrackForm } from "./TrackForm";

export const metadata: Metadata = { title: "Track an order", robots: { index: false } };

/** Enter a tracking code (decision E4: the code alone is enough). */
export default function TrackPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}>Track an order</span>
          <span className={styles.credit}>Tracking by <strong>COAST</strong></span>
        </div>
      </header>
      <main id="main" className={styles.narrow}>
        <h1 style={{ fontSize: 28 }}>Where&apos;s my order?</h1>
        <p className={styles.quiet}>Ordered from a business that uses COAST? Enter the tracking code they gave you. No account needed.</p>
        <TrackForm />
        <p className={styles.quiet}>Have a customer account? <Link href="/portal/sign-in">Sign in</Link> to see all your orders.</p>
      </main>
    </div>
  );
}
