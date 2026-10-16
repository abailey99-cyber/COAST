import { statusText, type Integration, type SiteStatus } from "@/content/site-status";
import styles from "./marketing.module.css";

const TONE: Record<SiteStatus, string> = { live: "status-ok", beta: "status-neutral", in_development: "status-warn", planned: "status-neutral" };

/** A website status pill, always from src/content/site-status.ts — never typed into a page. */
export function StatusPill({ item }: { item: Integration }) {
  return (
    <span className={`status ${TONE[item.status]} ${styles.pill}`} data-status={item.status} data-verified={item.verified ? "true" : "false"}>
      ● {statusText(item)}
    </span>
  );
}
