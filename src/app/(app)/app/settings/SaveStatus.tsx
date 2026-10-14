import styles from "../shell.module.css";

/** "Saving…" / "Saved" next to an editor, announced to screen readers. */
export function SaveStatus({ pending, saved }: { pending: boolean; saved: boolean }) {
  return (
    <p className={styles.saveStatus} role="status" aria-live="polite">
      {pending ? "Saving…" : saved ? "✓ Saved" : ""}
    </p>
  );
}
