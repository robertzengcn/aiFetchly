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
import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";
import {
  GeneratedImageReferenceError,
  type AuthorizedGeneratedImageSource,
  type GeneratedImageReferenceErrorCode,
  type PreparedGeneratedImageArtifact,
} from "@/entityTypes/generatedImageReferenceTypes";
import {
  AIImageAttachmentToolService,
  createDefaultAIImageAttachmentToolDeps,
} from "@/service/AIImageAttachmentToolService";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { normalizeGeneratedImageReferences } from "@/service/generatedImageReferenceNormalize";

const PROCESSOR_IMAGE_EDIT = "image_edit";
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 3;
const MAX_BATCH_ITEMS = 50;

export type ArtifactBatchSource =
  | { readonly kind: "workspace_files"; readonly files: readonly string[] }
  | {
      readonly kind: "generated_images";
      readonly references: readonly ChatV2GeneratedImageReference[];
    };

export type ArtifactBatchInputIdentity =
  | { readonly kind: "workspace_file"; readonly path: string }
  | {
      readonly kind: "generated_image";
      readonly reference: ChatV2GeneratedImageReference;
    };

export type ArtifactBatchWorkerSource =
  | {
      readonly kind: "workspace_file";
      readonly file: string;
      /** Eagerly resolved in execute(); unchanged legacy workspace flow. */
      readonly workspaceRoot: string;
    }
  | {
      readonly kind: "generated_image";
      readonly authorized: AuthorizedGeneratedImageSource;
      readonly artifact: PreparedGeneratedImageArtifact;
    };

export interface ArtifactBatchWorkerInput {
  source: ArtifactBatchWorkerSource;
  instruction: string;
  model?: string;
  parentConversationId: string;
  detail: ImageDetail;
  signal?: AbortSignal;
}

interface ParsedBatchArgs {
  source: ArtifactBatchSource;
  instruction: string;
  processor: typeof PROCESSOR_IMAGE_EDIT;
  concurrency: number;
  detail: ImageDetail;
}

interface ArtifactBatchItemResult {
  input: ArtifactBatchInputIdentity;
  status: "completed" | "failed" | "cancelled";
  agentTaskId?: string;
  outputFilePaths: string[];
  outputImages: OpenAIChatImage[];
  error?: string;
  errorCode?: GeneratedImageReferenceErrorCode;
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
  runAgent: (input: ArtifactBatchWorkerInput) => Promise<AgentResult>;
  authorizeReferences?: (
    conversationId: string,
    references: readonly ChatV2GeneratedImageReference[]
  ) => Promise<readonly AuthorizedGeneratedImageSource[]>;
  prepareReferences?: (
    sources: readonly AuthorizedGeneratedImageSource[],
    detail: "auto" | "low" | "high",
    signal?: AbortSignal
  ) => Promise<PreparedGeneratedImageArtifact[]>;
}

interface ScheduledItem {
  readonly identity: ArtifactBatchInputIdentity;
  launch: () => Promise<AgentResult>;
}

function parseArgs(
  args: Record<string, unknown>
): { ok: true; value: ParsedBatchArgs } | { ok: false; error: string } {
  const hasFiles = args.files !== undefined;
  const hasReferences = args.generatedImageReferences !== undefined;
  if (hasFiles && hasReferences) {
    return {
      ok: false,
      error:
        "Pass either `files` or `generatedImageReferences`, not both — the sources are mutually exclusive.",
    };
  }
  if (!hasFiles && !hasReferences) {
    return {
      ok: false,
      error: "Provide either `files` or `generatedImageReferences`.",
    };
  }

  let source: ArtifactBatchSource;
  if (hasReferences) {
    const normalized = normalizeGeneratedImageReferences(
      args.generatedImageReferences,
      MAX_BATCH_ITEMS
    );
    if (!normalized.ok) {
      return { ok: false, error: `${normalized.reason}.` };
    }
    if (normalized.references.length === 0) {
      return {
        ok: false,
        error: `Provide between 1 and ${MAX_BATCH_ITEMS} unique generated image references.`,
      };
    }
    source = { kind: "generated_images", references: normalized.references };
  } else {
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
    source = { kind: "workspace_files", files };
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
      source,
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

function isReferenceLike(
  value: unknown
): value is ChatV2GeneratedImageReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.messageId === "string" &&
    record.messageId.length > 0 &&
    typeof record.imageIndex === "number"
  );
}

function buildPermissionPreview(
  args: Record<string, unknown>
): PermissionPreview | undefined {
  if (Array.isArray(args.files)) {
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
  if (!Array.isArray(args.generatedImageReferences)) return undefined;
  const items = args.generatedImageReferences
    .filter(isReferenceLike)
    .slice(0, MAX_BATCH_ITEMS)
    .map(
      (reference) =>
        `message=${reference.messageId} image=${reference.imageIndex}`
    );
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

function createDefaultAuthorizeReferences(): NonNullable<
  ArtifactBatchProcessingDeps["authorizeReferences"]
> {
  return async (conversationId, references) => {
    const { GeneratedImageReferenceService } = await import(
      "@/service/GeneratedImageReferenceService"
    );
    return new GeneratedImageReferenceService().authorizeOnly({
      conversationId,
      references,
    });
  };
}

function createDefaultPrepareReferences(): NonNullable<
  ArtifactBatchProcessingDeps["prepareReferences"]
> {
  return async (sources, detail, signal) => {
    const { GeneratedImageReferenceService } = await import(
      "@/service/GeneratedImageReferenceService"
    );
    return new GeneratedImageReferenceService().prepareAuthorized(
      sources,
      detail,
      signal
    );
  };
}

function createDefaultDeps(): ArtifactBatchProcessingDeps {
  const resolver = new WorkspaceResolver();
  return {
    resolveWorkspace: (conversationId) => resolver.resolve(conversationId),
    authorizeReferences: createDefaultAuthorizeReferences(),
    prepareReferences: createDefaultPrepareReferences(),
    runAgent: async (input) => {
      // Lazy imports break the registry cycle:
      // skillsRegistry -> this tool -> AgentRuntime -> skillsRegistry.
      const [{ AgentRuntimeRegistry }, { SkillExecutor }] = await Promise.all([
        import("@/service/AgentRuntimeRegistry"),
        import("@/service/SkillExecutor"),
      ]);
      const runtime = AgentRuntimeRegistry.getRuntime();
      if (input.source.kind === "generated_image") {
        const { authorized, artifact } = input.source;
        return runtime.runSync(
          {
            agentId: "agent-generated-image-editor",
            prompt: `Process exactly one supplied image according to this instruction: ${input.instruction}`,
            taskPacket: { files: [], instruction: input.instruction },
            initialImageArtifacts: [
              {
                sourceId: `${authorized.reference.messageId}:${authorized.reference.imageIndex}`,
                fileName: artifact.fileName,
                mimeType: artifact.mimeType,
                dataUrl: artifact.dataUrl,
                detail: artifact.detail,
              },
            ],
            parentConversationId: input.parentConversationId,
            model: input.model,
            executionMode: "foreground",
          },
          { signal: input.signal }
        );
      }
      const file = input.source.file;
      const workspaceRoot = input.source.workspaceRoot;
      const imageDeps = createDefaultAIImageAttachmentToolDeps({
        destinationLabel: destinationLabel(),
      });
      const attachmentService = new AIImageAttachmentToolService({
        ...imageDeps,
        resolveWorkspace: async () => ({ rootPath: workspaceRoot }),
      });
      return runtime.runSync(
        {
          agentId: "agent-batch-worker",
          prompt: `Process exactly one image. Apply this instruction: ${input.instruction}`,
          taskPacket: {
            files: [file],
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
                { paths: [file], detail: input.detail },
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

function summarize(
  results: readonly ArtifactBatchItemResult[],
  processor: typeof PROCESSOR_IMAGE_EDIT,
  concurrency: number
): { success: boolean; result: ArtifactBatchResult } {
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
      processor,
      requestedCount: results.length,
      completedCount,
      failedCount,
      cancelledCount,
      concurrency,
      items: [...results],
      ...(outputFilePaths.length > 0 ? { outputFilePaths } : {}),
      ...(outputImages.length > 0 ? { outputImages } : {}),
    },
  };
}

function referenceKey(reference: ChatV2GeneratedImageReference): string {
  return `${reference.messageId}:${reference.imageIndex}`;
}

function failedReferenceItems(
  references: readonly ChatV2GeneratedImageReference[],
  error: string,
  errorCode: GeneratedImageReferenceErrorCode
): ArtifactBatchItemResult[] {
  return references.map((reference) => ({
    input: { kind: "generated_image", reference },
    status: "failed",
    outputFilePaths: [],
    outputImages: [],
    error,
    errorCode,
    durationMs: 0,
  }));
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
    if (batch.source.kind === "generated_images") {
      return this.executeGeneratedSources(batch.source.references, batch, context);
    }

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
    const items: ScheduledItem[] = batch.source.files.map((file) => ({
      identity: { kind: "workspace_file", path: file },
      launch: () =>
        this.deps.runAgent({
          source: {
            kind: "workspace_file",
            file,
            workspaceRoot: workspace.rootPath,
          },
          instruction: batch.instruction,
          model: context.model,
          parentConversationId: context.conversationId,
          detail: batch.detail,
          signal: context.signal,
        }),
    }));
    return this.processItems(items, batch.processor, batch.concurrency, context);
  }

  private async executeGeneratedSources(
    references: readonly ChatV2GeneratedImageReference[],
    batch: ParsedBatchArgs,
    context: SkillExecutionContext
  ): Promise<{
    success: boolean;
    result: ArtifactBatchResult | { error: string };
  }> {
    const authorize = this.deps.authorizeReferences;
    if (!authorize) {
      return summarize(
        failedReferenceItems(
          references,
          "Authorization for generated image references is unavailable.",
          "generated_image_reference_invalid"
        ),
        batch.processor,
        batch.concurrency
      );
    }
    let authorizedSources: readonly AuthorizedGeneratedImageSource[];
    try {
      authorizedSources = await authorize(context.conversationId, references);
    } catch (error: unknown) {
      // authorizeOnly is all-or-nothing, so a rejection here fails every
      // requested reference in input order. Valid-sibling continuation is
      // handled per-item by the JIT prepare stage below.
      const code: GeneratedImageReferenceErrorCode =
        error instanceof GeneratedImageReferenceError
          ? error.code
          : "generated_image_reference_invalid";
      const message = error instanceof Error ? error.message : String(error);
      return summarize(
        failedReferenceItems(references, message, code),
        batch.processor,
        batch.concurrency
      );
    }
    const prepare =
      this.deps.prepareReferences ?? createDefaultPrepareReferences();
    const authorizedByKey = new Map(
      authorizedSources.map((source) => [referenceKey(source.reference), source])
    );
    const items: ScheduledItem[] = references.map((reference) => ({
      identity: { kind: "generated_image", reference },
      launch: async () => {
        const authorized = authorizedByKey.get(referenceKey(reference));
        if (!authorized) {
          throw new GeneratedImageReferenceError(
            "generated_image_reference_invalid"
          );
        }
        // JIT preparation inside the bounded slot: one artifact at a time,
        // scoped to this iteration so it is collectible once runSync resolves.
        const [artifact] = await prepare([authorized], batch.detail, context.signal);
        if (!artifact) {
          throw new GeneratedImageReferenceError(
            "generated_image_reference_invalid"
          );
        }
        return this.deps.runAgent({
          source: { kind: "generated_image", authorized, artifact },
          instruction: batch.instruction,
          model: context.model,
          parentConversationId: context.conversationId,
          detail: batch.detail,
          signal: context.signal,
        });
      },
    }));
    return this.processItems(items, batch.processor, batch.concurrency, context);
  }

  private async processItems(
    items: readonly ScheduledItem[],
    processor: typeof PROCESSOR_IMAGE_EDIT,
    concurrency: number,
    context: SkillExecutionContext
  ): Promise<{ success: boolean; result: ArtifactBatchResult }> {
    const results: ArtifactBatchItemResult[] = new Array(items.length);
    let nextIndex = 0;
    const runNext = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        const item = items[index];
        if (context.signal?.aborted) {
          results[index] = {
            input: item.identity,
            status: "cancelled",
            outputFilePaths: [],
            outputImages: [],
            error: "Batch processing was cancelled.",
            ...(item.identity.kind === "generated_image"
              ? { errorCode: "generated_image_batch_cancelled" }
              : {}),
            durationMs: 0,
          };
          continue;
        }
        const startedAt = Date.now();
        try {
          const agent = await item.launch();
          const outputImages = agent.outputImages ?? [];
          const outputFilePaths = agent.outputFilePaths ?? [];
          const completed =
            agent.status === "completed" && outputImages.length > 0;
          results[index] = {
            input: item.identity,
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
          const cancelled = context.signal?.aborted === true;
          results[index] = {
            input: item.identity,
            status: cancelled ? "cancelled" : "failed",
            outputFilePaths: [],
            outputImages: [],
            error: error instanceof Error ? error.message : String(error),
            ...(!cancelled && error instanceof GeneratedImageReferenceError
              ? { errorCode: error.code }
              : {}),
            durationMs: Date.now() - startedAt,
          };
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, items.length) },
        () => runNext()
      )
    );
    return summarize(results, processor, concurrency);
  }
}

export const PROCESS_ARTIFACT_BATCH_TOOL: SkillDefinition = {
  name: "process_artifact_batch",
  description:
    "Process many images with one instruction using bounded concurrent, isolated provider operations. " +
    "Two mutually exclusive sources: pass `files` with exact workspace file paths, or pass `generatedImageReferences` identifying AI-generated images already produced in this conversation (no workspace required). " +
    "Pass exactly one source, never both. " +
    "Use this for editing 2 or more images; do not attach several editable images in one request and do not spawn one run_subagent call per image. " +
    "The tool preserves an input-to-output mapping, reports per-item results carrying the original identities, and returns generated artifacts for automatic chat rendering. " +
    "If some items fail or are cancelled, call the tool again passing only those failed/cancelled items to retry them. " +
    "If the user requested persistent workspace files, pass the returned artifact URLs to export_generated_artifacts; never copy app-managed paths with shell_execute. " +
    "Currently processor='image_edit' is supported. The operation is asynchronous and the runtime waits for the batch job result.",
  parameters: {
    type: "object",
    properties: {
      files: {
        type: "array",
        description:
          "Exact workspace file paths to process, from 1 to 50 unique items. Mutually exclusive with generatedImageReferences.",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: MAX_BATCH_ITEMS,
        uniqueItems: true,
      },
      generatedImageReferences: {
        type: "array",
        description:
          "Opaque references to AI-generated images from this conversation, from 1 to 50 unique items. Each entry needs the assistant messageId and the zero-based imageIndex within that message. Requires no workspace. Mutually exclusive with files.",
        items: {
          type: "object",
          properties: {
            messageId: { type: "string", minLength: 1 },
            imageIndex: { type: "integer", minimum: 0, maximum: 49 },
          },
          required: ["messageId", "imageIndex"],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: MAX_BATCH_ITEMS,
        uniqueItems: true,
      },
      instruction: {
        type: "string",
        description:
          "The same operation to apply independently to every selected image.",
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
    required: ["instruction"],
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
