/**
 * Who sees what, configurable per organisation (product-owner decision E2).
 *
 * Each organisation's admins switch permissions on or off per role. These
 * are the defaults a new organisation starts with. Admins always have every
 * permission and can't be switched off, so nobody can lock their company out.
 *
 * Pure: no I/O. The database holds the same list and defaults
 * (supabase/migrations/0003_permissions.sql) and enforces them through
 * public.has_permission(); tests/rls checks the two stay identical.
 */

import { STAFF_ROLES, type StaffRole } from "./roles";

export const PERMISSION_GROUPS = ["Screens", "Data", "Actions"] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

interface PermissionDef {
  key: string;
  group: PermissionGroup;
  label: string;
  description: string;
}

export const PERMISSIONS = [
  { key: "section.orders", group: "Screens", label: "Orders", description: "Open the Orders screen." },
  { key: "section.purchase-orders", group: "Screens", label: "Purchase orders", description: "Open the Purchase orders screen." },
  { key: "section.review-queue", group: "Screens", label: "Review queue", description: "Open the Review queue." },
  { key: "section.chases", group: "Screens", label: "Chases", description: "Open the Chases screen." },
  { key: "section.shipments", group: "Screens", label: "Shipments", description: "Open the Shipments screen." },
  { key: "section.suppliers", group: "Screens", label: "Suppliers", description: "Open the Suppliers screen." },
  { key: "section.goods-in", group: "Screens", label: "Goods-in", description: "Open the Goods-in screen." },
  { key: "section.updates", group: "Screens", label: "Updates", description: "Open the Updates feed." },
  { key: "section.metrics", group: "Screens", label: "Metrics", description: "Open Metrics and reports." },
  { key: "section.settings", group: "Screens", label: "Settings", description: "Open Settings (changing them is separate)." },
  { key: "orders.view_all", group: "Data", label: "Everyone's orders", description: "See every order, not just the ones assigned to them." },
  { key: "supplier.identity.view", group: "Data", label: "Supplier names", description: "See which supplier fulfils an order, and PO numbers." },
  { key: "costs.view", group: "Data", label: "Costs", description: "See what the business pays suppliers." },
  { key: "orders.edit", group: "Actions", label: "Create and edit orders", description: "Create orders and change their details." },
  { key: "procurement.manage", group: "Actions", label: "Manage suppliers and POs", description: "Create suppliers and purchase orders, chase suppliers, resolve discrepancies." },
  { key: "goods_in.check", group: "Actions", label: "Check in deliveries", description: "Record deliveries arriving at the warehouse." },
  { key: "settings.edit", group: "Actions", label: "Change company settings", description: "Change company settings such as chase timings. (Team and role permissions stay admin-only.)" },
  { key: "people.manage_sales", group: "Actions", label: "Manage sales reps’ access", description: "Give or take away permissions for individual sales reps — only ones they have themselves." },
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly Permission[] = PERMISSIONS.map((p) => p.key);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}

const ALL = PERMISSION_KEYS;
const SCREENS_ALL = PERMISSION_KEYS.filter((k) => k.startsWith("section."));

/** What each role starts with in a new organisation. Admin is always everything. */
export const DEFAULT_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  admin: ALL,
  procurement: [
    ...SCREENS_ALL,
    "orders.view_all",
    "supplier.identity.view",
    "costs.view",
    "orders.edit",
    "procurement.manage",
    "goods_in.check",
  ],
  // E1: sales see all orders, supplier names and costs unless the company switches them off.
  // Spec §3: sales can't edit order or supplier detail.
  sales: [
    "section.orders",
    "section.chases",
    "section.updates",
    "section.metrics",
    "section.settings",
    "orders.view_all",
    "supplier.identity.view",
    "costs.view",
  ],
  // E7: a sales manager is a sales rep who can also set individual reps’ access.
  sales_manager: [
    "section.orders",
    "section.chases",
    "section.updates",
    "section.metrics",
    "section.settings",
    "orders.view_all",
    "supplier.identity.view",
    "costs.view",
    "people.manage_sales",
  ],
  // E3: directors see everything, change nothing — unless an admin allows it.
  director: [...SCREENS_ALL, "orders.view_all", "supplier.identity.view", "costs.view"],
  goods_in: ["section.goods-in", "section.settings", "supplier.identity.view", "goods_in.check"],
};

/** Roles whose permissions an admin can change. Admin itself is fixed. */
export const CONFIGURABLE_ROLES: readonly StaffRole[] = STAFF_ROLES.filter((r) => r !== "admin");

export type PermissionSet = ReadonlySet<Permission>;

/** A per-person exception to their role: allow something extra, or block something. */
export interface PersonOverride {
  permission: string;
  granted: boolean;
}

/**
 * The effective permissions for one person: their role's grants in their
 * organisation, then their own overrides on top. Admin always gets
 * everything. Unknown keys from storage are ignored; anything not granted
 * is denied.
 */
export function resolvePermissions(role: StaffRole, roleGrants: readonly string[], overrides: readonly PersonOverride[] = []): PermissionSet {
  if (role === "admin") return new Set(ALL);
  const set = new Set(roleGrants.filter(isPermission));
  for (const o of overrides) {
    if (!isPermission(o.permission)) continue;
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return set;
}

export interface Person {
  id: string;
  role: StaffRole;
}

export interface Actor extends Person {
  permissions: PermissionSet;
}

/**
 * Can `actor` change `target`'s individual access? (decisions E2, E7)
 * - Nobody changes their own access, and nobody changes an admin's.
 * - Admins can change anyone else.
 * - Holders of "Manage sales reps' access" can change sales reps only.
 * The database enforces the same rule (public.can_manage_person_access).
 */
export function canManagePersonAccess(actor: Actor, target: Person): boolean {
  if (actor.id === target.id || target.role === "admin") return false;
  if (actor.role === "admin") return true;
  return target.role === "sales" && actor.permissions.has("people.manage_sales");
}

/**
 * Which permissions `actor` may switch for someone else: admins, all of
 * them; anyone else, only ones they hold themselves, and never the power to
 * manage others (so a manager can't create another manager).
 */
export function grantablePermissions(actor: Actor): Permission[] {
  if (actor.role === "admin") return [...ALL];
  return PERMISSION_KEYS.filter((k) => k !== "people.manage_sales" && actor.permissions.has(k));
}

export function hasPermission(perms: PermissionSet, key: Permission): boolean {
  return perms.has(key);
}

/** True when the user can't change anything at all — the UI shows "view only". */
export function isViewOnly(perms: PermissionSet): boolean {
  return !PERMISSIONS.some((p) => p.group === "Actions" && perms.has(p.key));
}
