import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/logic/theme";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./shell.module.css";

export async function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageTitles}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      <div className={styles.pageActions}>
        <ThemeToggle initial={theme} />
        {children}
      </div>
    </div>
  );
}
