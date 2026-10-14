/**
 * Staff app sections (decisions B9). Which ones a person sees comes from
 * their organisation's permissions (./permissions.ts); Home is always shown.
 * The sidebar, the route guards and the tests all read from this one table.
 */

import { hasPermission, type Permission, type PermissionSet } from "./permissions";

export type SectionKey =
  | "home"
  | "orders"
  | "purchase-orders"
  | "review-queue"
  | "chases"
  | "shipments"
  | "suppliers"
  | "goods-in"
  | "updates"
  | "metrics"
  | "settings";

export interface Section {
  key: SectionKey;
  label: string;
  href: string;
  /** Build phase in which the section becomes real. Shown on placeholder pages. */
  phase: number;
  /** null = everyone (Home). */
  permission: Permission | null;
}

/** The build phase most recently finished. Sections from this phase or earlier are real screens. */
export const BUILT_THROUGH_PHASE = 2;

export function isSectionBuilt(section: Section): boolean {
  return section.phase <= BUILT_THROUGH_PHASE;
}

/** Sidebar order. Home is first for every role (spec §5.6). */
export const SECTIONS: readonly Section[] = [
  { key: "home", label: "Home", href: "/app/home", phase: 6, permission: null },
  { key: "orders", label: "Orders", href: "/app/orders", phase: 1, permission: "section.orders" },
  { key: "purchase-orders", label: "Purchase orders", href: "/app/purchase-orders", phase: 1, permission: "section.purchase-orders" },
  { key: "review-queue", label: "Review queue", href: "/app/review-queue", phase: 2, permission: "section.review-queue" },
  { key: "chases", label: "Chases", href: "/app/chases", phase: 6, permission: "section.chases" },
  { key: "shipments", label: "Shipments", href: "/app/shipments", phase: 3, permission: "section.shipments" },
  { key: "suppliers", label: "Suppliers", href: "/app/suppliers", phase: 1, permission: "section.suppliers" },
  { key: "goods-in", label: "Goods-in", href: "/app/goods-in", phase: 6, permission: "section.goods-in" },
  { key: "updates", label: "Updates", href: "/app/updates", phase: 6, permission: "section.updates" },
  { key: "metrics", label: "Metrics", href: "/app/metrics", phase: 6, permission: "section.metrics" },
  { key: "settings", label: "Settings", href: "/app/settings", phase: 0, permission: "section.settings" },
];

export function visibleSections(perms: PermissionSet): Section[] {
  return SECTIONS.filter((s) => s.permission === null || hasPermission(perms, s.permission));
}

export function canAccessSection(perms: PermissionSet, key: SectionKey): boolean {
  return visibleSections(perms).some((s) => s.key === key);
}

export function getSection(key: SectionKey): Section {
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) throw new Error(`Unknown section: ${key}`);
  return section;
}

/** Which sidebar item is active for a pathname (longest matching href wins). */
export function activeSectionKey(pathname: string): SectionKey | null {
  let best: Section | null = null;
  for (const s of SECTIONS) {
    if (pathname === s.href || pathname.startsWith(`${s.href}/`)) {
      if (!best || s.href.length > best.href.length) best = s;
    }
  }
  return best?.key ?? null;
}
