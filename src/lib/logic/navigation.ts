/**
 * Staff app sections and which roles see them (decisions B9).
 * The sidebar, the route guards and the tests all read from this one table.
 */

import type { StaffRole } from "./roles";

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
  roles: readonly StaffRole[];
}

const ALL: readonly StaffRole[] = ["admin", "procurement", "sales", "director", "goods_in"];
const OFFICE: readonly StaffRole[] = ["admin", "procurement", "director"];

/** Sidebar order. Home is first for every role (spec §5.6). */
export const SECTIONS: readonly Section[] = [
  { key: "home", label: "Home", href: "/app/home", phase: 6, roles: ALL },
  { key: "orders", label: "Orders", href: "/app/orders", phase: 1, roles: ["admin", "procurement", "sales", "director"] },
  { key: "purchase-orders", label: "Purchase orders", href: "/app/purchase-orders", phase: 1, roles: OFFICE },
  { key: "review-queue", label: "Review queue", href: "/app/review-queue", phase: 2, roles: OFFICE },
  { key: "chases", label: "Chases", href: "/app/chases", phase: 6, roles: ["admin", "procurement", "sales", "director"] },
  { key: "shipments", label: "Shipments", href: "/app/shipments", phase: 3, roles: OFFICE },
  { key: "suppliers", label: "Suppliers", href: "/app/suppliers", phase: 1, roles: OFFICE },
  { key: "goods-in", label: "Goods-in", href: "/app/goods-in", phase: 6, roles: ["admin", "procurement", "director", "goods_in"] },
  { key: "updates", label: "Updates", href: "/app/updates", phase: 6, roles: ["admin", "procurement", "sales", "director"] },
  { key: "metrics", label: "Metrics", href: "/app/metrics", phase: 6, roles: ["admin", "procurement", "sales", "director"] },
  { key: "settings", label: "Settings", href: "/app/settings", phase: 0, roles: ["admin", "director"] },
];

export function sectionsForRole(role: StaffRole): Section[] {
  return SECTIONS.filter((s) => s.roles.includes(role));
}

export function canAccessSection(role: StaffRole, key: SectionKey): boolean {
  return SECTIONS.some((s) => s.key === key && s.roles.includes(role));
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
