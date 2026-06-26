// test/vitest/utilitycode/agentToolPolicyService.test.ts
import { describe, it, expect } from "vitest";
import { AgentToolPolicyService } from "@/service/AgentToolPolicyService";
import { AgentDefinitionRegistry } from "@/service/AgentDefinitionRegistry";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

const researcher: AgentDefinitionView = {
  id: "agent-lead-researcher",
  name: "Lead Researcher",
  description: "",
  version: 1,
  systemPrompt: "",
  allowedTools: ["google_search", "scrape_urls_from_search_engine"],
  mode: "specialist",
  maxToolCalls: 8,
  maxRuntimeMs: 180000,
  maxContinueCalls: 8,
  outputSchema: {},
  status: "active",
};

describe("AgentToolPolicyService", () => {
  it("allows tools in the agent allowlist", () => {
    const svc = new AgentToolPolicyService();
    const decision = svc.checkToolCall({
      definition: researcher,
      toolName: "google_search",
      executionMode: "foreground",
      allowInteractivePermissionPrompts: true,
    });
    expect(decision.allowed).toBe(true);
  });

  it("blocks tools not in the allowlist", () => {
    const svc = new AgentToolPolicyService();
    const decision = svc.checkToolCall({
      definition: researcher,
      toolName: "send_email",
      executionMode: "foreground",
      allowInteractivePermissionPrompts: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockedEventType).toBe("agent_blocked_tool");
    expect(decision.reason).toContain("send_email");
  });

  it("blocks tools in constraints.blockedTools even if allowlisted", () => {
    const svc = new AgentToolPolicyService();
    const decision = svc.checkToolCall({
      definition: researcher,
      toolName: "google_search",
      executionMode: "foreground",
      allowInteractivePermissionPrompts: true,
      blockedTools: ["google_search"],
    });
    expect(decision.allowed).toBe(false);
  });

  it("blocks shell/email/social categories for every v1 agent", () => {
    const svc = new AgentToolPolicyService();
    for (const name of ["run_shell", "send_email", "post_social_message"]) {
      const decision = svc.checkToolCall({
        definition: { ...researcher, allowedTools: [name] },
        toolName: name,
        executionMode: "foreground",
        allowInteractivePermissionPrompts: true,
      });
      expect(decision.allowed).toBe(false);
    }
  });

  it("filterExposedToolNames intersects allowlist with available tool names", () => {
    const svc = new AgentToolPolicyService();
    const exposed = svc.filterExposedToolNames({
      allowedTools: researcher.allowedTools,
      availableToolNames: ["google_search", "send_email", "other"],
    });
    expect(exposed).toEqual(["google_search"]);
  });
});

/**
 * Mandatory infrastructure tools — the async-polling lifecycle.
 *
 * Any agent that can call at least one tool can also trigger an async-routed
 * tool (run_subagent, extract_contact_info with 8+ URLs, etc.) and therefore
 * must be able to poll/cancel the resulting jobs. Declaring these per-agent
 * is fragile: a new agent author would have to remember to add them, and the
 * omission is silent (the inner agent stalls after receiving a
 * { async: true, job_id } envelope). The policy service auto-injects them
 * so the contract is structural.
 */
describe("AgentToolPolicyService — mandatory infrastructure tools", () => {
  const INFRA_TOOLS = ["check_tool_job_status", "cancel_tool_job"];

  describe("filterExposedToolNames", () => {
    it("auto-includes infrastructure tools even when not in allowedTools", () => {
      const svc = new AgentToolPolicyService();
      const exposed = svc.filterExposedToolNames({
        allowedTools: ["scrape_urls_from_search_engine"],
        availableToolNames: [
          "scrape_urls_from_search_engine",
          ...INFRA_TOOLS,
          "other_tool",
        ],
      });
      expect(exposed).toContain("check_tool_job_status");
      expect(exposed).toContain("cancel_tool_job");
    });

    it("does not inject infrastructure tools when allowlist is empty (tool-less agent)", () => {
      const svc = new AgentToolPolicyService();
      const exposed = svc.filterExposedToolNames({
        allowedTools: [],
        availableToolNames: INFRA_TOOLS,
      });
      expect(exposed).toEqual([]);
    });

    it("respects blockedTools even for infrastructure tools", () => {
      const svc = new AgentToolPolicyService();
      const exposed = svc.filterExposedToolNames({
        allowedTools: ["scrape_urls_from_search_engine"],
        availableToolNames: ["scrape_urls_from_search_engine", ...INFRA_TOOLS],
        blockedTools: ["check_tool_job_status"],
      });
      expect(exposed).not.toContain("check_tool_job_status");
      expect(exposed).toContain("cancel_tool_job");
    });

    it("does not duplicate infrastructure tools when already in allowedTools", () => {
      const svc = new AgentToolPolicyService();
      const exposed = svc.filterExposedToolNames({
        allowedTools: [
          "scrape_urls_from_search_engine",
          "check_tool_job_status",
        ],
        availableToolNames: ["scrape_urls_from_search_engine", ...INFRA_TOOLS],
      });
      const checkCount = exposed.filter(
        (n) => n === "check_tool_job_status"
      ).length;
      expect(checkCount).toBe(1);
    });
  });

  describe("checkToolCall", () => {
    it("allows infrastructure tools even when not in allowedTools (non-empty allowlist)", () => {
      const svc = new AgentToolPolicyService();
      const decision = svc.checkToolCall({
        definition: {
          ...researcher,
          allowedTools: ["scrape_urls_from_search_engine"],
        },
        toolName: "check_tool_job_status",
        executionMode: "foreground",
        allowInteractivePermissionPrompts: true,
      });
      expect(decision.allowed).toBe(true);
    });

    it("blocks infrastructure tools when allowlist is empty (tool-less agent)", () => {
      const svc = new AgentToolPolicyService();
      const decision = svc.checkToolCall({
        definition: { ...researcher, allowedTools: [] },
        toolName: "check_tool_job_status",
        executionMode: "foreground",
        allowInteractivePermissionPrompts: true,
      });
      expect(decision.allowed).toBe(false);
    });
  });

  /**
   * Registry invariant: every active built-in agent with a non-empty
   * allowlist exposes the polling tools via the filter. This is the
   * structural replacement for declaring them per-agent.
   */
  describe("registry: every built-in agent can poll async jobs", () => {
    AgentDefinitionRegistry.listBuiltIns().forEach((agent) => {
      it(`${agent.id} exposes infrastructure tools via filter`, () => {
        const svc = new AgentToolPolicyService();
        const exposed = svc.filterExposedToolNames({
          allowedTools: agent.allowedTools,
          availableToolNames: [...agent.allowedTools, ...INFRA_TOOLS],
        });
        for (const infra of INFRA_TOOLS) {
          expect(exposed, `${agent.id} must expose ${infra}`).toContain(infra);
        }
      });
    });
  });
});
