/**
 * Production-wiring tests for the mandatory final request preflight
 * (technical-design §8.5; PRD FR-04/FR-08, AC-11/AC-16).
 *
 * Every engine consumer — interactive (ai-chat-v2-ipc createQueryLoop),
 * scheduled (AIChatQueryEngineFactory), and isolated subagents
 * (AgentRuntime) — must construct its AIChatQueryLoop with a
 * requestBudgetService so EVERY dispatch is budget-checked after retrieval,
 * tool rounds, and model fallback. Budget-service unit tests alone do not
 * establish that production requests are checked.
 *
 * Done when: production-wiring tests prove every dispatch is checked and
 * oversized mandatory input fails without truncation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockIpcMain } from "../../utils/electron-mocks";

vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "";
    }
  },
}));

import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";

/** Tiny deterministic limits: 1k context, 128 output reserve. */
function tinyLimits() {
  return { contextLimit: 1_000, outputLimit: 128, limitSource: "configured" as const };
}

function oversizedInput(): AIChatQueryLoopInput {
  return {
    conversationId: "v2-wiring",
    assistantMessageId: "asst-wiring",
    // ~5,000 chars ≈ 1,250+ tokens of MANDATORY current-user content alone.
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "m".repeat(5_000) },
    ],
    request: {
      message: "oversized mandatory input",
      model: "tiny-model",
      conversationId: "v2-wiring",
      mode: "chat",
    },
    openAITools: [],
    abortController: new AbortController(),
    eventSink: { emit: () => undefined },
    startRound: 0,
    isActiveTurn: () => true,
  };
}

describe("AIChat engine budget wiring (§8.5 mandatory preflight)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects oversized mandatory input without truncation when the budget service is wired", async () => {
    const stream = vi.fn();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
      requestBudgetService: new AIChatRequestBudgetService(),
      resolveModelLimits: tinyLimits,
    });
    const result = await loop.run(oversizedInput());
    expect(result.type).toBe("failed");
    expect(stream).not.toHaveBeenCalled();
    const err = (result as { error: unknown }).error;
    expect(String((err as Error)?.message ?? err)).toMatch(
      /budget|too large|capacity/i
    );
  });

  it("wires the budget service into the interactive production loop", async () => {
    const { createQueryLoop } = await import(
      "@/main-process/communication/ai-chat-v2-ipc"
    );
    const loop = createQueryLoop();
    // Reach into the (private-by-convention) deps to prove the mandatory
    // preflight dependency exists on the interactive path.
    const deps = (loop as unknown as { deps: Record<string, unknown> }).deps;
    expect(deps.requestBudgetService).toBeInstanceOf(
      AIChatRequestBudgetService
    );
  });

  it("wires the budget service into scheduled-engine loops", async () => {
    const { AIChatQueryEngineFactory } = await import(
      "@/service/AIChatQueryEngineFactory"
    );
    const factory = new AIChatQueryEngineFactory();
    const engine = factory.createScheduled({
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
      maxToolCalls: 1,
      maxRuntimeMs: 1_000,
      maxContinueCalls: 1,
    });
    const loop = (engine as unknown as { loop: AIChatQueryLoop }).loop;
    const deps = (loop as unknown as { deps: Record<string, unknown> }).deps;
    expect(deps.requestBudgetService).toBeInstanceOf(
      AIChatRequestBudgetService
    );
  });
});
