import Link from "next/link";
import { isSectionBuilt, visibleSections } from "@/lib/logic/navigation";
import { isViewOnly } from "@/lib/logic/permissions";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/logic/roles";
import { requireStaff } from "@/server/session";
import { PageHeader } from "../PageHeader";
import styles from "../shell.module.css";

export const metadata = { title: "Home" };

// The real role-scoped "what needs attention today" view arrives in Phase 6.
export default async function HomePage() {
  const staff = await requireStaff({ section: "home" });
  const sections = visibleSections(staff.permissions).filter((s) => s.key !== "home");

  return (
    <>
      <PageHeader title={`Welcome, ${staff.fullName}`} subtitle={`${staff.orgName} · ${ROLE_LABELS[staff.role]}`} />
      <section className={styles.card} aria-labelledby="role-title">
        <h2 id="role-title" className={styles.cardTitle}>Your access</h2>
        <p className={styles.cardText}>{ROLE_DESCRIPTIONS[staff.role]}</p>
        {isViewOnly(staff.permissions) && <p className="status status-neutral">● View only</p>}
      </section>
      <section className={styles.card} aria-labelledby="build-title">
        <h2 id="build-title" className={styles.cardTitle}>What&apos;s ready</h2>
        <p className={styles.cardText}>
          COAST is being built in phases. Here’s where each screen is:
        </p>
        <ul className={styles.cardText}>
          {sections.map((s) => (
            <li key={s.key}>
              <Link href={s.href}>{s.label}</Link> {isSectionBuilt(s) ? "— ready" : `— coming in Phase ${s.phase}`}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
