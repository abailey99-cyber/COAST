import type { Metadata } from "next";
import Link from "next/link";
import styles from "../../portal.module.css";
import { CustomerSignUpForm } from "./CustomerSignUpForm";

export const metadata: Metadata = { title: "Create a customer account", robots: { index: false } };

export default function CustomerSignUpPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}>Customer account</span>
          <span className={styles.credit}>Tracking by <strong>COAST</strong></span>
        </div>
      </header>
      <main id="main" className={styles.narrow}>
        <h1 style={{ fontSize: 28 }}>See all your orders in one place</h1>
        <p className={styles.quiet}>
          Create an account with the tracking code from any order. That order is added straight away, and you can add more
          with their codes.
        </p>
        <CustomerSignUpForm />
        <p className={styles.quiet}>
          Already have an account? <Link href="/portal/sign-in">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
