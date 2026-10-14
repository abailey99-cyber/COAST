"use client";

import { useOptimistic, useState, useTransition } from "react";
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from "@/lib/logic/permissions";
import { ROLE_LABELS } from "@/lib/logic/roles";
import { setPersonPermission } from "@/server/permission-actions";
import type { OverrideState, PersonAccess } from "@/server/settings";
import styles from "../shell.module.css";
import { SaveStatus } from "./SaveStatus";

type Choice = OverrideState | "default";

/**
 * Team list, one fold-out per person, with their individual access
 * (decision E7). Admins can change anyone but admins and themselves;
 * sales managers can change sales reps, and only pass on what they have.
 */
export function TeamAccess({ people }: { people: PersonAccess[] }) {
  return (
    <div>
      {people.map((p) => (
        <PersonRow key={p.id} person={p} />
      ))}
    </div>
  );
}

function PersonRow({ person }: { person: PersonAccess }) {
  const [overrides, apply] = useOptimistic(person.overrides, (state, c: { permission: Permission; choice: Choice }) => {
    const next = { ...state };
    if (c.choice === "default") delete next[c.permission];
    else next[c.permission] = c.choice;
    return next;
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const exceptions = Object.keys(overrides).length;
  const isAdmin = person.role === "admin";

  function change(permission: Permission, choice: Choice) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      apply({ permission, choice });
      const result = await setPersonPermission(person.id, permission, choice);
      if (!result.ok) setError(result.error ?? "That change couldn't be saved.");
      else setSaved(true);
    });
  }

  function effective(key: Permission): boolean {
    if (isAdmin) return true;
    const o = overrides[key];
    if (o === "allow") return true;
    if (o === "block") return false;
    return person.roleGrants.includes(key);
  }

  return (
    <details className={styles.person}>
      <summary>
        <span className={styles.personName}>{person.fullName}</span>
        <span className={styles.personMeta}>
          {ROLE_LABELS[person.role]} · {person.email}
        </span>
        {!person.isActive && <span className="status status-neutral">● Deactivated</span>}
        {exceptions > 0 && (
          <span className={styles.pill}>
            {exceptions} individual {exceptions === 1 ? "change" : "changes"}
          </span>
        )}
      </summary>
      <div className={styles.personBody}>
        {isAdmin ? (
          <p className={styles.cardText}>Admins always have full access.</p>
        ) : (
          <p className={styles.cardText}>
            {person.editable
              ? `Starts from the ${ROLE_LABELS[person.role]} role. Change anything for ${person.fullName} only.`
              : `What ${person.fullName} can see and do. You can't change it.`}
          </p>
        )}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <SaveStatus pending={pending} saved={saved} />
        {!isAdmin &&
          PERMISSION_GROUPS.map((group) => (
            <details key={group} className={styles.subFold}>
              <summary>{group}</summary>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Permission</th>
                      <th scope="col">Role gives</th>
                      <th scope="col">{person.fullName}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSIONS.filter((p) => p.group === group).map((p) => {
                      const fromRole = person.roleGrants.includes(p.key);
                      const canChange = person.editable && person.grantable.includes(p.key);
                      const current: Choice = overrides[p.key] ?? "default";
                      const on = effective(p.key);
                      return (
                        <tr key={p.key}>
                          <th scope="row" className={styles.matrixLabel}>
                            <span>{p.label}</span>
                          </th>
                          <td>
                            <span className={`status ${fromRole ? "status-ok" : "status-neutral"}`}>{fromRole ? "● Yes" : "○ No"}</span>
                          </td>
                          <td>
                            {canChange ? (
                              <select
                                className={styles.select}
                                value={current}
                                aria-label={`${p.label} for ${person.fullName}`}
                                onChange={(e) => change(p.key, e.target.value as Choice)}
                              >
                                <option value="default">Same as role ({fromRole ? "yes" : "no"})</option>
                                <option value="allow">Allow</option>
                                <option value="block">Block</option>
                              </select>
                            ) : (
                              <span className={`status ${on ? "status-ok" : "status-neutral"}`}>
                                {on ? "● Yes" : "○ No"}
                                {overrides[p.key] ? " (individual)" : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
      </div>
    </details>
  );
}
