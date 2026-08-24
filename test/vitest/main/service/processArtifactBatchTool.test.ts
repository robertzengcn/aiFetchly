import { describe, expect, it, vi } from "vitest";
import type { OpenAIChatImage } from "@/api/aiChatApi";
import type { AgentResult } from "@/entityTypes/agentTypes";
import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";
import type { ImageDetail } from "@/entityTypes/aiImageAttachmentToolTypes";
import {
  GeneratedImageReferenceError,
  type AuthorizedGeneratedImageSource,
  type PreparedGeneratedImageArtifact,
} from "@/entityTypes/generatedImageReferenceTypes";
import {
  ArtifactBatchProcessingService,
  PROCESS_ARTIFACT_BATCH_TOOL,
  type ArtifactBatchProcessingDeps,
  type ArtifactBatchResult,
  type ArtifactBatchWorkerInput,
  type ArtifactBatchWorkerSource,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ArtifactBatchProcessingService", () => {
  it("runs isolated item operations concurrently and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;
    const runAgent = vi.fn(
      async ({ source }: { source: ArtifactBatchWorkerSource }) => {
        if (source.kind !== "workspace_file") {
          throw new Error(`unexpected source kind: ${String(source)}`);
        }
        const file = source.file;
        expect(source.workspaceRoot).toBe("/workspace");
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        active -= 1;
        return agentResult({
          id: `task-${file}`,
          images: [image(`${file}.png`)],
        });
      }
    );
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
      runAgent: vi.fn(
        async ({ source }: { source: ArtifactBatchWorkerSource }) => {
          if (source.kind !== "workspace_file") throw new Error("unexpected");
          const file = source.file;
          return file === "bad.jpg"
            ? agentResult({
                id: "task-bad",
                images: [],
                errorMessage: "provider rejected the image",
              })
            : agentResult({
                id: `task-${file}`,
                images: [image(`${file}.png`), image(`${file}-alternate.png`)],
              });
        }
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
      runAgent: vi.fn(
        async ({ source }: { source: ArtifactBatchWorkerSource }) => {
          if (source.kind !== "workspace_file") throw new Error("unexpected");
          controller.abort();
          return agentResult({ id: `task-${source.file}`, images: [] });
        }
      ),
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
  function reference(index: number): ChatV2GeneratedImageReference {
    return { messageId: `message-${index}`, imageIndex: index % 50 };
  }

  function referenceKey(reference: ChatV2GeneratedImageReference): string {
    return `${reference.messageId}:${reference.imageIndex}`;
  }

  function authorizedFor(
    reference: ChatV2GeneratedImageReference
  ): AuthorizedGeneratedImageSource {
    return {
      reference,
      conversationId: "conversation-1",
      sourceMessageId: reference.messageId,
      protocolUrl: `aifetchly-generated-image://local/u/c/${reference.messageId}/${reference.imageIndex}.png`,
      fileName: `${reference.messageId}-${reference.imageIndex}.png`,
      absolutePath: `/store/u/c/${reference.messageId}/${reference.imageIndex}.png`,
    };
  }

  function artifactFor(
    authorized: AuthorizedGeneratedImageSource,
    detail: ImageDetail
  ): PreparedGeneratedImageArtifact {
    return {
      reference: authorized.reference,
      fileName: authorized.fileName,
      mimeType: "image/png",
      width: 64,
      height: 64,
      preparedSizeBytes: 128,
      dataUrl: `data:image/png;base64,${referenceKey(authorized.reference)}`,
      detail,
    };
  }

  interface GeneratedHarness {
    deps: ArtifactBatchProcessingDeps;
    runAgent: ReturnType<typeof vi.fn>;
    authorizeReferences: ReturnType<typeof vi.fn>;
    prepareReferences: ReturnType<typeof vi.fn>;
    resolveWorkspace: ReturnType<typeof vi.fn>;
  }

  function generatedDeps(): GeneratedHarness {
    const runAgent = vi.fn(
      async ({ source }: { source: ArtifactBatchWorkerSource }) => {
        if (source.kind !== "generated_image") throw new Error("unexpected");
        return agentResult({
          id: `task-${referenceKey(source.authorized.reference)}`,
          images: [
            image(`${referenceKey(source.authorized.reference)}.png`),
          ],
        });
      }
    );
    const authorizeReferences = vi.fn(
      async (
        _conversationId: string,
        references: readonly ChatV2GeneratedImageReference[]
      ) => references.map((ref) => authorizedFor(ref))
    );
    const prepareReferences = vi.fn(
      async (
        sources: readonly AuthorizedGeneratedImageSource[],
        detail: ImageDetail
      ) => sources.map((source) => artifactFor(source, detail))
    );
    const resolveWorkspace = vi.fn(async () => null);
    return {
      deps: { resolveWorkspace, runAgent, authorizeReferences, prepareReferences },
      runAgent,
      authorizeReferences,
      prepareReferences,
      resolveWorkspace,
    };
  }

  function refs(count: number): ChatV2GeneratedImageReference[] {
    return Array.from({ length: count }, (_, index) => reference(index));
  }

  it("completes without resolving a workspace and passes trusted artifacts", async () => {
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
    const firstInput = harness.runAgent.mock
      .calls[0][0] as ArtifactBatchWorkerInput;
    expect(firstInput.source.kind).toBe("generated_image");
    if (firstInput.source.kind === "generated_image") {
      expect(firstInput.source.authorized.absolutePath).toContain("m1");
      expect(firstInput.source.artifact.dataUrl.startsWith("data:image/png")).toBe(
        true
      );
    }
  });

  it("bounds inflight provider work and keeps results in input order", async () => {
    const harness = generatedDeps();
    let active = 0;
    let maxActive = 0;
    const total = 5;
    harness.runAgent.mockImplementation(
      async ({ source }: { source: ArtifactBatchWorkerSource }) => {
        if (source.kind !== "generated_image") throw new Error("unexpected");
        const index = Number(
          referenceKey(source.authorized.reference).split("-")[1]
        );
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay((total - index) * 5);
        active -= 1;
        return agentResult({
          id: `task-${index}`,
          images: [image(`out-${index}.png`)],
        });
      }
    );
    const service = new ArtifactBatchProcessingService(harness.deps);

    const response = await service.execute(
      {
        generatedImageReferences: refs(total),
        instruction: "edit",
        concurrency: 3,
      },
      context()
    );

    expect(response.success).toBe(true);
    const result = response.result as ArtifactBatchResult;
    expect(result.status).toBe("completed");
    expect(result.completedCount).toBe(total);
    expect(harness.runAgent).toHaveBeenCalledTimes(total);
    expect(maxActive).toBe(3);
    expect(result.items.map((item) => item.input)).toEqual(
      refs(total).map((ref) => ({
        kind: "generated_image" as const,
        reference: ref,
      }))
    );
    const serialized = JSON.stringify(response);
    expect(serialized.includes("data:image/")).toBe(false);
  });

  it("prepares exactly one source lazily inside each concurrency slot", async () => {
    const harness = generatedDeps();
    const events: string[] = [];
    harness.prepareReferences.mockImplementation(
      async (sources: readonly AuthorizedGeneratedImageSource[], detail: ImageDetail) => {
        if (sources.length !== 1) {
          throw new Error(`expected one source, got ${sources.length}`);
        }
        events.push(`prepare:${sources[0].reference.messageId}`);
        return sources.map((source) => artifactFor(source, detail));
      }
    );
    harness.runAgent.mockImplementation(
      async ({ source }: { source: ArtifactBatchWorkerSource }) => {
        if (source.kind !== "generated_image") throw new Error("unexpected");
        events.push(`run:${source.authorized.reference.messageId}`);
        await delay(10);
        return agentResult({ id: "task-run", images: [image("done.png")] });
      }
    );
    const service = new ArtifactBatchProcessingService(harness.deps);

    const response = await service.execute(
      {
        generatedImageReferences: refs(5),
        instruction: "edit",
        concurrency: 3,
      },
      context()
    );

    expect(response.success).toBe(true);
    expect(events.filter((event) => event.startsWith("prepare:"))).toHaveLength(5);
    const firstRunsAt = events.findIndex((event) => event.startsWith("run:"));
    expect(events.slice(0, firstRunsAt)).toHaveLength(3);
    expect(events.indexOf("run:message-0")).toBeLessThan(
      events.indexOf("prepare:message-3")
    );
  });

  it("isolates a per-item preparation failure and reports its mapped errorCode", async () => {
    const harness = generatedDeps();
    harness.prepareReferences.mockImplementation(
      async (sources: readonly AuthorizedGeneratedImageSource[], detail: ImageDetail) => {
        const failing = sources.find(
          (source) => source.reference.messageId === "message-2"
        );
        if (failing) {
          throw new GeneratedImageReferenceError(
            "generated_image_unsupported_type"
          );
        }
        return sources.map((source) => artifactFor(source, detail));
      }
    );
    const service = new ArtifactBatchProcessingService(harness.deps);

    const response = await service.execute(
      {
        generatedImageReferences: refs(5),
        instruction: "edit",
        concurrency: 3,
      },
      context()
    );

    expect(response.success).toBe(true);
    const result = response.result as ArtifactBatchResult;
    expect(result.status).toBe("partial");
    expect(result.completedCount).toBe(4);
    expect(result.failedCount).toBe(1);
    expect(harness.runAgent).toHaveBeenCalledTimes(4);
    const failed = result.items[2];
    expect(failed.input).toEqual({
      kind: "generated_image",
      reference: { messageId: "message-2", imageIndex: 2 },
    });
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("generated_image_unsupported_type");
    expect(JSON.stringify(response).includes("data:image/")).toBe(false);
  });

  it("marks queued generated items cancelled with the batch errorCode on abort", async () => {
    const controller = new AbortController();
    const harness = generatedDeps();
    harness.runAgent.mockImplementation(
      async ({ source }: { source: ArtifactBatchWorkerSource }) => {
        if (source.kind !== "generated_image") throw new Error("unexpected");
        if (source.authorized.reference.messageId === "message-0") {
          controller.abort();
          return agentResult({
            id: "task-first",
            images: [image("kept.png")],
          });
        }
        return agentResult({ id: "task-rest", images: [image("rest.png")] });
      }
    );
    const service = new ArtifactBatchProcessingService(harness.deps);

    const response = await service.execute(
      {
        generatedImageReferences: refs(4),
        instruction: "edit",
        concurrency: 1,
      },
      context(controller.signal)
    );

    const result = response.result as ArtifactBatchResult;
    expect(result.completedCount).toBe(1);
    expect(result.cancelledCount).toBe(3);
    expect(result.items[0].status).toBe("completed");
    expect(result.items.slice(1)).toMatchObject(
      refs(3).map(() => ({
        status: "cancelled",
        errorCode: "generated_image_batch_cancelled",
      }))
    );
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
    expect(harness.prepareReferences).toHaveBeenCalledTimes(2);
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
