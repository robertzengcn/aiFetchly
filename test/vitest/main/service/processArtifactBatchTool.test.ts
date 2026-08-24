import { describe, expect, it, vi } from "vitest";
import type { OpenAIChatImage } from "@/api/aiChatApi";
import type { AgentResult } from "@/entityTypes/agentTypes";
import { GeneratedImageReferenceError } from "@/entityTypes/generatedImageReferenceTypes";
import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";
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
      { kind: "workspace_file", path: "a.jpg" },
      { kind: "workspace_file", path: "b.jpg" },
      { kind: "workspace_file", path: "c.jpg" },
      { kind: "workspace_file", path: "d.jpg" },
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

  it("rejects passing both sources and neither source", async () => {
    const service = new ArtifactBatchProcessingService({
      resolveWorkspace: vi.fn(async () => ({ rootPath: "/workspace" })),
      runAgent: vi.fn(),
    });

    const both = await service.execute(
      {
        files: ["a.jpg"],
        generatedImageReferences: [{ messageId: "m1", imageIndex: 0 }],
        instruction: "edit",
      },
      context()
    );
    const neither = await service.execute(
      { instruction: "edit" },
      context()
    );

    expect(both.success).toBe(false);
    expect(both.result).toMatchObject({
      error: expect.stringContaining("mutually exclusive"),
    });
    expect(neither.success).toBe(false);
    expect(neither.result).toMatchObject({
      error: expect.stringContaining("`files` or `generatedImageReferences`"),
    });
  });
});

describe("ArtifactBatchProcessingService generated-image sources", () => {
  function reference(index: number): { messageId: string; imageIndex: number } {
    return { messageId: `message-${index}`, imageIndex: index % 50 };
  }

  function generatedDeps(): {
    deps: ArtifactBatchProcessingDeps;
    runAgent: ReturnType<typeof vi.fn>;
    authorizeReferences: ReturnType<typeof vi.fn>;
    resolveWorkspace: ReturnType<typeof vi.fn>;
  } {
    const runAgent = vi.fn(
      async ({
        generatedImage,
      }: {
        generatedImage?: ChatV2GeneratedImageReference;
      }) =>
        agentResult({
          id: `task-${generatedImage?.messageId}-${generatedImage?.imageIndex}`,
          images: [image(`${generatedImage?.messageId}.png`)],
        })
    );
    const authorizeReferences = vi.fn(async () => []);
    const resolveWorkspace = vi.fn(async () => null);
    return {
      deps: { resolveWorkspace, runAgent, authorizeReferences },
      runAgent,
      authorizeReferences,
      resolveWorkspace,
    };
  }

  it("completes without resolving a workspace", async () => {
    const harness = generatedDeps();
    const service = new ArtifactBatchProcessingService(harness.deps);

    const response = await service.execute(
      {
        generatedImageReferences: [
          { messageId: "m1", imageIndex: 0 },
          { messageId: "m2", imageIndex: 1 },
        ],
        instruction: "add a dog beside the lion",
      },
      context()
    );

    expect(harness.resolveWorkspace).not.toHaveBeenCalled();
    expect(harness.authorizeReferences).toHaveBeenCalledWith(
      "conversation-1",
      [
        { messageId: "m1", imageIndex: 0 },
        { messageId: "m2", imageIndex: 1 },
      ]
    );
    expect(response.success).toBe(true);
    const result = response.result as ArtifactBatchResult;
    expect(result.status).toBe("completed");
    expect(result.completedCount).toBe(2);
    expect(result.items.map((item) => item.input)).toEqual([
      { kind: "generated_image", reference: { messageId: "m1", imageIndex: 0 } },
      { kind: "generated_image", reference: { messageId: "m2", imageIndex: 1 } },
    ]);
  });

  it("fails every requested reference in order when authorization rejects the set", async () => {
    const runAgent = vi.fn();
    const service = new ArtifactBatchProcessingService({
      resolveWorkspace: vi.fn(async () => ({ rootPath: "/workspace" })),
      runAgent,
      authorizeReferences: vi.fn(async () => {
        throw new GeneratedImageReferenceError(
          "generated_image_not_owned",
          "reference belongs to another conversation"
        );
      }),
    });

    const response = await service.execute(
      {
        generatedImageReferences: [
          { messageId: "m1", imageIndex: 0 },
          { messageId: "m2", imageIndex: 1 },
        ],
        instruction: "edit",
      },
      context()
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
    const result = response.result as ArtifactBatchResult;
    expect(result.status).toBe("failed");
    expect(result.completedCount).toBe(0);
    expect(result.failedCount).toBe(2);
    expect(
      result.items.map((item) =>
        item.input.kind === "generated_image" ? item.input.reference : null
      )
    ).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 1 },
    ]);
    expect(
      result.items.map((item) => ({
        status: item.status,
        errorCode: item.errorCode,
      }))
    ).toEqual([
      { status: "failed", errorCode: "generated_image_not_owned" },
      { status: "failed", errorCode: "generated_image_not_owned" },
    ]);
  });

  it("collapses duplicate references before scheduling", async () => {
    const harness = generatedDeps();
    const service = new ArtifactBatchProcessingService(harness.deps);

    const response = await service.execute(
      {
        generatedImageReferences: [
          { messageId: "m1", imageIndex: 0 },
          { messageId: "m1", imageIndex: 0 },
          { messageId: "m1", imageIndex: 1 },
        ],
        instruction: "edit",
      },
      context()
    );

    expect(response.success).toBe(true);
    const result = response.result as ArtifactBatchResult;
    expect(result.requestedCount).toBe(2);
    expect(harness.runAgent).toHaveBeenCalledTimes(2);
  });

  it("rejects more than 50 unique references", async () => {
    const harness = generatedDeps();
    const service = new ArtifactBatchProcessingService(harness.deps);

    const response = await service.execute(
      {
        generatedImageReferences: Array.from({ length: 51 }, (_, index) =>
          reference(index)
        ),
        instruction: "edit",
      },
      context()
    );

    expect(harness.authorizeReferences).not.toHaveBeenCalled();
    expect(harness.runAgent).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
    expect(response.result).toMatchObject({
      error: expect.stringContaining("Too many generated image references"),
    });
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
    expect(properties.generatedImageReferences.maxItems).toBe(50);
    expect(properties.concurrency.maximum).toBe(3);
    expect(properties.processor.enum).toEqual(["image_edit"]);
    expect(PROCESS_ARTIFACT_BATCH_TOOL.parameters.required).toEqual([
      "instruction",
    ]);
  });

  it("shows every requested path in the permission preview", () => {
    const preview = PROCESS_ARTIFACT_BATCH_TOOL.buildPermissionPreview?.({
      files: ["a.jpg", "b.jpg"],
    });
    expect(preview?.items).toEqual(["a.jpg", "b.jpg"]);
  });

  it("previews generated references as safe labels without paths", () => {
    const preview = PROCESS_ARTIFACT_BATCH_TOOL.buildPermissionPreview?.({
      generatedImageReferences: [
        { messageId: "msg-abc", imageIndex: 2 },
        { messageId: "msg-def", imageIndex: 0 },
      ],
    });
    expect(preview?.items).toEqual([
      "message=msg-abc image=2",
      "message=msg-def image=0",
    ]);
    for (const item of preview?.items ?? []) {
      expect(item.includes("/")).toBe(false);
    }
    expect(preview?.destinationLabel.length ?? 0).toBeGreaterThan(0);
  });

  it("returns no preview without a recognizable source", () => {
    expect(PROCESS_ARTIFACT_BATCH_TOOL.buildPermissionPreview?.({})).toBeUndefined();
  });
});
