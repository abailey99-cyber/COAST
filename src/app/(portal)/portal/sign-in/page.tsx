import type { Metadata } from "next";
import Link from "next/link";
import styles from "../../portal.module.css";
import { CustomerSignInForm } from "./CustomerSignInForm";

export const metadata: Metadata = { title: "Customer sign in", robots: { index: false } };

export default async function CustomerSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
        <h1 style={{ fontSize: 28 }}>{add ? "Sign in to add this order" : "Sign in to see your deliveries"}</h1>
        <p className={styles.quiet}>One free COAST account shows deliveries from every business that uses COAST.</p>
        <CustomerSignInForm add={add} />
        <p className={styles.quiet}>
          No account yet? <Link href={add ? `/portal/sign-up?add=${add}` : "/portal/sign-up"}>Create a free one</Link>
        </p>
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
