import { expect } from "chai";
import {
  ToolTimeoutClass,
  TOOL_TIMEOUT_POLICY,
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("ToolTimeoutPolicy", () => {
  describe("TOOL_TIMEOUT_POLICY", () => {
    it("exposes fast/network/browser ceilings and omits async", () => {
      expect(TOOL_TIMEOUT_POLICY.fast).to.equal(30_000);
      expect(TOOL_TIMEOUT_POLICY.network).to.equal(90_000);
      expect(TOOL_TIMEOUT_POLICY.browser).to.equal(240_000);
    });
  });

  describe("resolveTimeoutMs", () => {
    it("returns the class ceiling for fast/network/browser", () => {
      expect(resolveTimeoutMs("fast")).to.equal(30_000);
      expect(resolveTimeoutMs("network")).to.equal(90_000);
      expect(resolveTimeoutMs("browser")).to.equal(240_000);
    });
    it("returns null for async (no synchronous ceiling)", () => {
      expect(resolveTimeoutMs("async")).to.equal(null);
    });
  });

  describe("inferTimeoutClassByName", () => {
    it("classifies file tools as fast", () => {
      expect(inferTimeoutClassByName("file_read")).to.equal("fast");
      expect(inferTimeoutClassByName("glob_files")).to.equal("fast");
      expect(inferTimeoutClassByName("grep_files")).to.equal("fast");
      expect(inferTimeoutClassByName("read_url_content")).to.equal("fast");
    });
    it("classifies browser-automation tools as browser", () => {
      expect(inferTimeoutClassByName("search_maps_businesses")).to.equal(
        "browser"
      );
      expect(inferTimeoutClassByName("extract_contact_info")).to.equal(
        "browser"
      );
    });
    it("classifies network tools as network", () => {
      expect(inferTimeoutClassByName("analyze_website")).to.equal("network");
      expect(inferTimeoutClassByName("search_yellow_pages")).to.equal(
        "network"
      );
    });
    it("defaults unknown tools to network (safe ceiling for unannotated I/O tools)", () => {
      expect(inferTimeoutClassByName("something_new")).to.equal("network");
    });
  });
});

import type { SkillDefinition } from "@/entityTypes/skillTypes";
import { SkillRegistry } from "@/config/skillsRegistry";
import { RUN_SUBAGENT_TOOL } from "@/service/agentTools/runSubagentTool";

describe("SkillDefinition timeout-class fields", () => {
  it("allows optional static timeoutClass", () => {
    const skill: SkillDefinition = {
      name: "x",
      description: "",
      parameters: {},
      tier: "main",
      requiresConfirmation: false,
      permissionCategory: "network",
      source: "built-in",
      execute: async () => ({ success: true, result: {} }),
      timeoutClass: "browser",
    };
    expect(skill.timeoutClass).to.equal("browser");
  });

  it("allows optional resolveTimeoutClass for argument-driven routing", () => {
    const skill: SkillDefinition = {
      name: "x",
      description: "",
      parameters: {},
      tier: "main",
      requiresConfirmation: false,
      permissionCategory: "network",
      source: "built-in",
      execute: async () => ({ success: true, result: {} }),
      resolveTimeoutClass: (args) =>
        (args.max_results as number) > 20 ? "async" : "browser",
    };
    expect(skill.resolveTimeoutClass!({ max_results: 50 })).to.equal("async");
    expect(skill.resolveTimeoutClass!({ max_results: 10 })).to.equal("browser");
  });
});

/**
 * Regression tests for the two tools that originally timed out at 30s because
 * they had no timeoutClass and the fallback classifier returned "fast".
 *
 * If either annotation is removed, the tool will silently fall back to the
 * "network" ceiling (90s) under the new default — better than 30s, but
 * still wrong for the tool's actual work. These tests make the annotation
 * contract explicit so future registry edits don't regress.
 */
describe("regression: previously-broken tool annotations", () => {
  it("scrape_urls_from_search_engine is registered with timeoutClass network + supportsPartialResult", () => {
    const skill = SkillRegistry.getSkill("scrape_urls_from_search_engine");
    expect(skill).to.not.equal(undefined);
    expect(skill?.timeoutClass).to.equal("network");
    expect(skill?.supportsPartialResult).to.equal(true);
  });

  it("run_subagent is registered with timeoutClass browser", () => {
    expect(RUN_SUBAGENT_TOOL.timeoutClass).to.equal("browser");
    const skill = SkillRegistry.getSkill("run_subagent");
    expect(skill).to.not.equal(undefined);
    expect(skill?.timeoutClass).to.equal("browser");
  });

  it("legacy scrape_urls_from_google/bing/yandex/baidu route through the same skill", () => {
    // Legacy names are remapped in SkillExecutor.resolveSearchScrapeInvocation
    // to scrape_urls_from_search_engine, so they inherit the network class.
    for (const legacy of [
      "scrape_urls_from_google",
      "scrape_urls_from_bing",
      "scrape_urls_from_yandex",
      "scrape_urls_from_baidu",
    ]) {
      // These are not registered as skills themselves; they are remapped.
      // The fallback classifier must not return "fast" for them.
      expect(inferTimeoutClassByName(legacy)).to.not.equal("fast");
    }
  });
});
