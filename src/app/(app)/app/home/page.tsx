import Link from "next/link";
import { sectionsForRole } from "@/lib/logic/navigation";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, isReadOnlyRole } from "@/lib/logic/roles";
import { requireStaff } from "@/server/session";
import { PageHeader } from "../PageHeader";
import styles from "../shell.module.css";

export const metadata = { title: "Home" };

// The real role-scoped "what needs attention today" view arrives in Phase 6.
export default async function HomePage() {
  const staff = await requireStaff({ section: "home" });
  const sections = sectionsForRole(staff.role).filter((s) => s.key !== "home");

  return (
    <>
      <PageHeader title={`Welcome, ${staff.fullName}`} subtitle={`${staff.orgName} · ${ROLE_LABELS[staff.role]}`} />
      <section className={styles.card} aria-labelledby="role-title">
        <h2 id="role-title" className={styles.cardTitle}>Your access</h2>
        <p className={styles.cardText}>{ROLE_DESCRIPTIONS[staff.role]}</p>
        {isReadOnlyRole(staff.role) && <p className="status status-neutral">● Read-only</p>}
      </section>
      <section className={styles.card} aria-labelledby="build-title">
        <h2 id="build-title" className={styles.cardTitle}>What&apos;s ready</h2>
        <p className={styles.cardText}>
          COAST is being built in phases. Signing in, your team and the connection status in Settings work now. These
          screens are coming next:
        </p>
        <ul className={styles.cardText}>
          {sections.map((s) => (
            <li key={s.key}>
              <Link href={s.href}>{s.label}</Link> {s.phase > 0 ? `— Phase ${s.phase}` : "— available"}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
