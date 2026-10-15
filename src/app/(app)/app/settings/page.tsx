import { cookies } from "next/headers";
import { HEALTH_LABELS, type HealthStatus } from "@/lib/logic/health";
import { THEME_COOKIE, parseTheme } from "@/lib/logic/theme";
import { loadAudit } from "@/server/procurement";
import { loadSettings } from "@/server/settings";
import { PageHeader } from "../PageHeader";
import styles from "../shell.module.css";
import { ThemeToggle } from "../ThemeToggle";
import { CarrierConnections } from "./CarrierConnections";
import { ChaseSettingsForm } from "./ChaseSettingsForm";
import { PredictionSettingsForm } from "./PredictionSettingsForm";
import { CustomsSettingsForm } from "./CustomsSettingsForm";
import { CustomerPageForm } from "./CustomerPageForm";
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
  const [{ canManagePermissions, canEditSettings, integrations, team, grants, chase, carriers, prediction, customerPage, customs, orgName }, audit] = await Promise.all([loadSettings(), loadAudit()]);
  const editablePeople = team.filter((p) => p.editable).length;
  const connected = integrations.filter((i) => i.status === "ok").length;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <>
      <PageHeader title="Settings" subtitle="Appearance, who sees what, your team, chasing, delivery dates, customer page, carriers, connections and the audit log" />

      <section className={styles.card} aria-labelledby="appearance-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 id="appearance-title" className={styles.cardTitle}>Appearance</h2>
            <p className={styles.cardText}>Light or dark, just for you. Remembered on this device.</p>
          </div>
          <ThemeToggle initial={theme} />
        </div>
      </section>

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
            <h2 className={styles.cardTitle}>Chasing</h2>
            <span className={styles.foldMeta}>
              Overdue after {chase.thresholds.amberHours}h · very overdue after {chase.thresholds.redHours}h · needs attention after {chase.thresholds.alertHours}h (working hours)
            </span>
          </span>
        </summary>
        <div className={styles.foldBody}>
          <p className={styles.cardText}>
            How long something can wait on someone — a supplier confirming a PO, procurement answering a chase — before COAST
            flags it. Counted in working hours: Monday to Friday, within the working day. Bank holidays aren&apos;t counted out yet.
          </p>
          <ChaseSettingsForm
            editable={canEditSettings}
            values={{ ...chase.thresholds, dayStartHour: chase.calendar.dayStartHour, dayEndHour: chase.calendar.dayEndHour }}
          />
        </div>
      </details>

      <details className={styles.fold}>
        <summary>
          <span className={styles.foldTitles}>
            <h2 className={styles.cardTitle}>Delivery dates</h2>
            <span className={styles.foldMeta}>
              Turnaround {prediction.handlingDays}d · delivery {prediction.deliveryDays}d · estimates {prediction.spreadDays}d wide (working days)
            </span>
          </span>
        </summary>
        <div className={styles.foldBody}>
          <p className={styles.cardText}>
            COAST works out each order&apos;s delivery date from the best information it has: the carrier&apos;s estimate once
            it&apos;s on its way, the supplier&apos;s confirmed date, or the line&apos;s lead time. These are the days it adds on top.
            Anything worked out rather than confirmed is shown as a range. An order is at risk when the latest likely date
            is after the date promised to the customer. A date or lead time someone sets by hand is never changed.
          </p>
          <PredictionSettingsForm editable={canEditSettings} values={prediction} />
        </div>
      </details>

      <details className={styles.fold}>
        <summary>
          <span className={styles.foldTitles}>
            <h2 className={styles.cardTitle}>Customer page</h2>
            <span className={styles.foldMeta}>
              Shown as {customerPage.displayName ?? orgName} · “{customerPage.supplierWord}” · updates at most every {customerPage.minGapHours}h
            </span>
          </span>
        </summary>
        <div className={styles.foldBody}>
          <p className={styles.cardText}>
            What customers see on their tracking page and in update emails. They never see supplier names, PO numbers, costs or
            internal notes — COAST checks every page and every reply before it goes out.
          </p>
          <CustomerPageForm values={customerPage} orgName={orgName} editable={canEditSettings} />
        </div>
      </details>

      <details className={styles.fold}>
        <summary>
          <span className={styles.foldTitles}>
            <h2 className={styles.cardTitle}>Customs</h2>
            <span className={styles.foldMeta}>
              EORI {customs.eori ?? "not set"} · Northern Ireland and the islands {customs.territoriesNeedCustoms ? "count as customs" : "don't count as customs"}
            </span>
          </span>
        </summary>
        <div className={styles.foldBody}>
          <p className={styles.cardText}>
            For deliveries that cross a border. Each one gets a document checklist on its shipment page, and anything held or
            missing shows on Chases. Customers only ever see “Customs checks in progress — we&apos;re on it.”
          </p>
          <CustomsSettingsForm values={customs} editable={canEditSettings} />
        </div>
      </details>

      {carriers && (
        <details className={styles.fold}>
          <summary>
            <span className={styles.foldTitles}>
              <h2 className={styles.cardTitle}>Carrier connections</h2>
              <span className={styles.foldMeta}>
                {carriers.carriers.filter((c) => c.status !== "unconfigured").length} of {carriers.carriers.length} set up · {carriers.lastRunLabel}
              </span>
            </span>
          </summary>
          <div className={styles.foldBody}>
            <p className={styles.cardText}>
              Which carriers COAST checks for you, and whether those checks are working. Each carrier is switched on once, for
              the whole of COAST, by adding its credentials to the hosting settings (see docs/integrations/carrier-tracking.md).
              Carriers marked beta were built without the carrier&apos;s own documentation and need a check once a real account is
              connected. The claim window is how long you have to claim from that carrier for damage or loss; leave it blank
              until you know it.
            </p>
            <CarrierConnections carriers={carriers.carriers} editable={carriers.canEdit} />
          </div>
        </details>
      )}

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
