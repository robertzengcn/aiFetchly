import type { RouteRecordRaw } from "vue-router";
import {
  uiMigrationRegistry,
  uiExcludedRoutes,
  IN_SCOPE_SURFACE_COUNT,
  type UiMigrationEntry,
  type UiExcludedRoute,
} from "@/views/router/uiMigrationRegistry";

/**
 * Development/test coverage validation (design §8.3). Walks the ACTIVE route
 * registry and proves every route is classified — a surface or an explicit
 * exclusion. `meta.visible` never excludes a route (IPR-054).
 */

export interface UiCoverageIssue {
  readonly kind: "unclassified-route" | "duplicate-classification" | "count";
  readonly detail: string;
}

export interface UiCoverageReport {
  readonly surfaces: readonly UiMigrationEntry[];
  readonly exclusions: readonly UiExcludedRoute[];
  readonly issues: readonly UiCoverageIssue[];
  readonly inScopeSurfaceCount: number;
}

function collectRouteNames(
  routes: readonly RouteRecordRaw[],
  seen = new Set<string>()
): string[] {
  for (const route of routes) {
    if (typeof route.name === "string" && route.name.length > 0) {
      seen.add(route.name);
    }
    if (route.children && route.children.length > 0) {
      collectRouteNames(route.children, seen);
    }
  }
  return [...seen];
}

/** Validate registry completeness against the active router definitions. */
export function validateUiRouteCoverage(
  routes: readonly RouteRecordRaw[]
): UiCoverageReport {
  const activeNames = collectRouteNames(routes);
  const issues: UiCoverageIssue[] = [];

  const surfaceByRoute = new Map<string, UiMigrationEntry>();
  for (const surface of uiMigrationRegistry) {
    for (const routeName of surface.routeNames) {
      const existing = surfaceByRoute.get(routeName);
      if (existing) {
        issues.push({
          kind: "duplicate-classification",
          detail: `Route "${routeName}" appears in both "${existing.surfaceId}" and "${surface.surfaceId}"`,
        });
      } else {
        surfaceByRoute.set(routeName, surface);
      }
    }
  }

  const excludedNames = new Set(
    uiExcludedRoutes.map((entry) => entry.routeName)
  );

  for (const routeName of activeNames) {
    const classified =
      surfaceByRoute.has(routeName) || excludedNames.has(routeName);
    if (!classified) {
      issues.push({
        kind: "unclassified-route",
        detail: `Active route "${routeName}" is neither a registry surface nor an explicit exclusion`,
      });
    }
  }

  // Registry hygiene: classifications for routes that no longer exist.
  for (const routeName of surfaceByRoute.keys()) {
    if (!activeNames.includes(routeName)) {
      issues.push({
        kind: "unclassified-route",
        detail: `Registry classifies unknown route "${routeName}"`,
      });
    }
  }

  if (uiMigrationRegistry.length !== IN_SCOPE_SURFACE_COUNT) {
    issues.push({
      kind: "count",
      detail: `Expected ${IN_SCOPE_SURFACE_COUNT} in-scope surfaces, registry has ${uiMigrationRegistry.length}`,
    });
  }

  return {
    surfaces: uiMigrationRegistry,
    exclusions: uiExcludedRoutes,
    issues,
    inScopeSurfaceCount: uiMigrationRegistry.length,
  };
}
