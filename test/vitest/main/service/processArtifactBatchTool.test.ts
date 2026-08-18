import { describe, expect, it, vi } from "vitest";
import type { OpenAIChatImage } from "@/api/aiChatApi";
import type { AgentResult } from "@/entityTypes/agentTypes";
import {
  ArtifactBatchProcessingService,
  PROCESS_ARTIFACT_BATCH_TOOL,
  type ArtifactBatchProcessingDeps,
  type ArtifactBatchResult,
} from "@/service/agentTools/processArtifactBatchTool";

function image(path: string): OpenAIChatImage {
  return {
    type: "image",
    delivery: "local_file",
    url: `aifetchly-generated-image://local/${path}`,
    local_path: `/generated/${path}`,
  };
}

function agentResult(input: {
  id: string;
  images?: OpenAIChatImage[];
  status?: AgentResult["status"];
  errorMessage?: string;
}): AgentResult {
  const images = input.images ?? [];
  return {
    agentTaskId: input.id,
    agentId: "agent-batch-worker",
    agentVersion: 1,
    status: input.status ?? "completed",
    output: {},
    text: "done",
    toolCallsCount: 1,
    sourceUrls: [],
    outputImages: images,
    outputFilePaths: images
      .map((entry) => entry.local_path)
      .filter((path): path is string => typeof path === "string"),
    errorMessage: input.errorMessage,
  };
}

function context(signal?: AbortSignal) {
  return {
    conversationId: "conversation-1",
    toolCallId: "call-1",
    model: "test-model",
    signal,
  };
}

describe("ArtifactBatchProcessingService", () => {
  it("runs isolated item operations concurrently and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;
    const runAgent = vi.fn(async ({ file }: { file: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return agentResult({
        id: `task-${file}`,
        images: [image(`${file}.png`)],
      });
    });
    const deps: ArtifactBatchProcessingDeps = {
      resolveWorkspace: vi.fn(async () => ({ rootPath: "/workspace" })),
      runAgent,
    };
    const service = new ArtifactBatchProcessingService(deps);

    const response = await service.execute(
      {
        files: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
        instruction: "make the background white",
        concurrency: 3,
      },
      context()
    );

    expect(response.success).toBe(true);
    const result = response.result as ArtifactBatchResult;
    expect(result.status).toBe("completed");
    expect(result.completedCount).toBe(4);
    expect(result.items.map((item) => item.input)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
      "d.jpg",
    ]);
    expect(result.outputImages).toHaveLength(4);
    expect(maxActive).toBe(3);
  });

  it("returns partial results without dropping successful artifact metadata", async () => {
    const deps: ArtifactBatchProcessingDeps = {
      resolveWorkspace: vi.fn(async () => ({ rootPath: "/workspace" })),
      runAgent: vi.fn(async ({ file }: { file: string }) =>
        file === "bad.jpg"
          ? agentResult({
              id: "task-bad",
              images: [],
              errorMessage: "provider rejected the image",
            })
          : agentResult({
              id: `task-${file}`,
              images: [image(`${file}.png`), image(`${file}-alternate.png`)],
            })
      ),
    };
    const service = new ArtifactBatchProcessingService(deps);

    const response = await service.execute(
      {
        files: ["good.jpg", "bad.jpg"],
        instruction: "edit",
      },
      context()
    );

    expect(response.success).toBe(true);
    const result = response.result as ArtifactBatchResult;
    expect(result.status).toBe("partial");
    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.outputImages).toHaveLength(2);
    expect(result.items[0].agentTaskId).toBe("task-good.jpg");
    expect(result.items[1].error).toBe("provider rejected the image");
  });

  it("does not start provider work without an approved workspace", async () => {
    const runAgent = vi.fn();
    const service = new ArtifactBatchProcessingService({
      resolveWorkspace: vi.fn(async () => null),
      runAgent,
    });

    const response = await service.execute(
      { files: ["a.jpg"], instruction: "edit" },
      context()
    );

    expect(response.success).toBe(false);
    expect(response.result).toEqual({
      error: "An approved workspace is required for artifact batch processing.",
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("marks queued items cancelled after the parent aborts", async () => {
    const controller = new AbortController();
    const service = new ArtifactBatchProcessingService({
      resolveWorkspace: vi.fn(async () => ({ rootPath: "/workspace" })),
      runAgent: vi.fn(async ({ file }: { file: string }) => {
        controller.abort();
        return agentResult({ id: `task-${file}`, images: [] });
      }),
    });

    const response = await service.execute(
      {
        files: ["a.jpg", "b.jpg", "c.jpg"],
        instruction: "edit",
        concurrency: 1,
      },
      context(controller.signal)
    );

    const result = response.result as ArtifactBatchResult;
    expect(result.cancelledCount).toBe(3);
    expect(result.items.every((item) => item.status === "cancelled")).toBe(
      true
    );
  });

  it("rejects unsupported processors and unsafe concurrency values", async () => {
    const service = new ArtifactBatchProcessingService({
      resolveWorkspace: vi.fn(async () => ({ rootPath: "/workspace" })),
      runAgent: vi.fn(),
    });

    const unsupported = await service.execute(
      { files: ["a.jpg"], instruction: "edit", processor: "audio" },
      context()
    );
    const excessive = await service.execute(
      { files: ["a.jpg"], instruction: "edit", concurrency: 4 },
      context()
    );

    expect(unsupported.success).toBe(false);
    expect(excessive.success).toBe(false);
  });
});

describe("PROCESS_ARTIFACT_BATCH_TOOL", () => {
  it("is an async filesystem tool with a bounded generic schema", () => {
    expect(PROCESS_ARTIFACT_BATCH_TOOL.async).toBe(true);
    expect(PROCESS_ARTIFACT_BATCH_TOOL.permissionCategory).toBe("filesystem");
    expect(PROCESS_ARTIFACT_BATCH_TOOL.requiresConfirmation).toBe(true);
    expect(PROCESS_ARTIFACT_BATCH_TOOL.resolveTimeoutClass?.({})).toBe("async");
    const properties = PROCESS_ARTIFACT_BATCH_TOOL.parameters
      .properties as Record<string, Record<string, unknown>>;
    expect(properties.files.maxItems).toBe(50);
    expect(properties.concurrency.maximum).toBe(3);
    expect(properties.processor.enum).toEqual(["image_edit"]);
  });

  it("shows every requested path in the permission preview", () => {
    const preview = PROCESS_ARTIFACT_BATCH_TOOL.buildPermissionPreview?.({
      files: ["a.jpg", "b.jpg"],
    });
    expect(preview?.items).toEqual(["a.jpg", "b.jpg"]);
  });
});
