/**
 * Plain-English wording for the security log (readiness plan Task 5B). Pure.
 * Events never hold a secret; email addresses in them are already partly hidden.
 */

const str = (v: unknown) => (typeof v === "string" ? v : null);

const PROVIDERS: Record<string, string> = { dhl: "DHL", fedex: "FedEx", ups: "UPS", royal_mail: "Royal Mail", netsuite: "NetSuite", microsoft365: "Microsoft 365" };
const ROLES: Record<string, string> = { admin: "Admin", procurement: "Procurement", sales: "Sales", sales_manager: "Sales manager", director: "Director", goods_in: "Goods-in" };

export interface DescribedEvent {
  text: string;
  /** Worth a second look (failures, lockouts, access removed). */
  attention: boolean;
}

export function describeSecurityEvent(kind: string, detail: Record<string, unknown>, names: ReadonlyMap<string, string> = new Map()): DescribedEvent {
  const who = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? "someone") : "someone");
  const provider = PROVIDERS[str(detail.provider) ?? ""] ?? str(detail.provider) ?? "an integration";
  const role = (r: unknown) => ROLES[str(r) ?? ""] ?? str(r) ?? "a role";
  switch (kind) {
    case "sign_in":
      return { text: detail.kind === "customer" ? "Customer signed in" : "Signed in", attention: false };
    case "sign_in_failed":
      return { text: `Failed sign-in for ${str(detail.email) ?? "an address"}`, attention: true };
    case "account_locked":
      return { text: `Sign-in paused for ${str(detail.email) ?? "an address"} after repeated wrong passwords (${Number(detail.minutes) || 15} minutes)`, attention: true };
    case "mfa_enrolled":
      return { text: "Set up an authenticator app", attention: false };
    case "mfa_removed":
      return { text: `Authenticator app removed${typeof detail.user_id === "string" ? ` for ${who(detail.user_id)}` : ""}`, attention: true };
    case "role_changed":
      return { text: `${who(detail.user_id)}'s role changed from ${role(detail.from)} to ${role(detail.to)}`, attention: false };
    case "staff_deactivated":
      return { text: `${who(detail.user_id)} was switched off`, attention: false };
    case "staff_reactivated":
      return { text: `${who(detail.user_id)} was switched back on`, attention: false };
    case "access_changed":
      return {
        text: `${who(detail.user_id)}'s own access: ${str(detail.permission) ?? "a permission"} ${detail.change === "delete" ? "back to their role's default" : detail.granted ? "allowed" : "blocked"}`,
        attention: false,
      };
    case "role_permission_added":
      return { text: `${role(detail.role)} can now: ${str(detail.permission) ?? "a permission"}`, attention: false };
    case "role_permission_removed":
      return { text: `${role(detail.role)} can no longer: ${str(detail.permission) ?? "a permission"}`, attention: false };
    case "credential_created":
      return { text: `${provider} connected`, attention: false };
    case "credential_rotated":
      return { text: `${provider} credentials changed`, attention: false };
    case "credential_reencrypted":
      return { text: `${provider} credentials re-encrypted with a new key`, attention: false };
    case "credential_deleted":
      return { text: `${provider} disconnected`, attention: false };
    case "credential_decrypt_failed":
      return { text: `COAST couldn't read the stored ${provider} credentials`, attention: true };
    case "m365_consent_granted":
      return { text: "Microsoft 365 consent granted", attention: false };
    case "link_revoked":
      return { text: "A supplier's confirmation link was revoked", attention: false };
    default:
      return { text: kind.replace(/_/g, " "), attention: false };
  }
}
