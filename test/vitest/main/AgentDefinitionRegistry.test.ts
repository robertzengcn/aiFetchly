import { describe, it, expect } from "vitest";
import {
  AgentDefinitionRegistry,
  AgentDefinitionRegistryImpl,
} from "@/service/AgentDefinitionRegistry";

describe("AgentDefinitionRegistry built-ins", () => {
  it("exposes agent-batch-worker with the PRD allowlist + output schema", () => {
    const def = AgentDefinitionRegistry.getById("agent-batch-worker");
    expect(def).not.toBeNull();
    expect(def?.name).toBe("Batch Worker");
    expect(def?.mode).toBe("specialist");
    expect(def?.source).toBe("built-in");
    expect(def?.health).toBe("healthy");
    expect(def?.maxRuntimeMs).toBe(240000);
    expect(def?.maxToolCalls).toBe(6);
    expect(def?.maxContinueCalls).toBe(4);
    // file-handling tools; infra tools (check_tool_job_status/cancel_tool_job)
    // are auto-injected by AgentToolPolicyService, not declared here.
    expect(def?.allowedTools).toEqual([
      "glob_files",
      "attach_local_images",
      "file_read",
    ]);
    const schema = def?.outputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toEqual([
      "status",
      "processedFiles",
      "summary",
      "errors",
    ]);
    expect(schema.properties).toHaveProperty("processedFiles");
  });

  it("still exposes agent-lead-researcher (no regression)", () => {
    expect(
      AgentDefinitionRegistry.getById("agent-lead-researcher")?.id
    ).toBe("agent-lead-researcher");
  });

  it("lists both built-ins", () => {
    const ids = AgentDefinitionRegistry.list().map((a) => a.id);
    expect(ids).toContain("agent-lead-researcher");
    expect(ids).toContain("agent-batch-worker");
  });

  it("a fresh instance also seeds the batch worker (constructor registers built-ins)", () => {
    const fresh = new AgentDefinitionRegistryImpl();
    expect(fresh.getById("agent-batch-worker")?.id).toBe("agent-batch-worker");
    expect(fresh.listBuiltIns().map((a) => a.id)).toContain("agent-batch-worker");
  });
});
