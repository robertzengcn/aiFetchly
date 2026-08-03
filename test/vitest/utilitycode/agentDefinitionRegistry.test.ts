// test/vitest/utilitycode/agentDefinitionRegistry.test.ts
// Phase 16 (AGT-01) — rewritten for the source-aware AgentDefinitionRegistry class.
//
// The registry was refactored from an object literal into AgentDefinitionRegistryImpl
// (a structural clone of CommandRegistry with the divergent D-Precedence rank
// order). The legacy `AgentDefinitionRegistry` symbol is preserved as a
// ready-made singleton instance so existing consumers
// (AgentDefinitionModule.ensureBuiltIns, agentToolPolicyService.test,
// ToolTimeoutPolicy.test) keep compiling untouched.
//
// This lightweight suite covers the public listBuiltIns contract that the
// utilitycode test stack has always exercised. The exhaustive class-behavior
// suite lives in test/vitest/main/service/AgentDefinitionRegistry.test.ts.
import { describe, it, expect } from "vitest";
import {
  AgentDefinitionRegistry,
  AgentDefinitionRegistryImpl,
} from "@/service/AgentDefinitionRegistry";

describe("AgentDefinitionRegistry (class API)", () => {
  it("listBuiltIns returns only built-in active definitions", () => {
    const defs = AgentDefinitionRegistry.listBuiltIns();
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d.status).toBe("active");
      expect(d.id.startsWith("agent-")).toBe(true);
    }
  });

  it("exposes agent-lead-researcher as a specialist via the singleton", () => {
    const d = AgentDefinitionRegistry.getById("agent-lead-researcher");
    expect(d).not.toBeNull();
    expect(d!.mode).toBe("specialist");
    expect(d!.allowedTools.length).toBeGreaterThan(0);
    expect(d!.systemPrompt.length).toBeGreaterThan(50);
  });

  it("returns null for unknown agents", () => {
    expect(AgentDefinitionRegistry.getById("agent-does-not-exist")).toBeNull();
  });

  it("every built-in declares an outputSchema and a non-empty systemPrompt", () => {
    for (const d of AgentDefinitionRegistry.listBuiltIns()) {
      expect(d.outputSchema).toBeDefined();
      expect(d.systemPrompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("a fresh instance also seeds built-ins (RESEARCH Pitfall 1)", () => {
    const r = new AgentDefinitionRegistryImpl();
    expect(r.getById("agent-lead-researcher")).not.toBeNull();
    expect(r.listBuiltIns().length).toBe(AgentDefinitionRegistry.listBuiltIns().length);
  });

  it("the singleton exposes the new source-aware API (replaceSource + list)", () => {
    // Smoke test: the class API is available on the legacy singleton too.
    expect(typeof AgentDefinitionRegistry.replaceSource).toBe("function");
    expect(typeof AgentDefinitionRegistry.list).toBe("function");
    // Built-ins are present in list() as well.
    expect(AgentDefinitionRegistry.list().map((d) => d.id)).toContain(
      "agent-lead-researcher"
    );
  });
});
