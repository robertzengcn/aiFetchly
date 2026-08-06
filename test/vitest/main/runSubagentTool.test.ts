import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the runtime registry so run_subagent returns a controlled AgentResult
// without spawning a real sub-agent. __setFakeResult lets each test swap the
// value runSync resolves to.
let fakeResult: Record<string, unknown> = {
  status: "completed",
  agentTaskId: "agt-1",
  agentId: "agent-batch-worker",
  output: {},
  sourceUrls: [],
  confidence: 0.5,
};
vi.mock("@/service/AgentRuntimeRegistry", () => ({
  AgentRuntimeRegistry: {
    getRuntime: () => ({ runSync: async () => fakeResult }),
  },
  getDefaultAgentRuntimeDeps: () => ({}),
  __setFakeResult: (r: Record<string, unknown>): void => {
    fakeResult = r;
  },
}));

import { RUN_SUBAGENT_TOOL } from "@/service/agentTools/runSubagentTool";
// @ts-expect-error -- test-only export added by the vi.mock factory above
import { __setFakeResult } from "@/service/AgentRuntimeRegistry";

const ctx = { conversationId: "conv-1", model: "m" } as never;

describe("run_subagent result forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes outputFilePaths + outputImages when the agent produced files", async () => {
    __setFakeResult({
      status: "completed",
      agentTaskId: "agt-1",
      agentId: "agent-batch-worker",
      output: { status: "completed" },
      sourceUrls: [],
      confidence: 0.9,
      outputFilePaths: ["/p/image-1.png", "/p/image-2.png"],
      outputImages: [
        {
          type: "image",
          local_path: "/p/image-1.png",
          url: "aifetchly-generated-image://local/u/c/m/image-1.png",
          mime_type: "image/png",
        },
      ],
    });
    const res = await RUN_SUBAGENT_TOOL.execute?.(
      {
        agentId: "agent-batch-worker",
        prompt: "edit",
        taskPacket: { files: ["/p/a.png"], instruction: "white bg" },
      },
      ctx
    );
    expect(res?.success).toBe(true);
    expect(res?.result.outputFilePaths).toEqual([
      "/p/image-1.png",
      "/p/image-2.png",
    ]);
    expect(res?.result.outputImages).toHaveLength(1);
  });

  it("omits output fields and reports failure when the agent failed (FR-5)", async () => {
    __setFakeResult({
      status: "failed",
      agentTaskId: "agt-2",
      agentId: "agent-batch-worker",
      output: {},
      sourceUrls: [],
      errorMessage: "boom",
    });
    const res = await RUN_SUBAGENT_TOOL.execute?.(
      {
        agentId: "agent-batch-worker",
        prompt: "edit",
        taskPacket: { files: [], instruction: "x" },
      },
      ctx
    );
    expect(res?.success).toBe(false);
    expect(res?.result.error).toBe("boom");
    expect(res?.result.outputFilePaths).toBeUndefined();
  });

  it("surfaces a cancelled sub-agent as success=false with status cancelled (FR-6)", async () => {
    __setFakeResult({
      status: "cancelled",
      agentTaskId: "agt-3",
      agentId: "agent-batch-worker",
      output: {},
      sourceUrls: [],
    });
    const res = await RUN_SUBAGENT_TOOL.execute?.(
      {
        agentId: "agent-batch-worker",
        prompt: "edit",
        taskPacket: { files: ["/p/a.png"], instruction: "x" },
      },
      ctx
    );
    expect(res?.success).toBe(false);
    expect(res?.result.status).toBe("cancelled");
  });
});
