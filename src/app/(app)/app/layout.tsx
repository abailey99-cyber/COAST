import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Lockup } from "@/components/brand/Lockup";
import { canAccessSection, visibleSections } from "@/lib/logic/navigation";
import { hasPermission } from "@/lib/logic/permissions";
import { ROLE_LABELS } from "@/lib/logic/roles";
import { THEME_COOKIE, parseTheme } from "@/lib/logic/theme";
import { signOut } from "@/server/auth-actions";
import { requireStaff } from "@/server/session";
import { carrierSummary } from "@/server/shipments";
import { reviewQueueCount } from "@/server/supplier-loop";
import { SidebarNav } from "./SidebarNav";
import styles from "./shell.module.css";

// Every staff page depends on who is signed in — never prerender one.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { default: "COAST", template: "%s · COAST" }, robots: { index: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const reviewCount = await reviewQueueCount(canAccessSection(staff.permissions, "review-queue") && hasPermission(staff.permissions, "supplier.identity.view"));
  const carriers = canAccessSection(staff.permissions, "settings") ? await carrierSummary() : null;
  const sections = visibleSections(staff.permissions).map(({ key, label, href }) => ({ key, label, href, badge: key === "review-queue" && reviewCount > 0 ? reviewCount : undefined }));

  return (
    <div className={styles.shell} data-theme={theme} data-app-theme>
      <a className="skip-link" href="#main">Skip to content</a>
      <nav aria-label="Main" className={styles.sidebar}>
        <div className={styles.brand}>
          <Lockup />
        </div>
        <SidebarNav sections={sections} />
        {carriers && carriers.healthy + carriers.check > 0 && (
          <Link href="/app/settings" className={styles.carrierCard}>
            <div className={styles.userName}>Carrier connections</div>
            <span className="status status-ok">● {carriers.healthy} healthy</span>
            {carriers.check > 0 && <> · <span className="status status-warn">● {carriers.check} to check</span></>}
          </Link>
        )}
        <div className={styles.userCard}>
          <div className={styles.userName}>{staff.fullName}</div>
          <div className={styles.userMeta}>
            {ROLE_LABELS[staff.role]} · {staff.orgName}
          </div>
          <form action={signOut}>
            <button type="submit" className={styles.signOut}>Sign out</button>
          </form>
        </div>
      </nav>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
