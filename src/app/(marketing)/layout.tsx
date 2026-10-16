import Link from "next/link";
import { Lockup } from "@/components/brand/Lockup";
import styles from "./marketing.module.css";

// The header and footer only link to pages that exist (handoff §8). How it
// works and the full home page are still to come (marketing slot).
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className={`${styles.header} band-dark`}>
        <div className={styles.headerInner}>
          <Link href="/" aria-label="COAST home" className={styles.homeLink}>
            <Lockup tone="dark" />
          </Link>
          <nav aria-label="Main" style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Link href="/integrations" className={styles.navLink}>Integrations</Link>
            <Link href="/pricing" className={styles.navLink}>Pricing</Link>
            <Link href="/sign-in" className={styles.navLink}>Sign in</Link>
            <Link href="/get-coast" className="btn btn-primary">Register interest</Link>
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>© 2026 COAST Visibility Ltd</div>
      </footer>
    </>
  );
}
