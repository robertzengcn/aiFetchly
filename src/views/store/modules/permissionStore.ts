import { ref } from "vue";
import { defineStore } from "pinia";
import { RouteRecordRaw } from "vue-router";
import { asyncRoutes, constantRoutes } from "@/views/router";

/**
 * Permission store — Pinia (setup-style) port of the former Vuex
 * `vuex-module-decorators` `PermissionModule`.
 *
 * Behaviour preserved exactly (WS-6 R6.1):
 *  - `routes`        = `constantRoutes` + the role-accessible subset of `asyncRoutes`.
 *  - `dynamicRoutes` = the role-accessible subset of `asyncRoutes` (what gets
 *    registered via `router.addRoute` at login).
 *  - admin short-circuit: an `admin` role bypasses per-route filtering.
 *
 * NOTE: `asyncRoutes` is currently empty (`router/index.ts`), so generation is
 * effectively a no-op today. The logic is preserved verbatim so it behaves
 * correctly the moment routes are added back.
 */
const hasPermission = (roles: string[], route: RouteRecordRaw): boolean => {
  if (route.meta && Array.isArray(route.meta.roles)) {
    const routeRoles = route.meta.roles as string[];
    return roles.some((role) => routeRoles.includes(role));
  }
  return true;
};

const filterAsyncRoutes = (
  routes: RouteRecordRaw[],
  roles: string[]
): RouteRecordRaw[] => {
  const res: RouteRecordRaw[] = [];
  routes.forEach((route) => {
    const r = { ...route };
    if (hasPermission(roles, r)) {
      if (r.children) {
        r.children = filterAsyncRoutes(r.children, roles);
      }
      res.push(r);
    }
  });
  return res;
};

export const usePermissionStore = defineStore("permission", () => {
  const routes = ref<RouteRecordRaw[]>([]);
  const dynamicRoutes = ref<RouteRecordRaw[]>([]);

  const generateRoutes = (roles: string[]): void => {
    let accessedRoutes: RouteRecordRaw[];
    if (roles.includes("admin")) {
      accessedRoutes = asyncRoutes;
    } else {
      accessedRoutes = filterAsyncRoutes(asyncRoutes, roles);
    }
    routes.value = constantRoutes.concat(accessedRoutes);
    dynamicRoutes.value = accessedRoutes;
  };

  return { routes, dynamicRoutes, generateRoutes };
});

export { hasPermission, filterAsyncRoutes };
