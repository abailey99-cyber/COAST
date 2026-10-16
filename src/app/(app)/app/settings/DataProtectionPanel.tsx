"use client";

import { useActionState, useMemo } from "react";
import { lookUpPerson, removePerson, saveRetention, type PersonResult } from "@/server/data-protection-actions";
import type { DataProtectionView } from "@/server/data-protection";
import styles from "../shell.module.css";

const REPORT_LABELS: Record<string, string> = {
  orders: "Closed orders older than that",
  update_emails: "Customer email addresses for order updates",
  sent_emails: "Update emails sent",
  messages: "Messages on those orders",
  problem_reports: "Customers' delivery-problem reports",
};

/** Settings → Data protection (readiness plan Task 6). Admins only. */
export function DataProtectionPanel({ view: v }: { view: DataProtectionView }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section aria-labelledby="dp-export" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 id="dp-export" style={{ fontSize: 14 }}>Export all your data</h3>
        <p className={styles.cardText} style={{ margin: 0 }}>
          A ZIP of CSV files — one per table — with everything COAST holds for your company. Integration secrets are never included.
        </p>
        <div>
          <a href="/api/export" className="btn btn-secondary" download>Download export</a>
        </div>
      </section>

      <FindPerson />

      <Retention view={v} />

      <section aria-labelledby="dp-meter" style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--divider)", paddingTop: 14 }}>
        <h3 id="dp-meter" style={{ fontSize: 14 }}>Orders tracked each month</h3>
        <p className={styles.cardText} style={{ margin: 0 }}>Each sales order counts once, in the month it was added (or first synced), however many lines or shipments it has.</p>
        {v.meter.length === 0 ? (
          <p className={styles.cardText} style={{ margin: 0 }}>None yet.</p>
        ) : (
          <table style={{ fontSize: 14, borderCollapse: "collapse" }}>
            <tbody>
              {v.meter.map((m) => (
                <tr key={m.month}>
                  <td style={{ padding: "2px 16px 2px 0" }}>{m.label}</td>
                  <td style={{ padding: "2px 0", fontWeight: 600 }}>{m.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function FindPerson() {
  const [found, find, finding] = useActionState(lookUpPerson, null as PersonResult | null);
  const [removed, remove, removing] = useActionState(removePerson, null as PersonResult | null);
  const download = useMemo(() => (found?.json ? `data:application/json;charset=utf-8,${encodeURIComponent(found.json)}` : null), [found?.json]);
  return (
    <section aria-labelledby="dp-person" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--divider)", paddingTop: 14 }}>
      <h3 id="dp-person" style={{ fontSize: 14 }}>Find, export or remove a person&apos;s details</h3>
      <p className={styles.cardText} style={{ margin: 0 }}>
        For a request from a customer contact or a supplier contact. Removing clears what identifies them; the orders and their history stay.
      </p>
      <form action={find} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="dp-email">Their email address</label>
          <input id="dp-email" name="email" type="email" className="input" required />
        </div>
        <div className="field" style={{ minWidth: 180 }}>
          <label htmlFor="dp-name">The name they used (optional)</label>
          <input id="dp-name" name="name" className="input" />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={finding}>{finding ? "Looking…" : "Find"}</button>
      </form>
      {found && !found.ok && <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{found.error}</p>}
      {found?.ok && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="person-report">
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>{found.total}</strong> {found.total === 1 ? "record" : "records"} for {found.email}
            {found.name ? ` (${found.name})` : ""}:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {found.sections?.filter((s) => s.count > 0).map((s) => (
              <li key={s.key}>{s.label}: {s.count}</li>
            ))}
          </ul>
          {download && (
            <div>
              <a href={download} download={`person-${found.email}.json`} className="btn btn-secondary">Download what we hold (JSON)</a>
            </div>
          )}
          {(found.total ?? 0) > 0 && (
            <form action={remove} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <input type="hidden" name="email" value={found.email} />
              <input type="hidden" name="name" value={found.name ?? ""} />
              <div className="field" style={{ minWidth: 260 }}>
                <label htmlFor="dp-confirm">To remove them, type their email again</label>
                <input id="dp-confirm" name="confirm" className="input" autoComplete="off" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={removing}>{removing ? "Removing…" : "Remove their details"}</button>
            </form>
          )}
          {removed && (removed.ok ? <p className={styles.saveStatus} role="status" style={{ margin: 0 }}>✓ {removed.message}</p> : <p className="notice notice-error" role="alert" style={{ margin: 0 }}>{removed.error}</p>)}
        </div>
      )}
    </section>
  );
}

function Retention({ view: v }: { view: DataProtectionView }) {
  const [state, action, pending] = useActionState(saveRetention, null as { ok: boolean; error?: string; message?: string } | null);
  return (
    <section aria-labelledby="dp-retention" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--divider)", paddingTop: 14 }}>
      <h3 id="dp-retention" style={{ fontSize: 14 }}>How long customer details are kept</h3>
      <p className={styles.cardText} style={{ margin: 0 }}>
        After an order has closed (everything delivered or cancelled) and nothing has happened on it for this long, COAST clears customers&apos;
        email addresses, the text of messages and their problem reports. The order itself is kept. Check the report first, then switch it on.
      </p>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="dp-months">Keep for (months)</label>
          <input id="dp-months" name="months" type="number" min={1} max={120} className="input" defaultValue={v.retentionMonths ?? ""} placeholder="Blank: keep everything" />
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" name="enforce" defaultChecked={v.retentionEnforced} disabled={v.retentionMonths === null} /> Clear them automatically every night
        </label>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          {state && (state.ok ? <span className={styles.saveStatus} role="status">✓ {state.message}</span> : <span className="notice notice-error" role="alert">{state.error}</span>)}
        </div>
      </form>
      {v.report && (
        <div data-testid="retention-report">
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{v.retentionEnforced ? "Cleared at the next nightly run:" : "If switched on now, it would clear:"}</p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 14 }}>
            {Object.entries(v.report).map(([k, n]) => (
              <li key={k}>{REPORT_LABELS[k] ?? k}: {n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
