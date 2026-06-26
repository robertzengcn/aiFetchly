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
import { AgentDefinitionRegistry } from "@/service/AgentDefinitionRegistry";

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

  it("run_subagent routes unconditionally to async (no synchronous ceiling)", () => {
    // Previously declared timeoutClass: "browser" (240s). That caused the
    // outer executeToolWithTimeout to race the subagent and orphan inner
    // work when the subagent's own tool calls took the wall-clock past
    // 240s. Now resolveTimeoutClass always returns "async" so the loop
    // dispatches via executeAsyncTool and returns { async, job_id }.
    expect(RUN_SUBAGENT_TOOL.resolveTimeoutClass).to.be.a("function");
    expect(RUN_SUBAGENT_TOOL.resolveTimeoutClass!({})).to.equal("async");
    expect(
      RUN_SUBAGENT_TOOL.resolveTimeoutClass!({
        agentId: "agent-lead-researcher",
        prompt: "anything",
        taskPacket: { lead: {} },
      })
    ).to.equal("async");
    expect(RUN_SUBAGENT_TOOL.async).to.equal(true);
    const skill = SkillRegistry.getSkill("run_subagent");
    expect(skill).to.not.equal(undefined);
    expect(skill?.resolveTimeoutClass!({})).to.equal("async");
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

  /**
   * Regression: extract_contact_info was hard-coded to timeoutClass "browser"
   * (240s) with no dynamic routing. For url batches >= 8 the worker routinely
   * runs longer than 240s (its own inner ceiling is 300s), so the outer race
   * always fired first and orphaned the worker. This test pins the routing
   * that sends heavy batches to the async path.
   */
  describe("extract_contact_info dynamic async routing", () => {
    const skill = SkillRegistry.getSkill("extract_contact_info");

    it("is registered", () => {
      expect(skill).to.not.equal(undefined);
    });

    it("routes batches of 7 or fewer URLs to browser (synchronous, 240s ceiling)", () => {
      expect(skill?.resolveTimeoutClass).to.be.a("function");
      for (const count of [0, 1, 3, 5, 7]) {
        const urls = Array.from(
          { length: count },
          (_, i) => `https://example.com/${i}`
        );
        expect(
          skill!.resolveTimeoutClass!({ urls }),
          `for ${count} urls`
        ).to.equal("browser");
      }
    });

    it("routes batches of 8 or more URLs to async (no synchronous ceiling)", () => {
      for (const count of [8, 12, 20, 50]) {
        const urls = Array.from(
          { length: count },
          (_, i) => `https://example.com/${i}`
        );
        expect(
          skill!.resolveTimeoutClass!({ urls }),
          `for ${count} urls`
        ).to.equal("async");
      }
    });

    it("treats missing urls as a small batch (browser, not async)", () => {
      expect(skill!.resolveTimeoutClass!({})).to.equal("browser");
      expect(skill!.resolveTimeoutClass!({ urls: "not-an-array" })).to.equal(
        "browser"
      );
    });
  });

  /**
   * Regression: the inner agent's tool allowlist must include the async-
   * polling infrastructure tools (check_tool_job_status, cancel_tool_job).
   *
   * Without these, when an inner agent calls any async-routed tool
   * (extract_contact_info with 8+ URLs, run_subagent, etc.) it receives
   * a { async: true, job_id } envelope from its own tool call but has no
   * way to poll the result — the whole async-polling architecture is
   * unreachable from inside the subagent and the agent stalls.
   *
   * This test pins the contract for every active agent: if you can call
   * any tool, you can poll/cancel any async job in the same conversation.
   */
  describe("agent allowlists include async-polling infrastructure", () => {
    const POLLING_TOOLS = ["check_tool_job_status", "cancel_tool_job"];

    AgentDefinitionRegistry.listBuiltIns().forEach((agent) => {
      it(`${agent.id} allows async-polling tools`, () => {
        for (const toolName of POLLING_TOOLS) {
          expect(
            agent.allowedTools,
            `${agent.id} must allow ${toolName}`
          ).to.include(toolName);
        }
      });

      it(`${agent.id} has no stale tool references (all allowedTools exist in registry)`, () => {
        for (const toolName of agent.allowedTools) {
          expect(
            SkillRegistry.isRegistered(toolName),
            `${agent.id} references unknown tool ${toolName}`
          ).to.equal(true);
        }
      });
    });
  });
});
