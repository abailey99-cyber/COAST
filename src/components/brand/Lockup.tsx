import Image from "next/image";
import styles from "./Lockup.module.css";

/**
 * The COAST horizontal lockup (handoff §3): the supplied mark SVG, never
 * redrawn, then "COAST" over "VISIBILITY".
 *
 * tone="auto" follows the surrounding data-theme / .band-dark;
 * "dark" forces the reversed (white ring) mark for Deep Sea headers.
 */
export function Lockup({ tone = "auto", size = "nav" }: { tone?: "auto" | "light" | "dark"; size?: "nav" | "large" }) {
  const markSize = size === "large" ? 56 : 40;
  return (
    <span className={`${styles.lockup} ${styles[size]}`} data-tone={tone}>
      <Image className={styles.markLight} src="/brand/coast-mark.svg" alt="" width={markSize} height={markSize} priority />
      <Image className={styles.markDark} src="/brand/coast-mark-white.svg" alt="" width={markSize} height={markSize} priority />
      <span className={styles.words}>
        <span className={styles.name}>COAST</span>
        <span className={styles.sub}>VISIBILITY</span>
      </span>
    </span>
  );
}
