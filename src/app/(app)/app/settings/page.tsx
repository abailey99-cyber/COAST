import { HEALTH_LABELS, type HealthStatus } from "@/lib/logic/health";
import { ROLE_LABELS } from "@/lib/logic/roles";
import { loadSettings } from "@/server/settings";
import { PageHeader } from "../PageHeader";
import styles from "../shell.module.css";

export const metadata = { title: "Settings" };

const STATUS_CLASS: Record<HealthStatus, string> = {
  ok: "status-ok",
  warn: "status-warn",
  error: "status-bad",
  unconfigured: "status-neutral",
};

export default async function SettingsPage() {
  const { canEdit, integrations, team } = await loadSettings();

  return (
    <>
      <PageHeader title="Settings" subtitle={canEdit ? "Connections and your team" : "Connections and your team · view only"} />

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
    </>
  );
}
