import { describe, expect, it } from "vitest";
import { canMoveOrderBranch, canSeeBranch, canSeeOrder, hasNoBranch, seesEveryBranch, showBranches, visibleBranchIds, type BranchViewer } from "./branches";
import { resolvePermissions, DEFAULT_PERMISSIONS, type Permission } from "./permissions";

const NORTH = "branch-north";
const SOUTH = "branch-south";
const EAST = "branch-east";

function viewer(over: Partial<BranchViewer> & { perms?: readonly Permission[] } = {}): BranchViewer {
  return {
    userId: "rep-1",
    permissions: new Set(over.perms ?? DEFAULT_PERMISSIONS.sales),
    homeBranchId: NORTH,
    grantedBranchIds: [],
    restrictSalesToBranch: true,
    ...over,
  };
}

describe("canSeeOrder", () => {
  it("shows a restricted rep their own branch, not another", () => {
    expect(canSeeOrder(viewer(), { branchId: NORTH, salesRepId: "someone-else" })).toBe(true);
    expect(canSeeOrder(viewer(), { branchId: SOUTH, salesRepId: "someone-else" })).toBe(false);
  });

  it("shows a granted branch, and stops when the grant goes", () => {
    expect(canSeeOrder(viewer({ grantedBranchIds: [SOUTH] }), { branchId: SOUTH, salesRepId: null })).toBe(true);
    expect(canSeeOrder(viewer({ grantedBranchIds: [] }), { branchId: SOUTH, salesRepId: null })).toBe(false);
  });

  it("always shows an order assigned to them, in any branch, even without Everyone's orders", () => {
    expect(canSeeOrder(viewer(), { branchId: SOUTH, salesRepId: "rep-1" })).toBe(true);
    expect(canSeeOrder(viewer({ perms: [], homeBranchId: null }), { branchId: EAST, salesRepId: "rep-1" })).toBe(true);
  });

  it("with the restriction off, shows every branch to anyone with Everyone's orders", () => {
    expect(canSeeOrder(viewer({ restrictSalesToBranch: false }), { branchId: SOUTH, salesRepId: null })).toBe(true);
    expect(canSeeOrder(viewer({ restrictSalesToBranch: false, perms: [] }), { branchId: SOUTH, salesRepId: null })).toBe(false);
  });

  it("shows admin, procurement, director and sales manager every branch by default (N5, N6)", () => {
    for (const role of ["procurement", "director", "sales_manager"] as const) {
      expect(canSeeOrder(viewer({ perms: DEFAULT_PERMISSIONS[role], homeBranchId: null }), { branchId: SOUTH, salesRepId: null }), role).toBe(true);
    }
    expect(canSeeOrder(viewer({ permissions: resolvePermissions("admin", []), homeBranchId: null }), { branchId: SOUTH, salesRepId: null })).toBe(true);
  });

  it("shows a rep with no branch only what's assigned to them", () => {
    const v = viewer({ homeBranchId: null });
    expect(canSeeOrder(v, { branchId: NORTH, salesRepId: null })).toBe(false);
    expect(canSeeOrder(v, { branchId: NORTH, salesRepId: "rep-1" })).toBe(true);
    expect(hasNoBranch(v)).toBe(true);
  });

  it("never treats an unassigned order as assigned to the viewer", () => {
    expect(canSeeOrder(viewer({ perms: [], userId: "" }), { branchId: NORTH, salesRepId: null })).toBe(false);
  });

  it("hides every order from someone without Everyone's orders, apart from their own", () => {
    expect(canSeeOrder(viewer({ perms: DEFAULT_PERMISSIONS.goods_in }), { branchId: NORTH, salesRepId: null })).toBe(false);
  });
});

describe("branch helpers", () => {
  it("lists the home and granted branches once each", () => {
    expect(visibleBranchIds(viewer({ grantedBranchIds: [SOUTH, NORTH] })).sort()).toEqual([NORTH, SOUTH].sort());
    expect(visibleBranchIds(viewer({ homeBranchId: null }))).toEqual([]);
  });

  it("sees every branch with the permission or with the restriction off", () => {
    expect(seesEveryBranch(viewer())).toBe(false);
    expect(seesEveryBranch(viewer({ perms: ["branches.view_all"] }))).toBe(true);
    expect(seesEveryBranch(viewer({ restrictSalesToBranch: false }))).toBe(true);
    expect(canSeeBranch(viewer(), EAST)).toBe(false);
  });

  it("doesn't flag someone who sees every branch, or has a grant, as having no branch", () => {
    expect(hasNoBranch(viewer({ homeBranchId: null, perms: ["branches.view_all"] }))).toBe(false);
    expect(hasNoBranch(viewer({ homeBranchId: null, grantedBranchIds: [SOUTH] }))).toBe(false);
    expect(hasNoBranch(viewer({ homeBranchId: null, restrictSalesToBranch: false }))).toBe(false);
  });

  it("lets only someone who edits orders and sees every branch move one", () => {
    expect(canMoveOrderBranch(new Set(DEFAULT_PERMISSIONS.procurement))).toBe(true);
    expect(canMoveOrderBranch(resolvePermissions("admin", []))).toBe(true);
    expect(canMoveOrderBranch(new Set(DEFAULT_PERMISSIONS.director))).toBe(false);
    expect(canMoveOrderBranch(new Set(DEFAULT_PERMISSIONS.sales_manager))).toBe(false);
    expect(canMoveOrderBranch(new Set(DEFAULT_PERMISSIONS.sales))).toBe(false);
  });

  it("shows branch screens only with a second active branch", () => {
    expect(showBranches([{ isActive: true }])).toBe(false);
    expect(showBranches([{ isActive: true }, { isActive: false }])).toBe(false);
    expect(showBranches([{ isActive: true }, { isActive: true }])).toBe(true);
    expect(showBranches([])).toBe(false);
  });
});
