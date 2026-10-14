import { HEALTH_LABELS, type HealthStatus } from "@/lib/logic/health";
import { loadAudit } from "@/server/procurement";
import { loadSettings } from "@/server/settings";
import { PageHeader } from "../PageHeader";
import styles from "../shell.module.css";
import { PermissionMatrix } from "./PermissionMatrix";
import { TeamAccess } from "./TeamAccess";

export const metadata = { title: "Settings" };

const STATUS_CLASS: Record<HealthStatus, string> = {
  ok: "status-ok",
  warn: "status-warn",
  error: "status-bad",
  unconfigured: "status-neutral",
};

export default async function SettingsPage() {
  const [{ canManagePermissions, integrations, team, grants }, audit] = await Promise.all([loadSettings(), loadAudit()]);
  const editablePeople = team.filter((p) => p.editable).length;
  const connected = integrations.filter((i) => i.status === "ok").length;

  return (
    <>
      <PageHeader title="Settings" subtitle="Who sees what, your team, connections and the audit log" />

      <details className={styles.fold}>
        <summary>
          <span className={styles.foldTitles}>
            <h2 className={styles.cardTitle}>Who sees what</h2>
            <span className={styles.foldMeta}>
              What each role can see and do{canManagePermissions ? " · you can change this" : " · view only"}
            </span>
          </span>
        </summary>
        <div className={styles.foldBody}>
          <p className={styles.cardText}>
            {canManagePermissions
              ? "Switch each screen, kind of data and action on or off for each role. Changes apply straight away, to everyone with that role. Admins always have full access. To change one person only, use Team below."
              : "What each role in your company can see and do. Only an admin can change this."}
          </p>
          <PermissionMatrix grants={grants} editable={canManagePermissions} />
        </div>
      </details>

      <details className={styles.fold}>
        <summary>
          <span className={styles.foldTitles}>
            <h2 className={styles.cardTitle}>Team and individual access</h2>
            <span className={styles.foldMeta}>
              {team.length} {team.length === 1 ? "person" : "people"}
              {editablePeople > 0 ? ` · you can change access for ${editablePeople}` : ""}
            </span>
          </span>
        </summary>
        <div className={styles.foldBody}>
          <p className={styles.cardText}>
            Open a person to see exactly what they can do. Adding and removing people from here arrives later; for now your
            COAST admin does it.
          </p>
          <TeamAccess people={team} />
        </div>
      </details>

      <details className={styles.fold}>
        <summary>
          <span className={styles.foldTitles}>
            <h2 className={styles.cardTitle}>Connections</h2>
            <span className={styles.foldMeta}>
              {connected} of {integrations.length} set up
            </span>
          </span>
        </summary>
        <div className={styles.foldBody}>
          <p className={styles.cardText}>
            Whether each connection has its credentials set. &quot;Healthy&quot; here means configured, not yet tested against
            the live service — live checks arrive with each integration.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Connection</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((i) => (
                  <tr key={i.key}>
                    <td>{i.label}</td>
                    <td>
                      <span className={`status ${STATUS_CLASS[i.status]}`}>● {HEALTH_LABELS[i.status]}</span>
                    </td>
                    <td>{i.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
      {audit.canSee && (
        <details className={styles.fold}>
          <summary>
            <span className={styles.foldTitles}>
              <h2 className={styles.cardTitle}>Audit log</h2>
              <span className={styles.foldMeta}>Every change, who made it and when · latest {audit.entries.length}</span>
            </span>
          </summary>
          <div className={styles.foldBody}>
            <p className={styles.cardText}>
              Recorded automatically by the database on every change. Nobody can edit or delete it through COAST — not even an admin.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">What</th>
                    <th scope="col">Fields changed</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.entries.map((a) => (
                    <tr key={a.id}>
                      <td>{a.when}</td>
                      <td>{a.who}</td>
                      <td>{a.what}</td>
                      <td>{a.fields || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
