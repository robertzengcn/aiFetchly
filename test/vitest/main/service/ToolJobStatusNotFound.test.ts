import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests for the check_tool_job_status "always not_found" bug.
 *
 * Root cause chain (investigation 2026-10-18):
 * 1. Tool descriptions promised an obsolete polling contract ("returns
 *    { async: true, job_id }... poll check_tool_job_status") that was removed
 *    when the loop started blocking internally (b5e9caa8d, 2026-06-27). The
 *    model kept polling jobs it was never given real ids for.
 * 2. With no real job_id anywhere in context (persisted history contains
 *    none), the model fabricated "job-<uuid>" ids — the "job-" prefix came
 *    from the descriptions, the 8-char fragment from progress text
 *    ("Background job started (job_id: 08a5f06a)" emitted jobId.slice(0,8)).
 * 3. A fabricated id (or a real id from an aborted turn / previous app
 *    session — the registry is in-memory) always returned a bare not_found
 *    stub, which the model retried instead of recovering.
 *
 * Fixes under test:
 * - F1: descriptions no longer promise the { async: true, job_id } contract
 *   and explicitly forbid inventing job ids (skillsRegistry + runSubagentTool).
 * - F2: check_tool_job_status / cancel_tool_job return an explanatory `note`
 *   alongside status: "not_found" (skillsRegistry).
 * - F3: the "Background job started" progress text carries the FULL job_id,
 *   not an 8-char slice (AIChatQueryLoop.executeAsyncTool).
 */

// R9 T04: key-aware Token mock — a blanket "true" also fed USERSDBPATH,
// making every worker open the same cwd-relative `./true/` scraper.db;
// concurrent full-suite workers then hit `database is locked` during
// between-round DB bookkeeping and the turn fails. Empty dbpath takes the
// per-worker isolated TMPDIR fallback (test/vitest/_setup/isolatedTmpDir.ts).
vi.mock("@/modules/token", () => ({
  Token: class {
    constructor() {
      return {
        getValue: vi.fn(
        (key: string) => (key === "user_dbpath" ? "" : "true")
      ),
      };
    }
  },
}));

import { readFileSync } from "fs";
import { resolve } from "path";
import { SkillRegistry } from "@/config/skillsRegistry";
import type {
  SkillDefinition,
  SkillExecutionContext,
} from "@/entityTypes/skillTypes";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  ToolJobRegistry,
  setDefaultToolJobRegistry,
  type ToolJobSpawnHandle,
} from "@/service/ToolJobRegistry";
import type {
  AIChatQueryLoopInput,
  AIChatQueryEvent,
} from "@/service/AIChatQueryEvents";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

const ASYNC_POLL_INTERVAL_MS_PLUS = 20_000;

const SRC_ROOT = resolve(__dirname, "../../../..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC_ROOT, relPath), "utf8");
}

/** F1: the stale polling contract must be gone from every model-facing description. */
describe("async tool descriptions (F1)", () => {
  it("skillsRegistry extract_contact_info no longer promises the { async: true, job_id } envelope", () => {
    const src = readSrc("src/config/skillsRegistry.ts");
    expect(src).not.toContain("it returns { async: true, job_id }");
    expect(src).not.toContain("Poll the result with check_tool_job_status");
  });

  it("skillsRegistry scrape_urls_from_search_engine no longer promises the polling contract", () => {
    const src = readSrc("src/config/skillsRegistry.ts");
    expect(src).not.toContain(
      "use cancel_tool_job(job_id) if the user wants to stop early"
    );
  });

  it("runSubagentTool no longer promises the polling contract and forbids invented job ids", () => {
    const src = readSrc("src/service/agentTools/runSubagentTool.ts");
    expect(src).not.toContain("it returns { async: true, job_id }");
    expect(src).not.toContain("Poll the result with check_tool_job_status");
    expect(src).toContain("Never invent or guess a job_id");
  });

  it("check_tool_job_status description forbids polling with fabricated ids", () => {
    const src = readSrc("src/config/skillsRegistry.ts");
    expect(src).toContain(
      "Only call this with a job_id that a previous tool RESULT explicitly returned"
    );
  });
});

/**
 * F2: the not_found responses from check_tool_job_status / cancel_tool_job
 * must include the explanatory note. These tools' execute functions are
 * defined inline in skillsRegistry's BUILT_IN_SKILLS array — extract them
 * by name and invoke with a real (empty) registry.
 */
describe("check_tool_job_status not_found note (F2)", () => {
  type InlineTool = SkillDefinition;

  let registry: ToolJobRegistry;

  function findTool(name: string): InlineTool {
    // Public registry access — getSkill returns the registered definition
    // (built-ins are registered at module load).
    const tool = SkillRegistry.getSkill(name);
    if (!tool) throw new Error(`tool ${name} not found in SkillRegistry`);
    return tool;
  }

  function execContext(conversationId: string): SkillExecutionContext {
    return {
      conversationId,
      toolCallId: `call-${conversationId}`,
    };
  }

  beforeEach(() => {
    registry = new ToolJobRegistry();
    setDefaultToolJobRegistry(registry);
  });

  afterEach(() => {
    setDefaultToolJobRegistry(new ToolJobRegistry());
  });

  it("returns an explanatory note for an unknown job_id (RED without fix: bare stub)", async () => {
    const tool = findTool("check_tool_job_status");
    const res = await tool.execute(
      { job_id: "job-fabricated-0000", return_partial_if_running: true },
      execContext("conv-1")
    );
    expect(res.success).toBe(true);
    expect(res.result.status).toBe("not_found");
    expect(typeof res.result.note).toBe("string");
    expect(String(res.result.note)).toContain("Do not retry this id");
    expect(String(res.result.note)).toContain("re-run the original tool call");
  });

  it("cancel_tool_job returns the same explanatory note on unknown job_id", async () => {
    const tool = findTool("cancel_tool_job");
    const res = await tool.execute(
      { job_id: "job-fabricated-0000" },
      execContext("conv-1")
    );
    expect(res.success).toBe(true);
    expect(res.result.cancelled).toBe(false);
    expect(res.result.reason).toBe("not_found");
    expect(typeof res.result.note).toBe("string");
  });

  it("check_tool_job_status still reports a real running job without a note", async () => {
    const tool = findTool("check_tool_job_status");
    const { jobId } = registry.start(
      "run_subagent",
      {},
      { conversationId: "conv-1", toolCallId: "call-1" },
      async () => {
        await new Promise(() => {});
      }
    );
    const res = await tool.execute({ job_id: jobId }, execContext("conv-1"));
    expect(res.success).toBe(true);
    expect(res.result.status).toBe("running");
    expect(res.result).not.toHaveProperty("note");
  });

  it("check_tool_job_status reports not_found for a job id scoped to another conversation (scoping preserved)", async () => {
    const { jobId } = registry.start(
      "run_subagent",
      {},
      { conversationId: "conv-A", toolCallId: "call-1" },
      async () => {
        await new Promise(() => {});
      }
    );
    const tool = findTool("check_tool_job_status");
    const res = await tool.execute({ job_id: jobId }, execContext("conv-B"));
    expect(res.result.status).toBe("not_found");
    expect(typeof res.result.note).toBe("string");
  });
});

/** F3 harness: mirrors AIChatQueryLoopAsyncPoll.test.ts. */
class FakeJobRegistry extends ToolJobRegistry {
  statusOverrides = new Map<string, "running" | "completed">();
  resultOverrides = new Map<string, unknown>();

  override getStatus(jobId: string) {
    const override = this.statusOverrides.get(jobId);
    if (override === undefined) return super.getStatus(jobId);
    const base = super.getStatus(jobId);
    return { ...base, status: override, result: this.resultOverrides.get(jobId) ?? base.result };
  }
}

function makeToolCallChunk(
  toolCallId: string,
  toolName: string,
  argsJson: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: "function",
              function: { name: toolName, arguments: argsJson },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function makeStopChunk(): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }],
  };
}

function buildInput(
  events: AIChatQueryEvent[],
  abortController: AbortController
): AIChatQueryLoopInput {
  return {
    conversationId: "conv-test",
    assistantMessageId: "msg-test",
    messages: [],
    request: {
      message: "test",
      conversationId: "conv-test",
      model: "deepseek-v4-flash",
      mode: "chat",
    } as never,
    openAITools: [],
    abortController,
    eventSink: {
      emit: (e: AIChatQueryEvent) => {
        events.push(e);
      },
    },
    startRound: 0,
    isActiveTurn: () => true,
    skillRegistry: {
      getSkill: (name: string) =>
        name === "run_subagent" ? ({ timeoutClass: "async" } as never) : null,
    },
  };
}

/** F3: the first tool_progress message must carry the FULL job_id. */
describe("Background job started progress text (F3)", () => {
  let fake: FakeJobRegistry;
  let capturedJobIds: string[];
  let startSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fake = new FakeJobRegistry();
    capturedJobIds = [];
    setDefaultToolJobRegistry(fake);
    startSpy = vi
      .spyOn(fake, "start")
      .mockImplementation(
        (
          toolName: string,
          args: Record<string, unknown>,
          ctx: { conversationId: string; toolCallId: string },
          spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
        ) => {
          const result = ToolJobRegistry.prototype.start.call(
            fake,
            toolName,
            args,
            ctx,
            spawn
          );
          capturedJobIds.push(result.jobId);
          return result;
        }
      );
  });

  afterEach(() => {
    startSpy?.mockRestore();
    setDefaultToolJobRegistry(new ToolJobRegistry());
    vi.useRealTimers();
  });

  it("emits the full job_id (not an 8-char slice) in the Background job started progress text", async () => {
    vi.useFakeTimers();
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    // Round 0 emits the tool call; round >=1 emits stop so the loop
    // terminates after the async job result is injected (same pattern as
    // AIChatQueryLoopAsyncPoll.test.ts — a stop chunk in the SAME round as
    // the tool call would end the turn before dispatch).
    let round = 0;
    const fakeStream = vi.fn(
      async (
        _req: unknown,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ): Promise<void> => {
        if (round === 0) {
          onChunk(
            makeToolCallChunk(
              "call-f3",
              "run_subagent",
              JSON.stringify({
                agentId: "agent-lead-researcher",
                prompt: "test",
                taskPacket: { lead: { industry: "fintech" } },
              })
            )
          );
        } else {
          onChunk(makeStopChunk());
        }
        round += 1;
      }
    );

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        const jobId = capturedJobIds[capturedJobIds.length - 1];
        if (jobId) {
          fake.statusOverrides.set(jobId, "completed");
          fake.resultOverrides.set(jobId, { ok: true });
        }
        return { success: true, result: { ok: true }, execution_time_ms: 1 };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const promise = loop.run(buildInput(events, abort));
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    await promise;

    const jobId = capturedJobIds[capturedJobIds.length - 1];
    expect(jobId).toBeDefined();
    const progressEvents = events.filter((e) => e.type === "tool_progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    const started = progressEvents.find((e) =>
      String((e as { message?: string }).message ?? "").includes(
        "Background job started"
      )
    ) as { message?: string } | undefined;
    expect(started).toBeDefined();
    // RED without fix: the old text carried only jobId.slice(0, 8).
    expect(started?.message).toContain(`job_id: ${jobId}`);
  });
});
