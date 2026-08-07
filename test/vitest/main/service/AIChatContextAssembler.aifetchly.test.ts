/**
 * CTX-01 / CTX-03 — AiFetchly AGENTS.md injection into AIChatContextAssembler.
 *
 * Mirrors the mock pattern in AIChatContextAssembler.test.ts (SystemSettingModule,
 * AIChatSessionMemoryModule, AIChatCompactModule, AIChatV2Module,
 * AIUserMemoryRetrievalService) and additionally stubs AIFetchlyContextLoader
 * so the assembler's `new AIFetchlyContextLoader()` collaborator returns
 * deterministic instruction blocks.
 *
 * Three core cases (plan <behavior>):
 *   1. Populated AGENTS.md  -> injected system message; ordering > base prompt
 *      index AND < durable-memory index (CTX-01).
 *   2. Loader throws        -> assemble() still returns a valid messages array;
 *      no AGENTS.md system message (CTX-03 graceful degradation).
 *   3. Empty cache          -> no AGENTS.md system message (no regression on the
 *      empty path — same output as before Plan 13-03a).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIFetchlyInstructionBlock } from "@/entityTypes/aifetchlyConfigTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import { ai_custom_context_directive } from "@/config/settinggroupInit";

// --- shared mocks (mirror AIChatContextAssembler.test.ts) -------------------

const mockGetByConversation = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockDurableRetrieve = vi.fn();
const mockGetSettingValue = vi.fn();
const mockGetInstructionBlocks = vi.fn();

const mockListActiveForRuntime = vi.fn();

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: mockGetByConversation,
  })),
}));

vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: mockGetActiveSummary,
  })),
}));

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversationMessages: mockGetConversationMessages,
  })),
}));

vi.mock("@/service/AIUserMemoryRetrievalService", () => ({
  AIUserMemoryRetrievalService: vi.fn().mockImplementation(() => ({
    retrieve: mockDurableRetrieve,
  })),
}));

vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(() => ({
    getSettingValue: mockGetSettingValue,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

// Mock the AIFetchlyContextLoader module: replace the instance's
// getInstructionBlocks with our stub, AND keep a real-shaped static
// formatInstructionBlock so the assembler's call produces the label the
// assertions look for. The exact label wording is covered separately in
// AIFetchlyContextLoader.test.ts (Task 1) — here it just needs to be a
// stable marker.
vi.mock("@/service/aifetchlyConfig/AIFetchlyContextLoader", () => ({
  AIFetchlyContextLoader: Object.assign(
    vi.fn().mockImplementation(() => ({
      getInstructionBlocks: mockGetInstructionBlocks,
    })),
    {
      formatInstructionBlock: (block: AIFetchlyInstructionBlock): string =>
        "User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:\n\n" +
        block.content,
    }
  ),
}));

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(() => ({
    listActiveForRuntime: mockListActiveForRuntime,
  })),
}));

import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";

// --- helpers ----------------------------------------------------------------

function agentsBlock(content: string): AIFetchlyInstructionBlock {
  return {
    id: "user:instructions:AGENTS.md",
    source: "user",
    sourceId: "user",
    label: "",
    relativePath: "AGENTS.md",
    content,
    contentHash: "hash-" + content,
    trusted: true,
  };
}

const AGENTS_LABEL_PREFIX = "User global AiFetchly instructions";

function findAgentsMessage(
  messages: readonly { role: string; content: unknown }[]
): number {
  return messages.findIndex(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.startsWith(AGENTS_LABEL_PREFIX)
  );
}

describe("AIChatContextAssembler — AGENTS.md injection (CTX-01, CTX-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: no session memory, no compact, no history, no durable memory,
    // custom directive empty. Each test overrides what it needs.
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([]);
    mockDurableRetrieve.mockResolvedValue({
      memories: [],
      tokenEstimate: 0,
      contextBlock: "",
    });
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_custom_context_directive) return Promise.resolve("");
      return Promise.resolve(null); // memory injection toggle default-on, retrieve returns empty
    });
    mockGetInstructionBlocks.mockResolvedValue([]);
    // Plan 16-03 Task 3: default to an EMPTY catalog so the existing CTX-01/03
    // tests are unaffected (empty -> buildAvailableAgentsBlock returns "" ->
    // no block pushed). Tests in the D-Discovery block override
    // mockListActiveForRuntime.
    mockListActiveForRuntime.mockResolvedValue([]);
  });

  it("CTX-01: injects AGENTS.md AFTER base prompt and BEFORE durable memory", async () => {
    // Force both AGENTS.md and durable memory to be populated so ordering is
    // observable. Custom directive stays empty so it doesn't sit between them.
    mockGetInstructionBlocks.mockResolvedValue([agentsBlock("be terse")]);
    mockDurableRetrieve.mockResolvedValue({
      memories: [{ memoryId: "mem-1" }],
      tokenEstimate: 10,
      contextBlock: "Durable user memory:\nsome durable block",
    });

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "base-system-prompt",
      mode: "chat",
    });

    const baseIdx = r.messages.findIndex(
      (m) => m.content === "base-system-prompt"
    );
    expect(baseIdx).toBe(0);

    const agentsIdx = findAgentsMessage(r.messages);
    expect(agentsIdx).toBeGreaterThan(-1);

    const durableIdx = r.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Durable user memory")
    );
    expect(durableIdx).toBeGreaterThan(-1);

    // CTX-01 ordering: base < agents < durable.
    expect(agentsIdx).toBeGreaterThan(baseIdx);
    expect(agentsIdx).toBeLessThan(durableIdx);
  });

  it("CTX-01: injected content carries the labeled prefix", async () => {
    mockGetInstructionBlocks.mockResolvedValue([agentsBlock("custom-rules")]);

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });

    const agents = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith(AGENTS_LABEL_PREFIX)
    );
    expect(agents).toBeTruthy();
    expect(agents!.content as string).toContain("custom-rules");
  });

  it("CTX-03: loader throwing degrades to no-injection and does not break assemble()", async () => {
    mockGetInstructionBlocks.mockRejectedValue(new Error("loader boom"));

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });

    // assemble() must still resolve with a valid messages array.
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages[0]).toEqual({ role: "system", content: "sysp" });
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
    // And NO AGENTS.md system message should be present.
    expect(findAgentsMessage(r.messages)).toBe(-1);
  });

  it("CTX-03: empty instruction cache is a no-op (no AGENTS.md system message)", async () => {
    mockGetInstructionBlocks.mockResolvedValue([]);

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });

    expect(findAgentsMessage(r.messages)).toBe(-1);
    // The base prompt + the bare user message — no spurious system messages.
    expect(r.messages[0]).toEqual({ role: "system", content: "sysp" });
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
  });

  it("CTX-01: AGENTS.md lands AFTER the custom-context directive when both are populated", async () => {
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_custom_context_directive)
        return Promise.resolve("Always answer concisely.");
      return Promise.resolve(null);
    });
    mockGetInstructionBlocks.mockResolvedValue([agentsBlock("global rules")]);

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hi",
      baseSystemPrompt: "base",
      mode: "chat",
    });

    const directiveIdx = r.messages.findIndex(
      (m) => m.content === "Always answer concisely."
    );
    const agentsIdx = findAgentsMessage(r.messages);
    expect(directiveIdx).toBeGreaterThan(-1);
    expect(agentsIdx).toBeGreaterThan(-1);
    // Custom directive at index 1 (right after base prompt); AGENTS.md after it.
    expect(directiveIdx).toBe(1);
    expect(agentsIdx).toBeGreaterThan(directiveIdx);
  });

  it("passes the conversationId and mode through to the loader", async () => {
    mockGetInstructionBlocks.mockResolvedValue([]);

    const asm = new AIChatContextAssembler();
    await asm.assemble({
      conversationId: "conv-xyz",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "plan",
    });

    expect(mockGetInstructionBlocks).toHaveBeenCalledWith({
      conversationId: "conv-xyz",
      mode: "plan",
    });
  });
});

// --- D-Discovery: Available agents block (Plan 16-03 Task 3) ----------------
//
// The model discovers dispatchable agents via a "Available agents" system
// block (ID + one-line description + source) sourced from
// agentRegistry.list(), so it can copy the exact scoped ID into run_subagent.

const AVAILABLE_AGENTS_PREFIX = "Available AiFetchly agents";

function agentView(
  partial: Partial<AgentDefinitionView> & {
    id: string;
  }
): AgentDefinitionView {
  const source: AgentDefinitionView["source"] = partial.id.startsWith(
    "workspace:"
  )
    ? "workspace"
    : partial.id.startsWith("plugin:")
    ? "plugin"
    : partial.id.startsWith("agent-")
    ? "built-in"
    : "user";
  return {
    name: partial.name ?? "Agent",
    description: partial.description ?? "An agent.",
    version: 1,
    systemPrompt: "",
    allowedTools: [],
    mode: "specialist",
    maxToolCalls: 8,
    maxRuntimeMs: 180000,
    maxContinueCalls: 8,
    outputSchema: {},
    status: "active",
    ...partial,
    source: partial.source ?? source,
    health: partial.health ?? "healthy",
  };
}

function findAvailableAgentsMessage(
  messages: readonly { role: string; content: unknown }[]
): number {
  return messages.findIndex(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.startsWith(AVAILABLE_AGENTS_PREFIX)
  );
}

describe("AIChatContextAssembler — Available agents block (D-Discovery, Plan 16-03)", () => {
  beforeEach(() => {
    // Defaults inherited from the outer beforeEach (empty catalog). Tests in
    // this block override mockListActiveForRuntime / mockGetInstructionBlocks
    // as needed.
  });

  it("D-Discovery: injects the block AFTER instructions and BEFORE durable memory (CTX-01 ordinal)", async () => {
    // Populate all three anchors so the ordinal is observable: an AGENTS.md
    // instruction block, a non-empty runtime catalog, and a durable block.
    mockGetInstructionBlocks.mockResolvedValue([agentsBlock("global rules")]);
    mockListActiveForRuntime.mockResolvedValue([
      agentView({
        id: "agent-lead-researcher",
        name: "Lead Researcher",
        description: "Built-in research specialist.",
      }),
      agentView({
        id: "user:agent:lead-researcher",
        name: "My Researcher",
        description: "User-defined researcher.",
      }),
    ]);
    mockDurableRetrieve.mockResolvedValue({
      memories: [{ memoryId: "mem-1" }],
      tokenEstimate: 10,
      contextBlock: "Durable user memory:\nsome durable block",
    });

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "base-system-prompt",
      mode: "chat",
    });

    const agentsIdx = findAgentsMessage(r.messages);
    expect(agentsIdx).toBeGreaterThan(-1);

    const availableIdx = findAvailableAgentsMessage(r.messages);
    expect(availableIdx).toBeGreaterThan(-1);

    const durableIdx = r.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Durable user memory")
    );
    expect(durableIdx).toBeGreaterThan(-1);

    // CTX-01 ordinal: instructions < available-agents < durable memory.
    expect(availableIdx).toBeGreaterThan(agentsIdx);
    expect(availableIdx).toBeLessThan(durableIdx);

    // The block lists BOTH agents and lets the model copy the exact scoped ID.
    const block = r.messages[availableIdx].content as string;
    expect(block).toContain("agent-lead-researcher");
    expect(block).toContain("user:agent:lead-researcher");
  });

  it("D-Discovery: uses runtime catalog so persisted plugin agents are injected", async () => {
    mockListActiveForRuntime.mockResolvedValue([
      agentView({
        id: "caveman:cavecrew-builder",
        name: "cavecrew-builder",
        description: "Surgical one-file edit specialist.",
        source: "plugin",
        pluginName: "caveman",
      }),
    ]);

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "List all available agents",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });

    const availableIdx = findAvailableAgentsMessage(r.messages);
    expect(availableIdx).toBeGreaterThan(-1);
    const block = r.messages[availableIdx].content as string;
    expect(block).toContain("caveman:cavecrew-builder");
    expect(block).toContain("Surgical one-file edit specialist.");
    expect(block).toContain("[Plugin]");
  });

  it("D-Discovery: an EMPTY runtime catalog pushes NO block (skip empty)", async () => {
    mockListActiveForRuntime.mockResolvedValue([]);

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });

    expect(findAvailableAgentsMessage(r.messages)).toBe(-1);
  });

  it("D-Discovery: runtime catalog access throwing degrades to no-injection and does not break assemble() (graceful)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockListActiveForRuntime.mockRejectedValue(new Error("catalog boom"));

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });

    // assemble() must still resolve with a valid messages array.
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages[0]).toEqual({ role: "system", content: "sysp" });
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
    // No available-agents block leaked through.
    expect(findAvailableAgentsMessage(r.messages)).toBe(-1);
    // The graceful-degradation path logged the failure.
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls
      .map((c) => String(c[0]))
      .some((s) => s.includes("available agents injection failed"));
    expect(logged).toBe(true);
    spy.mockRestore();
  });
});
