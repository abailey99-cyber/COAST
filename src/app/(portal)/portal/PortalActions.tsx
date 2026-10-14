"use client";

import { useState, useTransition } from "react";
import { removeOrder, stopFollowing } from "@/server/customer-account-actions";
import styles from "../portal.module.css";

/** "Adds your orders automatically · Stop" for a business that vouched for the customer. */
export function StopFollowing({ businessId, name }: { businessId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  if (done) return <span className={styles.quiet} style={{ fontSize: 13 }} role="status">{done}</span>;
  return (
    <span className={styles.quiet} style={{ fontSize: 13 }}>
      <span className={styles.dueSoon}>● Adds your orders automatically</span>{" "}
      <button
        type="button"
        className={styles.textButton}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Stop ${name} adding new orders to your account automatically? You can still add them with a tracking code.`)) return;
          startTransition(async () => {
            const r = await stopFollowing(businessId);
            setDone(r.ok ? (r.message ?? "Stopped.") : (r.error ?? "That didn't work."));
          });
        }}
      >
        Stop
      </button>
    </span>
  );
}

/** Take an order off the list (it still exists; the customer just stops seeing it here). */
export function OrderMenu({ code, label }: { code: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={styles.textButton}
      disabled={pending}
      aria-label={`Remove ${label} from my list`}
      onClick={() => {
        if (!window.confirm(`Remove ${label} from your list? You can add it again with its tracking code.`)) return;
        startTransition(async () => void (await removeOrder(code)));
      }}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
