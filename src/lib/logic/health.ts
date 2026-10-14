/**
 * The uniform health shape every adapter and integration reports
 * (CLAUDE.md non-negotiable 5). A missing credential is "unconfigured",
 * never a crash.
 */

export type HealthStatus = "ok" | "warn" | "error" | "unconfigured";

export interface Health {
  status: HealthStatus;
  reason: string;
}

type Env = Readonly<Record<string, string | undefined>>;

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Configuration health from environment variables alone. Returns
 * "unconfigured" when none are set, "error" when only some are (a half-done
 * setup is a real problem worth surfacing), otherwise "ok".
 */
export function configHealth(label: string, required: readonly string[], env: Env): Health {
  const missing = required.filter((name) => !isSet(env[name]));
  if (missing.length === required.length) {
    return { status: "unconfigured", reason: `${label} isn't connected yet.` };
  }
  if (missing.length > 0) {
    return { status: "error", reason: `${label} is partly set up. Missing: ${missing.join(", ")}.` };
  }
  return { status: "ok", reason: `${label} is configured.` };
}

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  ok: "Healthy",
  warn: "Check",
  error: "Problem",
  unconfigured: "Not connected",
};
