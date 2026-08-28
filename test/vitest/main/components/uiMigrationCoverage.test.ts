import { describe, expect, it } from "vitest";
import { constantRoutes } from "@/views/router/index";
import { validateUiRouteCoverage } from "@/views/router/validateUiRouteCoverage";
import {
  uiMigrationRegistry,
  IN_SCOPE_SURFACE_COUNT,
} from "@/views/router/uiMigrationRegistry";

describe("inner-page convergence registry (PRD §4.1, IPR-054/055/056)", () => {
  const report = validateUiRouteCoverage(constantRoutes);

  it("keeps the redesigned AI workspace route loadable through the active layout", async () => {
    const workspaceRoute = constantRoutes.find(
      (route) => route.path === "/aiworkspace"
    );
    const workspacePage = workspaceRoute?.children?.find(
      (route) => route.name === "AI_Chat_Workspace"
    );

    expect(workspaceRoute?.component).toBeDefined();
    expect(workspacePage?.component).toBeTypeOf("function");

    const loadWorkspace = workspacePage?.component as
      | (() => Promise<unknown>)
      | undefined;
    await expect(loadWorkspace?.()).resolves.toBeDefined();
  });

  it("classifies every active route with no gaps or overlaps", () => {
    expect(report.issues).toEqual([]);
  });

  it("covers exactly the 50 in-scope customer-facing surfaces", () => {
    expect(report.inScopeSurfaceCount).toBe(IN_SCOPE_SURFACE_COUNT);
    expect(IN_SCOPE_SURFACE_COUNT).toBe(50);
  });

  it("never uses menu visibility as scope evidence (IPR-054)", () => {
    // Hidden-but-customer-reachable routes must still be surfaces.
    const surfaced = new Set(
      report.surfaces.flatMap((s) => s.routeNames)
    );
    for (const hidden of [
      "Email_Marketing_Template_Create",
      "CreateSocialAccount",
      "EditSearchTask",
      "AI_Auto_Reply_Audit_Detail",
    ]) {
      expect(surfaced.has(hidden)).toBe(true);
    }
  });

  it("excludes statistics pending the retention decision (IPR-056)", () => {
    const statistic = report.exclusions.find(
      (e) => e.routeName === "statistic_page"
    );
    expect(statistic?.reason).toBe("statistics-pending-decision");
    // And no redesign work: statistics is not a surface.
    expect(
      report.surfaces.some((s) => s.routeNames.includes("statistic_page"))
    ).toBe(false);
  });

  it("keeps every surface on a known template with a family", () => {
    const templates = new Set([
      "landing",
      "collection",
      "form",
      "detail",
      "results",
      "settings",
    ]);
    for (const surface of uiMigrationRegistry) {
      expect(templates.has(surface.template)).toBe(true);
      expect(surface.family.length).toBeGreaterThan(0);
      expect(surface.routeNames.length).toBeGreaterThan(0);
    }
  });
});
