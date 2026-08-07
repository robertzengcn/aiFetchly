import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron's ipcMain so we can drive handlers without a real Electron.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

// registerValidatedHandler's module imports AiFeatureGate → Token. Mock Token
// so module load doesn't touch the real encrypted store.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "/tmp/aifetchly-agent-def-ipc-test";
    }
  },
}));

// Stub the module so we assert delegation without a DB.
const moduleSpies = {
  listAllForManagement: vi.fn(async () => [
    { id: "agent-lead-researcher", source: "built-in", status: "active" },
  ]),
  getForManagement: vi.fn(async () => null),
  createManualAgent: vi.fn(async (input: { idSlug: string }) => ({
    id: `user:${input.idSlug}`,
    source: "user",
    status: "active",
  })),
  updateManualAgent: vi.fn(async (agentId: string) => ({
    id: agentId,
    source: "user",
    version: 2,
  })),
  toggleAgent: vi.fn(async () => true),
  deleteManualAgent: vi.fn(async () => true),
};
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    listAllForManagement = moduleSpies.listAllForManagement;
    getForManagement = moduleSpies.getForManagement;
    createManualAgent = moduleSpies.createManualAgent;
    updateManualAgent = moduleSpies.updateManualAgent;
    toggleAgent = moduleSpies.toggleAgent;
    deleteManualAgent = moduleSpies.deleteManualAgent;
  },
}));

// Import AFTER mocks are registered.
import { registerAgentDefinitionIpcHandlers } from "@/main-process/communication/agent-definition-ipc";
import {
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_UPDATE,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_DELETE,
} from "@/config/channellist";

const VALID_CREATE = {
  idSlug: "local-verifier",
  name: "Local Verifier",
  description: "Verifies things.",
  systemPrompt: "You verify.",
  allowedTools: ["knowledge_library_search"],
  mode: "verifier" as const,
  maxToolCalls: 8,
  maxRuntimeMs: 300000,
  maxContinueCalls: 8,
};

describe("agent-definition-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    Object.values(moduleSpies).forEach((s) => s.mockClear());
    registerAgentDefinitionIpcHandlers();
  });

  it("registers all 6 management channels", () => {
    expect(handlers.has(AGENT_MANAGEMENT_LIST)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_GET)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_CREATE)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_UPDATE)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_TOGGLE)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_DELETE)).toBe(true);
  });

  it("LIST delegates to listAllForManagement and is NOT AI-gated", async () => {
    // No AI-enabled flag is consulted for management handlers; they return
    // data unconditionally (design §15.5).
    const fn = handlers.get(AGENT_MANAGEMENT_LIST)!;
    const result = (await fn({}, undefined)) as {
      status: boolean;
      data: unknown;
    };
    expect(result.status).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(moduleSpies.listAllForManagement).toHaveBeenCalledTimes(1);
  });

  it("GET rejects an empty agentId", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_GET)!;
    const result = (await fn({}, { agentId: "" })) as { status: boolean };
    expect(result.status).toBe(false);
    expect(moduleSpies.getForManagement).not.toHaveBeenCalled();
  });

  it("GET delegates with the parsed agentId", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_GET)!;
    await fn({}, { agentId: "user:foo" });
    expect(moduleSpies.getForManagement).toHaveBeenCalledWith("user:foo");
  });

  it("CREATE rejects a missing required field (name)", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_CREATE)!;
    const result = (await fn({}, { ...VALID_CREATE, name: "" })) as {
      status: boolean;
    };
    expect(result.status).toBe(false);
    expect(moduleSpies.createManualAgent).not.toHaveBeenCalled();
  });

  it("CREATE delegates the parsed input and returns the created view", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_CREATE)!;
    const result = (await fn({}, VALID_CREATE)) as {
      status: boolean;
      data: { id: string };
    };
    expect(result.status).toBe(true);
    expect(result.data.id).toBe("user:local-verifier");
    expect(moduleSpies.createManualAgent).toHaveBeenCalledWith(
      expect.objectContaining({ idSlug: "local-verifier" })
    );
  });

  it("UPDATE rejects an invalid mode", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_UPDATE)!;
    const result = (await fn({}, {
      agentId: "user:foo",
      mode: "bogus",
    })) as { status: boolean };
    expect(result.status).toBe(false);
    expect(moduleSpies.updateManualAgent).not.toHaveBeenCalled();
  });

  it("UPDATE splits agentId from the patch before delegating", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_UPDATE)!;
    await fn({}, { agentId: "user:foo", description: "updated" });
    expect(moduleSpies.updateManualAgent).toHaveBeenCalledWith(
      "user:foo",
      expect.not.objectContaining({ agentId: "user:foo" })
    );
    expect(moduleSpies.updateManualAgent).toHaveBeenCalledWith(
      "user:foo",
      expect.objectContaining({ description: "updated" })
    );
  });

  it("TOGGLE delegates with agentId + enabled", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_TOGGLE)!;
    await fn({}, { agentId: "lead-pack:reviewer", enabled: false });
    expect(moduleSpies.toggleAgent).toHaveBeenCalledWith(
      "lead-pack:reviewer",
      false
    );
  });

  it("DELETE delegates the agentId", async () => {
    const fn = handlers.get(AGENT_MANAGEMENT_DELETE)!;
    await fn({}, { agentId: "user:foo" });
    expect(moduleSpies.deleteManualAgent).toHaveBeenCalledWith("user:foo");
  });
});
