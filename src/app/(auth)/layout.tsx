import Link from "next/link";
import { Lockup } from "@/components/brand/Lockup";
import styles from "./auth.module.css";

// Shared frame for sign-in and password screens (SignIn.dc.html): Deep Sea
// page, lockup and "Back to website" header, white card.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="COAST home" className={styles.plainLink}>
          <Lockup tone="dark" />
        </Link>
        <Link href="/" className={styles.back}>← Back to website</Link>
      </header>
      <main className={styles.main} data-theme="light">
        <div className={styles.card}>{children}</div>
      </main>
    </div>
  );
}
