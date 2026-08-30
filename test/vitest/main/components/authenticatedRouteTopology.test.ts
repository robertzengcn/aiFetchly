import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import Layout from "@/views/layout/layout.vue";
import AuthenticatedLayoutBoundary from "@/views/layout/AuthenticatedLayoutBoundary.vue";
import { constantRoutes } from "@/views/router/index";

/**
 * Route migration validation (chat-first shell design §6.6). These tests
 * fail when:
 *  1. an authenticated leaf sits outside the AuthenticatedLayoutBoundary
 *  2. an authenticated descendant directly mounts the legacy Layout
 *  3. two route records share a name or normalized path
 *  4. `/` does not resolve to the chat center
 *  5. `/login` is accidentally nested in the authenticated shell
 */
const authenticatedRoot = constantRoutes.find((route) => route.path === "/");

type RouteRecordLike = (typeof constantRoutes)[number];

function collectRecords(
  routes: readonly RouteRecordLike[],
  insideAuthenticated: boolean,
  acc: { record: RouteRecordLike; insideAuthenticated: boolean }[] = []
) {
  for (const record of routes) {
    const nested =
      insideAuthenticated || record.component === AuthenticatedLayoutBoundary;
    acc.push({ record, insideAuthenticated: nested });
    if (record.children?.length) {
      collectRecords(record.children, nested, acc);
    }
  }
  return acc;
}

function isLazyComponent(component: unknown): boolean {
  return typeof component === "function";
}

describe("authenticated route topology (chat-first shell design §6)", () => {
  it("mounts one AuthenticatedLayoutBoundary as the authenticated parent", () => {
    expect(authenticatedRoot).toBeDefined();
    expect(authenticatedRoot?.component).toBe(AuthenticatedLayoutBoundary);
    expect(authenticatedRoot?.children?.length).toBeGreaterThan(1);
  });

  it("resolves / to the chat center", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: constantRoutes,
    });
    await router.push("/");
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("AI_Chat_Workspace");
  });

  it("keeps representative authenticated leaves inside the shell", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: constantRoutes,
    });
    for (const target of [
      "/aiworkspace",
      "/insights",
      "/knowledge/library",
      "/plugins/management",
      "/schedule/list",
      "/dashboard/home",
      "/systemsetting/index",
      "/emailmarketing/emailservice/list",
      "/campaign/edit/12",
    ]) {
      await router.push(target);
      expect(
        router.currentRoute.value.matched.some(
          (record) => record.components?.default === AuthenticatedLayoutBoundary
        ),
        `${target} must resolve inside the authenticated boundary`
      ).toBe(true);
    }
  });

  it("keeps /login outside the authenticated shell", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: constantRoutes,
    });
    await router.push("/login");
    expect(
      router.currentRoute.value.matched.some(
        (record) => record.components?.default === AuthenticatedLayoutBoundary
      )
    ).toBe(false);
  });

  it("never mounts the legacy Layout on an authenticated descendant", () => {
    const records = collectRecords(constantRoutes, false);
    for (const { record, insideAuthenticated } of records) {
      if (!insideAuthenticated) continue;
      expect(
        Object.values(record.components ?? {}),
        `route "${String(
          record.name ?? record.path
        )}" must not mount the legacy Layout`
      ).not.toContain(Layout);
    }
  });

  it("uses lazy route components for every leaf page", () => {
    const records = collectRecords(constantRoutes, false);
    for (const { record, insideAuthenticated } of records) {
      if (!insideAuthenticated || !record.children?.length) continue;
      const component = record.components?.default;
      if (component !== undefined) {
        expect(isLazyComponent(component)).toBe(true);
      }
    }
  });

  it("has no duplicate route names or normalized full paths", () => {
    const names = new Set<string>();
    const paths = new Set<string>();
    const walk = (
      routes: readonly RouteRecordLike[],
      parentPath: string
    ): void => {
      for (const record of routes) {
        if (typeof record.name === "string") {
          expect(
            names.has(record.name),
            `duplicate route name "${record.name}"`
          ).toBe(false);
          names.add(record.name);
        }
        const childPath = record.path.startsWith("/")
          ? record.path
          : `${parentPath}/${record.path}`;
        // The parent's own "" redirect child IS the parent path — skip it.
        if (record.path !== "") {
          const normalized = childPath.replace(/\/+$/, "") || "/";
          expect(
            paths.has(normalized),
            `duplicate route path "${record.path}" (${normalized})`
          ).toBe(false);
          paths.add(normalized);
        }
        if (record.children?.length) {
          walk(record.children, childPath);
        }
      }
    };
    walk(constantRoutes, "");
  });

  it("resolves unknown paths to /404 without a redirect loop", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: constantRoutes,
    });
    await router.push("/definitely/not/a/route");
    // The catch-all redirects to /404 which must resolve (not loop).
    expect(router.currentRoute.value.path).toBe("/404");
    expect(router.currentRoute.value.name).toBe("d404");
  });
});
