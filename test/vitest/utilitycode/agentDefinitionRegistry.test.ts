// test/vitest/utilitycode/agentDefinitionRegistry.test.ts
import { describe, it, expect } from "vitest";
import { AgentDefinitionRegistry } from "@/service/AgentDefinitionRegistry";

describe("AgentDefinitionRegistry", () => {
  it("returns only built-in active definitions", () => {
    const defs = AgentDefinitionRegistry.listBuiltIns();
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d.status).toBe("active");
      expect(d.id.startsWith("agent-")).toBe(true);
    }
  });

  it("exposes agent-lead-researcher as a specialist", () => {
    const d = AgentDefinitionRegistry.getById("agent-lead-researcher");
    expect(d).not.toBeNull();
    expect(d!.mode).toBe("specialist");
    expect(d!.allowedTools.length).toBeGreaterThan(0);
    expect(d!.systemPrompt.length).toBeGreaterThan(50);
  });

  it("returns null for unknown agents", () => {
    expect(AgentDefinitionRegistry.getById("agent-does-not-exist")).toBeNull();
  });

  it("every definition declares an outputSchema and a non-empty systemPrompt", () => {
    for (const d of AgentDefinitionRegistry.listBuiltIns()) {
      expect(d.outputSchema).toBeDefined();
      expect(d.systemPrompt.trim().length).toBeGreaterThan(0);
    }
  });
});
