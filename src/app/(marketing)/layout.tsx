import Link from "next/link";
import { Lockup } from "@/components/brand/Lockup";
import styles from "./marketing.module.css";

// The full marketing site (handoff §7.3–7.8) is a later slot. Until then the
// header and footer only link to pages that exist (handoff §8).
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className={`${styles.header} band-dark`}>
        <div className={styles.headerInner}>
          <Link href="/" aria-label="COAST home" className={styles.homeLink}>
            <Lockup tone="dark" />
          </Link>
          <nav aria-label="Main">
            <Link href="/sign-in" className={styles.navLink}>Sign in</Link>
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
