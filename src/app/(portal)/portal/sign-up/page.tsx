import type { Metadata } from "next";
import Link from "next/link";
import styles from "../../portal.module.css";
import { CustomerSignUpForm } from "./CustomerSignUpForm";

export const metadata: Metadata = { title: "Create a customer account", robots: { index: false } };

export default async function CustomerSignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const add = typeof sp.add === "string" ? sp.add.slice(0, 20) : "";
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}>Customer account</span>
          <span className={styles.credit}>Tracking by <strong>COAST</strong></span>
        </div>
      </header>
      <main id="main" className={styles.narrow}>
        <h1 style={{ fontSize: 28 }}>Track all your deliveries in one place</h1>
        <p className={styles.quiet}>
          One free COAST account for deliveries from every business that uses COAST, soonest first. Add orders with their
          tracking codes, or with one click on any tracking page.
        </p>
        <CustomerSignUpForm add={add} />
        <p className={styles.quiet}>
          Already have an account? <Link href={add ? `/portal/sign-in?add=${add}` : "/portal/sign-in"}>Sign in</Link>
        </p>
      </main>
    </div>
  );
}
