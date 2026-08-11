import type { OpenAIChatImage, ToolExecutionResult } from "@/api/aiChatApi";
import type {
  PermissionPreview,
  ImageDetail,
} from "@/entityTypes/aiImageAttachmentToolTypes";
import type {
  SkillDefinition,
  SkillExecutionContext,
} from "@/entityTypes/skillTypes";
import type { AgentResult } from "@/entityTypes/agentTypes";
import {
  AIImageAttachmentToolService,
  createDefaultAIImageAttachmentToolDeps,
} from "@/service/AIImageAttachmentToolService";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";

const PROCESSOR_IMAGE_EDIT = "image_edit";
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 3;
const MAX_BATCH_ITEMS = 50;

interface ParsedBatchArgs {
  files: string[];
  instruction: string;
  processor: typeof PROCESSOR_IMAGE_EDIT;
  concurrency: number;
  detail: ImageDetail;
}

interface ArtifactBatchItemResult {
  input: string;
  status: "completed" | "failed" | "cancelled";
  agentTaskId?: string;
  outputFilePaths: string[];
  outputImages: OpenAIChatImage[];
  error?: string;
  storageWarning?: string;
  durationMs: number;
}

export interface ArtifactBatchResult {
  status: "completed" | "partial" | "failed" | "cancelled";
  processor: typeof PROCESSOR_IMAGE_EDIT;
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  concurrency: number;
  items: ArtifactBatchItemResult[];
  outputFilePaths?: string[];
  outputImages?: OpenAIChatImage[];
}

export interface ArtifactBatchProcessingDeps {
  resolveWorkspace: (
    conversationId: string
  ) => Promise<{ rootPath: string } | null>;
  runAgent: (input: {
    file: string;
    instruction: string;
    model?: string;
    parentConversationId: string;
    workspaceRoot: string;
    detail: ImageDetail;
    signal?: AbortSignal;
  }) => Promise<AgentResult>;
}

function parseArgs(
  args: Record<string, unknown>
): { ok: true; value: ParsedBatchArgs } | { ok: false; error: string } {
  if (!Array.isArray(args.files)) {
    return { ok: false, error: "`files` must be an array." };
  }
  const files: string[] = [];
  for (const file of args.files) {
    if (typeof file !== "string" || file.trim().length === 0) {
      return { ok: false, error: "Every `files` entry must be a path string." };
    }
    if (!files.includes(file)) files.push(file);
  }
  if (files.length === 0 || files.length > MAX_BATCH_ITEMS) {
    return {
      ok: false,
      error: `Provide between 1 and ${MAX_BATCH_ITEMS} unique files.`,
    };
  }
  if (
    typeof args.instruction !== "string" ||
    args.instruction.trim().length === 0
  ) {
    return { ok: false, error: "`instruction` is required." };
  }
  const processor = args.processor ?? PROCESSOR_IMAGE_EDIT;
  if (processor !== PROCESSOR_IMAGE_EDIT) {
    return {
      ok: false,
      error: `Unsupported processor: ${String(processor)}.`,
    };
  }
  const rawConcurrency = args.concurrency ?? DEFAULT_CONCURRENCY;
  if (
    typeof rawConcurrency !== "number" ||
    !Number.isInteger(rawConcurrency) ||
    rawConcurrency < 1 ||
    rawConcurrency > MAX_CONCURRENCY
  ) {
    return {
      ok: false,
      error: `\`concurrency\` must be an integer from 1 to ${MAX_CONCURRENCY}.`,
    };
  }
  const rawDetail = args.detail ?? "auto";
  if (rawDetail !== "auto" && rawDetail !== "low" && rawDetail !== "high") {
    return { ok: false, error: "`detail` must be auto, low, or high." };
  }
  return {
    ok: true,
    value: {
      files,
      instruction: args.instruction.trim(),
      processor,
      concurrency: rawConcurrency,
      detail: rawDetail,
    },
  };
}

function destinationLabel(): string {
  const remote = process.env.VITE_REMOTEADD;
  if (typeof remote !== "string" || remote.length === 0) {
    return "the configured AI server";
  }
  try {
    return new URL(remote).host || remote;
  } catch {
    return remote;
  }
}

function buildPermissionPreview(
  args: Record<string, unknown>
): PermissionPreview | undefined {
  if (!Array.isArray(args.files)) return undefined;
  const items = args.files
    .filter(
      (file): file is string => typeof file === "string" && file.length > 0
    )
    .slice(0, MAX_BATCH_ITEMS);
  if (items.length === 0) return undefined;
  return {
    kind: "file_transfer",
    titleKey: "aiChatV2.imageTool.permissionTitle",
    descriptionKey: "aiChatV2.imageTool.permissionDescription",
    items,
    destinationLabel: destinationLabel(),
  };
}

function wrapSkillResult(input: {
  toolCallId: string;
  toolName: string;
  startedAt: number;
  result: Awaited<ReturnType<AIImageAttachmentToolService["execute"]>>;
}): ToolExecutionResult {
  return {
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    success: input.result.success,
    result: input.result.result,
    execution_time_ms: Date.now() - input.startedAt,
    ...(input.result.modelArtifacts
      ? { modelArtifacts: input.result.modelArtifacts }
      : {}),
  };
}

function createDefaultDeps(): ArtifactBatchProcessingDeps {
  const resolver = new WorkspaceResolver();
  return {
    resolveWorkspace: (conversationId) => resolver.resolve(conversationId),
    runAgent: async (input) => {
      // Lazy imports break the registry cycle:
      // skillsRegistry -> this tool -> AgentRuntime -> skillsRegistry.
      const [{ AgentRuntimeRegistry }, { SkillExecutor }] = await Promise.all([
        import("@/service/AgentRuntimeRegistry"),
        import("@/service/SkillExecutor"),
      ]);
      const runtime = AgentRuntimeRegistry.getRuntime();
      const imageDeps = createDefaultAIImageAttachmentToolDeps({
        destinationLabel: destinationLabel(),
      });
      const attachmentService = new AIImageAttachmentToolService({
        ...imageDeps,
        resolveWorkspace: async () => ({ rootPath: input.workspaceRoot }),
      });
      return runtime.runSync(
        {
          agentId: "agent-batch-worker",
          prompt: `Process exactly one image. Apply this instruction: ${input.instruction}`,
          taskPacket: {
            files: [input.file],
            instruction: input.instruction,
          },
          parentConversationId: input.parentConversationId,
          model: input.model,
          executionMode: "foreground",
        },
        {
          signal: input.signal,
          executeTool: async (name, _args, context) => {
            if (name === "attach_local_images") {
              const startedAt = Date.now();
              const result = await attachmentService.execute(
                { paths: [input.file], detail: input.detail },
                context
              );
              return wrapSkillResult({
                toolCallId: context.toolCallId,
                toolName: name,
                startedAt,
                result,
              });
            }
            return SkillExecutor.execute(name, _args, context);
          },
        }
      );
    },
  };
}

export class ArtifactBatchProcessingService {
  constructor(
    private readonly deps: ArtifactBatchProcessingDeps = createDefaultDeps()
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<{
    success: boolean;
    result: ArtifactBatchResult | { error: string };
  }> {
    const parsed = parseArgs(args);
    if (!parsed.ok) return { success: false, result: { error: parsed.error } };
    const batch = parsed.value;
    const workspace = await this.deps.resolveWorkspace(context.conversationId);
    if (!workspace) {
      return {
        success: false,
        result: {
          error:
            "An approved workspace is required for artifact batch processing.",
        },
      };
    }

    const results: ArtifactBatchItemResult[] = new Array(batch.files.length);
    let nextIndex = 0;
    const runNext = async (): Promise<void> => {
      while (nextIndex < batch.files.length) {
        const index = nextIndex;
        nextIndex += 1;
        const file = batch.files[index];
        if (context.signal?.aborted) {
          results[index] = {
            input: file,
            status: "cancelled",
            outputFilePaths: [],
            outputImages: [],
            error: "Batch processing was cancelled.",
            durationMs: 0,
          };
          continue;
        }
        const startedAt = Date.now();
        try {
          const agent = await this.deps.runAgent({
            file,
            instruction: batch.instruction,
            model: context.model,
            parentConversationId: context.conversationId,
            workspaceRoot: workspace.rootPath,
            detail: batch.detail,
            signal: context.signal,
          });
          const outputImages = agent.outputImages ?? [];
          const outputFilePaths = agent.outputFilePaths ?? [];
          const completed =
            agent.status === "completed" && outputImages.length > 0;
          results[index] = {
            input: file,
            status: completed
              ? "completed"
              : context.signal?.aborted
              ? "cancelled"
              : "failed",
            agentTaskId: agent.agentTaskId,
            outputFilePaths,
            outputImages,
            ...(!completed
              ? {
                  error:
                    agent.errorMessage ??
                    agent.parseWarning ??
                    "The provider returned no generated artifact for this input.",
                }
              : {}),
            ...(agent.storageWarning
              ? { storageWarning: agent.storageWarning }
              : {}),
            durationMs: Date.now() - startedAt,
          };
        } catch (error) {
          results[index] = {
            input: file,
            status: context.signal?.aborted ? "cancelled" : "failed",
            outputFilePaths: [],
            outputImages: [],
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAt,
          };
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(batch.concurrency, batch.files.length) },
        () => runNext()
      )
    );
    const completedCount = results.filter(
      (item) => item.status === "completed"
    ).length;
    const failedCount = results.filter(
      (item) => item.status === "failed"
    ).length;
    const cancelledCount = results.filter(
      (item) => item.status === "cancelled"
    ).length;
    const outputImages = results.flatMap((item) => item.outputImages);
    const outputFilePaths = results.flatMap((item) => item.outputFilePaths);
    const status: ArtifactBatchResult["status"] =
      cancelledCount === results.length
        ? "cancelled"
        : completedCount === results.length
        ? "completed"
        : completedCount > 0
        ? "partial"
        : "failed";
    return {
      success: completedCount > 0,
      result: {
        status,
        processor: batch.processor,
        requestedCount: results.length,
        completedCount,
        failedCount,
        cancelledCount,
        concurrency: batch.concurrency,
        items: results,
        ...(outputFilePaths.length > 0 ? { outputFilePaths } : {}),
        ...(outputImages.length > 0 ? { outputImages } : {}),
      },
    };
  }
}

export const PROCESS_ARTIFACT_BATCH_TOOL: SkillDefinition = {
  name: "process_artifact_batch",
  description:
    "Process many workspace artifacts with one instruction using bounded concurrent, isolated provider operations. " +
    "Use this for editing 2 or more local images; do not attach several editable images in one request and do not spawn one run_subagent call per file. " +
    "The tool preserves an input-to-output mapping, reports per-item failures, and returns generated artifacts for automatic chat rendering. " +
    "If the user requested persistent workspace files, pass the returned artifact URLs to export_generated_artifacts; never copy app-managed paths with shell_execute. " +
    "Currently processor='image_edit' is supported. The operation is asynchronous and the runtime waits for the batch job result.",
  parameters: {
    type: "object",
    properties: {
      files: {
        type: "array",
        description:
          "Exact workspace file paths to process, from 1 to 50 unique items.",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: MAX_BATCH_ITEMS,
        uniqueItems: true,
      },
      instruction: {
        type: "string",
        description:
          "The same operation to apply independently to every artifact.",
        minLength: 1,
      },
      processor: {
        type: "string",
        enum: [PROCESSOR_IMAGE_EDIT],
        default: PROCESSOR_IMAGE_EDIT,
      },
      concurrency: {
        type: "integer",
        minimum: 1,
        maximum: MAX_CONCURRENCY,
        default: DEFAULT_CONCURRENCY,
        description:
          "Maximum concurrent provider operations. Use 3 unless rate limits require less.",
      },
      detail: {
        type: "string",
        enum: ["auto", "low", "high"],
        default: "auto",
      },
    },
    required: ["files", "instruction"],
    additionalProperties: false,
  },
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "filesystem",
  source: "built-in",
  async: true,
  resolveTimeoutClass: () => "async",
  supportsPartialResult: true,
  buildPermissionPreview,
  execute: async (args, context) => {
    const service = new ArtifactBatchProcessingService();
    const response = await service.execute(args, context);
    return {
      success: response.success,
      result: response.result as unknown as Record<string, unknown>,
    };
  },
};
