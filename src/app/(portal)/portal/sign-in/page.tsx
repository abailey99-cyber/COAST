import type { Metadata } from "next";
import Link from "next/link";
import styles from "../../portal.module.css";
import { CustomerSignInForm } from "./CustomerSignInForm";

export const metadata: Metadata = { title: "Customer sign in", robots: { index: false } };

export default function CustomerSignInPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}>Customer account</span>
          <span className={styles.credit}>Tracking by <strong>COAST</strong></span>
        </div>
      </header>
      <main id="main" className={styles.narrow}>
        <h1 style={{ fontSize: 28 }}>Sign in to see your orders</h1>
        <p className={styles.quiet}>For customers of businesses that use COAST. Your account is set up by the business you order from.</p>
        <CustomerSignInForm />
        <p className={styles.quiet}>
          <Link href="/sign-in/forgotten">Forgotten your password?</Link> · <Link href="/track">Track one order with a code</Link>
        </p>
        <p className={styles.quiet} style={{ fontSize: 13 }}>
          Work at a business that uses COAST? <Link href="/sign-in">Team sign-in</Link>
        </p>
      </main>
    </div>
  );
}
