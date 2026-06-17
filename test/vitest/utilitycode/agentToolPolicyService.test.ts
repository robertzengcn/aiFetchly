// test/vitest/utilitycode/agentToolPolicyService.test.ts
import { describe, it, expect } from "vitest";
import { AgentToolPolicyService } from "@/service/AgentToolPolicyService";
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
