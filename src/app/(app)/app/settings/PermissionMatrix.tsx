"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CONFIGURABLE_ROLES, PERMISSIONS, PERMISSION_GROUPS, type Permission } from "@/lib/logic/permissions";
import { ROLE_LABELS, type StaffRole } from "@/lib/logic/roles";
import { setRolePermission } from "@/server/permission-actions";
import styles from "../shell.module.css";

type Grants = Record<Exclude<StaffRole, "admin">, Permission[]>;
type Change = { role: Exclude<StaffRole, "admin">; permission: Permission; granted: boolean };

/**
 * "Who sees what" (decision E2). Admins switch each permission per role;
 * everyone else sees the same grid read-only. Admin is always everything.
 */
export function PermissionMatrix({ grants, editable }: { grants: Grants; editable: boolean }) {
  const [optimistic, apply] = useOptimistic(grants, (state: Grants, c: Change) => ({
    ...state,
    [c.role]: c.granted ? [...state[c.role], c.permission] : state[c.role].filter((p) => p !== c.permission),
  }));
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(change: Change) {
    setError(null);
    startTransition(async () => {
      apply(change);
      const result = await setRolePermission(change.role, change.permission, change.granted);
      if (!result.ok) setError(result.error ?? "That change couldn't be saved.");
    });
  }

  return (
    <>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.matrix}`}>
          <thead>
            <tr>
              <th scope="col">Permission</th>
              <th scope="col">{ROLE_LABELS.admin}</th>
              {CONFIGURABLE_ROLES.map((r) => (
                <th scope="col" key={r}>{ROLE_LABELS[r]}</th>
              ))}
            </tr>
          </thead>
          {PERMISSION_GROUPS.map((group) => (
            <tbody key={group}>
              <tr>
                <th scope="colgroup" colSpan={2 + CONFIGURABLE_ROLES.length} className={styles.matrixGroup}>{group}</th>
              </tr>
              {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                <tr key={p.key}>
                  <th scope="row" className={styles.matrixLabel}>
                    <span>{p.label}</span>
                    <span className={styles.matrixHint}>{p.description}</span>
                  </th>
                  <td><span className="status status-ok">● Always</span></td>
                  {CONFIGURABLE_ROLES.map((r) => {
                    const role = r as Exclude<StaffRole, "admin">;
                    const on = optimistic[role].includes(p.key);
                    const label = `${p.label} for ${ROLE_LABELS[role]}`;
                    return (
                      <td key={r}>
                        {editable ? (
                          <input
                            type="checkbox"
                            className={styles.matrixCheck}
                            checked={on}
                            aria-label={label}
                            onChange={(e) => toggle({ role, permission: p.key, granted: e.target.checked })}
                          />
                        ) : (
                          <span className={`status ${on ? "status-ok" : "status-neutral"}`} aria-label={`${label}: ${on ? "yes" : "no"}`}>
                            {on ? "● Yes" : "○ No"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
