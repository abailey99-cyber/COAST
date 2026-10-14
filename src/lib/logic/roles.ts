/**
 * Internal staff roles and what each may do (spec §3, decisions B9/C4).
 * Pure: no I/O. The database enforces the same model through RLS helper
 * functions in supabase/migrations/0001_foundation.sql — keep them in step.
 */

export const STAFF_ROLES = ["admin", "procurement", "sales", "director", "goods_in"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  procurement: "Procurement",
  sales: "Sales",
  director: "Director",
  goods_in: "Goods-in",
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  admin: "Full access, including company settings and your team.",
  procurement: "Create and manage orders, suppliers and purchase orders.",
  sales: "See orders, chase procurement and talk to customers.",
  director: "Read-only view of every order and every metric.",
  goods_in: "Check deliveries in against what's expected.",
};

export type Capability =
  | "orders.edit"
  | "procurement.manage"
  | "supplier.identity.view"
  | "costs.view"
  | "settings.view"
  | "settings.edit"
  | "team.manage"
  | "goods_in.check";

const CAPABILITIES: Record<StaffRole, readonly Capability[]> = {
  admin: [
    "orders.edit",
    "procurement.manage",
    "supplier.identity.view",
    "costs.view",
    "settings.view",
    "settings.edit",
    "team.manage",
    "goods_in.check",
  ],
  procurement: ["orders.edit", "procurement.manage", "supplier.identity.view", "costs.view", "goods_in.check"],
  // C4 (DEFAULT — CONFIRM): sales never see supplier identity or costs.
  sales: [],
  // Director: sees everything, changes nothing.
  director: ["supplier.identity.view", "costs.view", "settings.view"],
  goods_in: ["goods_in.check"],
};

export function can(role: StaffRole, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

/** True for roles that must never see a mutation control. */
export function isReadOnlyRole(role: StaffRole): boolean {
  return role === "director";
}
