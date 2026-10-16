/**
 * Branches (Phase 7b, docs/03-branches-and-projects.md): which orders a
 * member of staff can see, and who may move an order between branches.
 *
 * Pure: no I/O. The database enforces the same rule in its row-level
 * security (supabase/migrations/0041_branch_security.sql:
 * current_user_can_see_order); tests/rls/branches.test.ts checks the two
 * agree, as real users.
 */

import type { PermissionSet } from "./permissions";

export interface BranchViewer {
  userId: string;
  permissions: PermissionSet;
  /** Their own branch; null for someone who hasn't one (they see only orders assigned to them). */
  homeBranchId: string | null;
  /** Extra branches an admin has granted them. */
  grantedBranchIds: readonly string[];
  /** The organisation's switch: sales staff limited to their own branches (default on). */
  restrictSalesToBranch: boolean;
}

export interface BranchOrder {
  branchId: string;
  salesRepId: string | null;
}

/** Does this person see every branch — because they're allowed to, or because the business has switched the restriction off? */
export function seesEveryBranch(viewer: BranchViewer): boolean {
  return viewer.permissions.has("branches.view_all") || !viewer.restrictSalesToBranch;
}

/** The branches a restricted person can see: their home branch and any granted. */
export function visibleBranchIds(viewer: BranchViewer): string[] {
  const ids = new Set(viewer.grantedBranchIds);
  if (viewer.homeBranchId) ids.add(viewer.homeBranchId);
  return [...ids];
}

export function canSeeBranch(viewer: BranchViewer, branchId: string): boolean {
  return seesEveryBranch(viewer) || visibleBranchIds(viewer).includes(branchId);
}

/**
 * Can this person see this order? Always if it's assigned to them.
 * Otherwise they need "Everyone's orders", and the order must be in a
 * branch they can see. Seeing an order never grants editing it.
 */
export function canSeeOrder(viewer: BranchViewer, order: BranchOrder): boolean {
  if (order.salesRepId !== null && order.salesRepId === viewer.userId) return true;
  if (!viewer.permissions.has("orders.view_all")) return false;
  return canSeeBranch(viewer, order.branchId);
}

/** Moving an order to another branch: someone who edits orders and sees every branch (admin and procurement by default). */
export function canMoveOrderBranch(permissions: PermissionSet): boolean {
  return permissions.has("orders.edit") && permissions.has("branches.view_all");
}

/** Branch screens, filters and columns appear only once a second active branch exists. */
export function showBranches(branches: readonly { isActive: boolean }[]): boolean {
  return branches.filter((b) => b.isActive).length > 1;
}

/** "Someone who'd see only orders assigned to them": a restricted sales person with no branch at all. Admin screens flag them. */
export function hasNoBranch(viewer: Pick<BranchViewer, "homeBranchId" | "grantedBranchIds" | "permissions" | "restrictSalesToBranch">): boolean {
  return viewer.restrictSalesToBranch && !viewer.permissions.has("branches.view_all") && viewer.homeBranchId === null && viewer.grantedBranchIds.length === 0;
}
