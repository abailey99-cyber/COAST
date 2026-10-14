import { HEALTH_LABELS, type HealthStatus } from "@/lib/logic/health";
import { ROLE_LABELS } from "@/lib/logic/roles";
import { loadSettings } from "@/server/settings";
import { PageHeader } from "../PageHeader";
import styles from "../shell.module.css";
import { PermissionMatrix } from "./PermissionMatrix";

export const metadata = { title: "Settings" };

const STATUS_CLASS: Record<HealthStatus, string> = {
  ok: "status-ok",
  warn: "status-warn",
  error: "status-bad",
  unconfigured: "status-neutral",
};

export default async function SettingsPage() {
  const { canManagePermissions, integrations, team, grants } = await loadSettings();

  return (
    <>
      <PageHeader title="Settings" subtitle={canManagePermissions ? "Connections, your team and who sees what" : "Connections, your team and who sees what · view only"} />

      <section className={styles.card} aria-labelledby="access-title">
        <h2 id="access-title" className={styles.cardTitle}>Who sees what</h2>
        <p className={styles.cardText}>
          {canManagePermissions
            ? "Switch each screen, kind of data and action on or off for each role. Changes apply straight away, to everyone with that role. Admins always have full access."
            : "What each role in your company can see and do. Only an admin can change this."}
        </p>
        <PermissionMatrix grants={grants} editable={canManagePermissions} />
      </section>

      <section className={styles.card} aria-labelledby="team-title">
        <h2 id="team-title" className={styles.cardTitle}>Team</h2>
        <p className={styles.cardText}>Adding and removing people from here arrives later. For now your COAST admin does it.</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {team.map((p) => (
                <tr key={p.id}>
                  <td>{p.fullName}</td>
                  <td>{p.email}</td>
                  <td>{ROLE_LABELS[p.role]}</td>
                  <td>
                    <span className={`status ${p.isActive ? "status-ok" : "status-neutral"}`}>● {p.isActive ? "Active" : "Deactivated"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="connections-title">
        <h2 id="connections-title" className={styles.cardTitle}>Connections</h2>
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
      </section>
    </>
  );
}
