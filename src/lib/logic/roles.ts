/**
 * Internal staff roles (spec §3). What each role may see and do is set per
 * organisation — see ./permissions.ts. Pure: no I/O.
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
  admin: "Full access, including your team and who sees what.",
  procurement: "Create and manage orders, suppliers and purchase orders.",
  sales: "See orders, chase procurement and talk to customers.",
  director: "Oversight of every order and every metric.",
  goods_in: "Check deliveries in against what's expected.",
};
