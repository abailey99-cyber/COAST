import { getSection, type SectionKey } from "@/lib/logic/navigation";
import { requireStaff } from "@/server/session";
import { PageHeader } from "./PageHeader";
import styles from "./shell.module.css";

/**
 * Stand-in for a section that hasn't been built yet. Still role-guarded, and
 * says plainly when it arrives rather than looking finished (spec §2, "gaps
 * are disclosed").
 */
export async function SectionPlaceholder({ section, subtitle }: { section: SectionKey; subtitle?: string }) {
  await requireStaff({ section });
  const s = getSection(section);
  return (
    <>
      <PageHeader title={s.label} subtitle={subtitle} />
      <section className={styles.card} aria-label={`${s.label} status`}>
        <p className="status status-neutral">● Not built yet</p>
        <p className={styles.cardText}>This screen arrives in Phase {s.phase} of the build.</p>
      </section>
    </>
  );
}
