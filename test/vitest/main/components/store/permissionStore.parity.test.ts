import { describe, expect, it, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import type { RouteRecordRaw } from "vue-router";

// Synthetic route table so the permission logic is exercised with non-empty
// data. The live `asyncRoutes` is empty (a no-op), which would make these
// assertions meaningless. Importing the real `@/views/router` would also drag
// every page component into the test graph, so we mock it.
const ADMIN_ROUTE = { path: "/admin", meta: { roles: ["admin"] } };
const MIXED_ROUTE = {
  path: "/profile",
  meta: { roles: ["user", "admin"] },
};
const OPEN_ROUTE = { path: "/open" }; // no meta.roles → always accessible
const NESTED_ROUTE = {
  path: "/reports",
  meta: { roles: ["user"] },
  children: [
    { path: "secret", meta: { roles: ["admin"] } },
    { path: "summary", meta: { roles: ["user"] } },
  ],
};
const CONSTANT = { path: "/" };

vi.mock("@/views/router", () => ({
  asyncRoutes: [ADMIN_ROUTE, MIXED_ROUTE, OPEN_ROUTE, NESTED_ROUTE],
  constantRoutes: [CONSTANT],
}));

const { usePermissionStore, hasPermission, filterAsyncRoutes } = await import(
  "@/views/store/modules/permissionStore"
);

describe("permissionStore — pure helpers", () => {
  it("grants access when the user's role is listed in route.meta.roles", () => {
    expect(hasPermission(["admin"], ADMIN_ROUTE as RouteRecordRaw)).toBe(true);
    expect(hasPermission(["user"], MIXED_ROUTE as RouteRecordRaw)).toBe(true);
  });

  it("denies access when no role overlaps route.meta.roles", () => {
    expect(hasPermission(["user"], ADMIN_ROUTE as RouteRecordRaw)).toBe(false);
  });

  it("treats routes without a roles meta (or non-array roles) as open", () => {
    expect(hasPermission(["user"], OPEN_ROUTE as RouteRecordRaw)).toBe(true);
    expect(hasPermission(["nobody"], OPEN_ROUTE as RouteRecordRaw)).toBe(true);
  });

  it("filterAsyncRoutes recurses into children", () => {
    const filtered = filterAsyncRoutes([NESTED_ROUTE] as RouteRecordRaw[], [
      "user",
    ]);
    expect(filtered).toHaveLength(1);
    // admin-only child removed, user child kept
    expect(filtered[0].children).toHaveLength(1);
    expect(filtered[0].children![0].path).toBe("summary");
  });
});

describe("permissionStore — generateRoutes action (Vuex parity)", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("starts empty", () => {
    const p = usePermissionStore();
    expect(p.routes).toEqual([]);
    expect(p.dynamicRoutes).toEqual([]);
  });

  it("admin short-circuit: assigns ALL async routes", () => {
    const p = usePermissionStore();
    p.generateRoutes(["admin"]);
    expect(p.dynamicRoutes).toHaveLength(4);
    // routes === constantRoutes + dynamicRoutes (constant route is the prefix)
    expect(p.routes).toHaveLength(1 + 4);
    expect(p.routes[0]).toEqual({ path: "/" });
  });

  it("non-admin: filters async routes by role", () => {
    const p = usePermissionStore();
    p.generateRoutes(["user"]);
    // ADMIN_ROUTE dropped; MIXED_ROUTE, OPEN_ROUTE, NESTED_ROUTE kept
    expect(p.dynamicRoutes).toHaveLength(3);
    expect(p.dynamicRoutes.map((r) => r.path).sort()).toEqual(
      ["/open", "/profile", "/reports"].sort()
    );
    // routes still prefixed with constantRoutes
    expect(p.routes[0]).toEqual({ path: "/" });
  });

  it("dynamicRoutes is exactly the role-accessible subset (not constantRoutes)", () => {
    const p = usePermissionStore();
    p.generateRoutes(["user"]);
    expect(p.dynamicRoutes).not.toContain(CONSTANT);
  });
});
