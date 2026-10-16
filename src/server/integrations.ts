import "server-only";
import { listCarrierActivity } from "@/lib/data/shipments";
import { listConnections } from "@/lib/data/credentials";
import { listStaffInOrg } from "@/lib/data/staff";
import { NO_ACTIVITY, carrierHealth, CARRIERS } from "@/lib/logic/carriers";
import { formatDateTime } from "@/lib/logic/format";
import type { Health } from "@/lib/logic/health";
import { CREDENTIAL_PROVIDERS, PROVIDERS, type CredentialField, type CredentialProvider } from "@/lib/logic/integrations";
import { keyringFromEnv } from "@/lib/secrets/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffContext } from "./session";

/** Settings → Integrations: each provider, whether this organisation has connected it, and its health. Never a secret. */

export interface IntegrationItem {
  provider: CredentialProvider;
  label: string;
  group: "Carriers" | "Systems";
  connected: boolean;
  health: Health;
  /** Which key is in use: its last four characters. */
  hint: string | null;
  /** Non-secret settings, shown back so they can be changed. */
  config: Record<string, string>;
  configFields: FieldView[];
  secretFields: FieldView[];
  caution: string | null;
  consentNeeded: boolean;
  notLiveYet: string | null;
  unverified: string | null;
  detail: string | null;
}

/** A form field as the browser gets it: the checking pattern stays on the server. */
export type FieldView = Omit<CredentialField, "pattern" | "patternMessage">;
const toView = ({ key, label, hint, multiline, options }: CredentialField): FieldView => ({ key, label, ...(hint ? { hint } : {}), ...(multiline ? { multiline } : {}), ...(options ? { options } : {}) });

export interface IntegrationsView {
  items: IntegrationItem[];
  canEdit: boolean;
  /** COAST_CREDENTIAL_KEYS is set, so secrets can be stored. */
  storeReady: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function loadIntegrations(staff: StaffContext): Promise<IntegrationsView> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { items: [], canEdit: false, storeReady: false };
  const [connections, activity, team] = await Promise.all([listConnections(supabase), listCarrierActivity(supabase, today()), listStaffInOrg(supabase)]);
  const names = new Map(team.map((t) => [t.id, t.fullName]));
  const items = CREDENTIAL_PROVIDERS.map((p): IntegrationItem => {
    const def = PROVIDERS[p];
    const c = connections.find((x) => x.provider === p) ?? null;
    let health: Health;
    if (!c) health = { status: "unconfigured", reason: "Not connected." };
    else if (c.status === "error") health = { status: "error", reason: c.lastError ?? "COAST couldn't use these credentials. Reconnect them." };
    else if (def.notLiveYet) health = { status: "warn", reason: `Saved. ${def.notLiveYet}` };
    else {
      // A carrier: judged on what its checks have done (the FedEx connection covers TNT too).
      const carrier = CARRIERS.find((d) => d.provider === p)!;
      health = carrierHealth(carrier, true, activity[carrier.key] ?? NO_ACTIVITY);
    }
    const who = c?.createdBy ? (names.get(c.createdBy) ?? "an admin") : null;
    return {
      provider: p,
      label: def.label,
      group: def.group,
      connected: Boolean(c),
      health,
      hint: c?.hint ?? null,
      config: c?.config ?? {},
      configFields: def.config.map(toView),
      secretFields: def.secret.map(toView),
      caution: def.caution ?? null,
      consentNeeded: Boolean(def.consentNeeded),
      notLiveYet: def.notLiveYet ?? null,
      unverified: def.unverified ?? null,
      detail: c
        ? [`Connected ${formatDateTime(new Date(c.createdAt))}${who ? ` by ${who}` : ""}`, c.rotatedAt ? `changed ${formatDateTime(new Date(c.rotatedAt))}` : null, c.lastUsedAt ? `last used ${formatDateTime(new Date(c.lastUsedAt))}` : "not used yet"]
            .filter(Boolean)
            .join(" · ")
        : null,
    };
  });
  return { items, canEdit: staff.role === "admin", storeReady: keyringFromEnv() !== null };
}
