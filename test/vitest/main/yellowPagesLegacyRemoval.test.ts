// test/vitest/main/yellowPagesLegacyRemoval.test.ts
// AC-01/AC-18 absence tests: the built-in Yellow Pages feature is gone from
// the application graph while surviving shared surfaces remain untouched.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AVAILABLE_TOOL_FUNCTIONS } from "@/config/aiTools.config";

const repoRoot = path.resolve(__dirname, "../../..");

const GONE_FILES: string[] = [
  "src/childprocess/YellowPagesScraper.ts",
  "src/childprocess/YellowPagesScraperProcess.ts",
  "src/controller/YellowPagesController.ts",
  "src/modules/YellowPagesProcessManager.ts",
  "src/modules/YellowPagesOrchestrator.ts",
  "src/modules/YellowPagesModule.ts",
  "src/modules/YellowPagesTaskModule.ts",
  "src/modules/YellowPagesResultModule.ts",
  "src/modules/YellowPagesPlatformModule.ts",
  "src/modules/YellowPagesInitModule.ts",
  "src/modules/YellowPagesHealthCheck.ts",
  "src/main-process/communication/yellowPagesIpc.ts",
  "src/views/api/yellowpages.ts",
  "src/utils/yellowPagesProxyLaunch.ts",
  "src/views/pages/yellowpages",
  "vite.yellowPages.config.mjs",
  "test/runYellowPagesTests.ts",
  "test/yellowPagesEndToEndTest.ts",
  "test/yellowPagesIntegrationTest.ts",
];

const REMOVED_TOOL_NAMES = [
  "search_yellow_pages",
  "get_available_yellow_pages_platforms",
];

function readRepo(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("yellow pages legacy removal (AC-01/AC-18)", () => {
  it("keeps no production yellow pages files in the application tree", () => {
    for (const rel of GONE_FILES) {
      expect(existsSync(path.join(repoRoot, rel)), `exists: ${rel}`).toBe(
        false
      );
    }
  });

  it("exposes no built-in yellow pages AI tool", () => {
    const toolNames = AVAILABLE_TOOL_FUNCTIONS.map((fn) => fn.name);
    for (const gone of REMOVED_TOOL_NAMES) {
      expect(toolNames).not.toContain(gone);
    }
  });

  it("registers no yellow pages skill in the skills registry", () => {
    const registry = readRepo("src/config/skillsRegistry.ts");
    for (const gone of REMOVED_TOOL_NAMES) {
      expect(registry).not.toContain(gone);
    }
  });

  it("exposes no yellow pages AI support config entry", () => {
    const toolsConfig = readRepo("src/config/aiTools.config.ts");
    for (const gone of REMOVED_TOOL_NAMES) {
      expect(toolsConfig).not.toContain(gone);
    }
  });

  it("registers no yellow pages chat routes", () => {
    const routes = readRepo(
      "src/views/router/authenticatedFeatureRoutes.ts"
    );
    expect(routes.includes("/yellowpages")).toBe(false);
  });

  it("allowlists no yellow pages renderer channels", () => {
    const preload = readRepo("src/preload.ts");
    expect(preload.includes("yellow_pages:")).toBe(false);
  });

  it("keeps the legacy TaskType.YELLOW_PAGES enum member for persisted rows", async () => {
    const { TaskType } = await import("@/entity/ScheduleTask.entity");
    expect(TaskType.YELLOW_PAGES).toBe("yellow_pages");
  });

  it("keeps the surviving yellow pages platform adapters registered", async () => {
    const { PlatformAdapterFactory } = await import(
      "@/modules/platforms/PlatformAdapterFactory"
    );
    expect(PlatformAdapterFactory.isAdapterAvailable("ITownPageAdapter")).toBe(
      true
    );
    expect(
      PlatformAdapterFactory.isAdapterAvailable("USonarYellowPageAdapter")
    ).toBe(true);
    expect(
      PlatformAdapterFactory.isAdapterAvailable("YellowPagesComAdapter")
    ).toBe(false);
  });
});
