/**
 * AIImageAttachmentToolService — executor for the built-in `attach_local_images`
 * tool.
 *
 * Resolves one to three exact local image paths inside the APPROVED
 * conversation workspace, validates them, normalizes them, and returns:
 *   - a SAFE metadata `result` (persistable, emittable, loggable), and
 *   - a TRANSIENT `modelArtifacts` array (prepared images) that the query loop
 *     attaches to the next AI request via a model-only handoff message.
 *
 * Security invariants (PRD FR2–FR7, design §9):
 *   - FAIL CLOSED: when there is no approved workspace, refuse with
 *     `workspace_required`. NEVER fall back to default roots.
 *   - Every path is confined to the workspace by FilePathGuard (realpath +
 *     containment + deny-list) before any read.
 *   - The detected file signature — not the extension — drives decoding.
 *   - Failure is atomic: if any image fails, the whole call fails and no
 *     artifacts are returned, so the model never believes it got a partial set.
 *   - Combined per-request image count (<=3) and cumulative data-URL char
 *   budget (<=6M) are enforced against the existing request transcript.
 */
import * as fs from "fs";
import * as path from "path";
import type { Stats } from "fs";
import type {
  AttachLocalImagesErrorCode,
  AttachLocalImagesFileError,
  AttachLocalImagesResult,
  AttachedImageMetadata,
  AttachLocalImagesArgs,
  ImageDetail,
  ImageModelArtifact,
  ModelArtifact,
  PermissionPreview,
  PreparedImageMimeType,
  SupportedImageMimeType,
} from "@/entityTypes/aiImageAttachmentToolTypes";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import { FilePathGuard } from "@/service/FilePathGuard";
import {
  AIImageNormalizer,
  ImageNormalizationError,
  type NormalizeOptions,
  type NormalizedImage,
} from "@/service/AIImageNormalizer";
import { detectImageSignature } from "@/service/AIImageSignature";
import { ElectronNativeImageCodec } from "@/service/ElectronNativeImageCodec";
import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "@/entityTypes/skillTypes";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";

/**
 * Structural port for the normalizer so tests can inject a fake without the
 * concrete class's private fields. AIImageNormalizer satisfies this.
 */
export interface ImageNormalizerPort {
  normalize(
    buffer: Buffer,
    detectedMime: SupportedImageMimeType,
    opts: NormalizeOptions
  ): Promise<NormalizedImage>;
}

// ---------------------------------------------------------------------------
// Dependencies (constructor-injected for testability)
// ---------------------------------------------------------------------------

/** Resolved approved workspace for a conversation. */
export interface ResolvedToolWorkspace {
  readonly rootPath: string;
}

export interface AIImageAttachmentToolDeps {
  /** Returns the approved workspace root for a conversation, or null if none. */
  readonly resolveWorkspace: (
    conversationId: string
  ) => Promise<ResolvedToolWorkspace | null>;
  /** Creates a FilePathGuard confined to the given roots. */
  readonly createPathGuard: (roots: readonly string[]) => FilePathGuard;
  /** Image normalizer (codec-injected). */
  readonly normalizer: ImageNormalizerPort;
  /**
   * Opens a resolved path for reading and returns an fd-pinned handle. The
   * handle's stats come from fstat on the open fd (not the path), and read()
   * reads from that same fd — so a path/symlink swap between validation and
   * read cannot change what bytes we actually read (TOCTOU mitigation).
   */
  readonly openForRead: (filePath: string) => Promise<OpenedReadFile>;
  /** Label of the configured AI server destination (no credentials), for previews. */
  readonly destinationLabel: string;
}

/** fd-pinned read handle: stats from fstat, read from the same fd. */
export interface OpenedReadFile {
  readonly stats: Stats;
  read(): Promise<Buffer>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tool name + constants
// ---------------------------------------------------------------------------

export const ATTACH_LOCAL_IMAGES_TOOL_NAME = "attach_local_images";

const ALLOWED_DETAIL: readonly ImageDetail[] = ["auto", "low", "high"];

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

type Failure = {
  readonly success: false;
  readonly code: AttachLocalImagesErrorCode;
  readonly error: string;
  readonly file_errors?: readonly AttachLocalImagesFileError[];
};

function failureResult(
  code: AttachLocalImagesErrorCode,
  error: string,
  fileErrors?: readonly AttachLocalImagesFileError[]
): Failure {
  return fileErrors && fileErrors.length > 0
    ? { success: false, code, error, file_errors: fileErrors }
    : { success: false, code, error };
}

function toSkillExecutionFailure(f: Failure): SkillExecutionResult {
  const result: AttachLocalImagesResult = {
    success: false,
    attached_count: 0,
    attachments: [],
    summary: f.error,
    code: f.code,
    error: f.error,
    ...(f.file_errors ? { file_errors: f.file_errors } : {}),
  };
  return {
    success: false,
    result: result as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing (model-supplied → typed)
// ---------------------------------------------------------------------------

type ParsedArgs =
  | { ok: true; args: AttachLocalImagesArgs }
  | { ok: false; code: AttachLocalImagesErrorCode; error: string };

function parseArgs(raw: Record<string, unknown>): ParsedArgs {
  const pathsRaw = raw.paths;
  if (!Array.isArray(pathsRaw)) {
    return {
      ok: false,
      code: "invalid_arguments",
      error: "`paths` must be an array of one to three image paths.",
    };
  }
  // Keep only non-empty strings; reject non-string entries outright.
  const stringPaths: string[] = [];
  for (const p of pathsRaw) {
    if (typeof p !== "string" || p.length === 0) {
      return {
        ok: false,
        code: "invalid_arguments",
        error: "Every entry in `paths` must be a non-empty string.",
      };
    }
    stringPaths.push(p);
  }
  if (stringPaths.length === 0) {
    return {
      ok: false,
      code: "invalid_arguments",
      error: "Provide one to three image paths.",
    };
  }
  if (stringPaths.length > CHAT_IMAGE_LIMITS.maxImagesPerRequest) {
    return {
      ok: false,
      code: "invalid_arguments",
      error:
        `At most ${CHAT_IMAGE_LIMITS.maxImagesPerRequest} images may be attached per call. ` +
        `You passed ${stringPaths.length}. Attach the first ${CHAT_IMAGE_LIMITS.maxImagesPerRequest} ` +
        `paths only, wait for that batch to finish editing, then call again with the next batch. ` +
        `Do not send multiple attach_local_images calls in the same tool round.`,
    };
  }
  // Deduplicate identical input strings deterministically (order-preserving).
  const deduped: string[] = [];
  for (const p of stringPaths) {
    if (!deduped.includes(p)) deduped.push(p);
  }

  let detail: ImageDetail = "auto";
  const rawDetail = raw.detail;
  if (rawDetail !== undefined) {
    if (
      typeof rawDetail !== "string" ||
      !ALLOWED_DETAIL.includes(rawDetail as ImageDetail)
    ) {
      return {
        ok: false,
        code: "invalid_arguments",
        error: "`detail` must be one of: auto, low, high.",
      };
    }
    detail = rawDetail as ImageDetail;
  }

  return { ok: true, args: { paths: deduped, detail } };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AIImageAttachmentToolService {
  constructor(private readonly deps: AIImageAttachmentToolDeps) {}

  /** Skill execute entrypoint. */
  async execute(
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> {
    // 1. Parse + validate arguments.
    const parsed = parseArgs(args);
    if (!parsed.ok) {
      return toSkillExecutionFailure(failureResult(parsed.code, parsed.error));
    }
    const { paths } = parsed.args;
    // parseArgs always supplies detail (default "auto"); normalize the optional
    // away so downstream code treats it as a concrete ImageDetail.
    const detail: ImageDetail = parsed.args.detail ?? "auto";

    // 2. Enforce cancellation before any work.
    if (context.signal?.aborted) {
      return toSkillExecutionFailure(
        failureResult("cancelled", "Attachment cancelled before validation.")
      );
    }

    // 3. Combined per-request image capacity (user- + tool-selected).
    const existing = context.currentRequestImageCount ?? 0;
    const remaining = CHAT_IMAGE_LIMITS.maxImagesPerRequest - existing;
    if (paths.length > remaining) {
      return toSkillExecutionFailure(
        failureResult(
          "image_limit_reached",
          `This request already has ${existing} image(s); only ${Math.max(
            0,
            remaining
          )} more can be attached (max ${
            CHAT_IMAGE_LIMITS.maxImagesPerRequest
          } per request). ` +
            `Do not call attach_local_images again in this same tool round. ` +
            `Wait for the current batch to finish editing, then attach the next ` +
            `up to ${CHAT_IMAGE_LIMITS.maxImagesPerRequest} paths in a later round.`
        )
      );
    }

    // 4. Resolve approved workspace — FAIL CLOSED.
    let workspace: ResolvedToolWorkspace | null = null;
    try {
      workspace = await this.deps.resolveWorkspace(context.conversationId);
    } catch {
      workspace = null;
    }
    if (!workspace) {
      return toSkillExecutionFailure(
        failureResult(
          "workspace_required",
          "An approved workspace is required before local images can be attached."
        )
      );
    }

    // 5. Path guard confined to the single approved root.
    const guard = this.deps.createPathGuard([workspace.rootPath]);

    type Prepared = {
      readonly meta: AttachedImageMetadata;
      readonly artifact: ImageModelArtifact;
    };
    const prepared: Prepared[] = [];
    const fileErrors: AttachLocalImagesFileError[] = [];
    let totalDataUrlChars = context.currentRequestImageDataUrlChars ?? 0;

    // 6. Validate + read + normalize each path.
    for (const inputPath of paths) {
      if (context.signal?.aborted) {
        return toSkillExecutionFailure(
          failureResult("cancelled", "Attachment cancelled during validation.")
        );
      }

      const step = await this.processOne(
        inputPath,
        guard,
        workspace.rootPath,
        detail,
        context
      );
      if (!step.ok) {
        fileErrors.push({
          relative_path: relativeForDisplay(inputPath),
          code: step.code,
          error: step.error,
        });
        break; // atomic: first failure stops the batch
      }

      // 7. Cumulative data-URL budget.
      // The artifact's dataUrl is exactly the string sent as image_url.url;
      // its character length is the precise (not estimated) budget cost.
      totalDataUrlChars += step.artifact.dataUrl.length;
      if (totalDataUrlChars > CHAT_IMAGE_LIMITS.targetTotalDataUrlChars) {
        fileErrors.push({
          relative_path: step.artifact.relativePath,
          code: "image_payload_too_large",
          error: `Attaching this image would exceed the ${CHAT_IMAGE_LIMITS.targetTotalDataUrlChars.toLocaleString()}-character request budget.`,
        });
        break;
      }
      prepared.push({ meta: step.meta, artifact: step.artifact });
    }

    // 8. Atomic failure — release any prepared artifacts.
    if (fileErrors.length > 0 || prepared.length !== paths.length) {
      const code: AttachLocalImagesErrorCode =
        fileErrors[0]?.code ?? "image_processing_failed";
      return toSkillExecutionFailure(
        failureResult(
          code,
          fileErrors[0]?.error ?? "One or more images could not be attached.",
          fileErrors
        )
      );
    }

    // 9. Success — safe metadata result + transient artifacts.
    const result: AttachLocalImagesResult = {
      success: true,
      attached_count: prepared.length,
      attachments: prepared.map((p) => p.meta),
      summary: `Prepared ${prepared.length} image${
        prepared.length === 1 ? "" : "s"
      } for the next AI request.`,
    };
    const modelArtifacts: readonly ModelArtifact[] = prepared.map(
      (p) => p.artifact
    );
    return {
      success: true,
      result: result as unknown as Record<string, unknown>,
      modelArtifacts,
    };
  }

  /**
   * Validate, read, and normalize a single path. Returns either the prepared
   * metadata + artifact or a typed failure for the calling batch.
   */
  private async processOne(
    inputPath: string,
    guard: FilePathGuard,
    rootPath: string,
    detail: ImageDetail,
    context: SkillExecutionContext
  ): Promise<
    | { ok: true; meta: AttachedImageMetadata; artifact: ImageModelArtifact }
    | { ok: false; code: AttachLocalImagesErrorCode; error: string }
  > {
    // Path safety.
    const validation = guard.validate(inputPath);
    if (!validation.safe) {
      return {
        ok: false,
        code: guardCodeToResultCode(validation.code),
        error: validation.error ?? "Path is not allowed.",
      };
    }
    const resolvedPath = validation.resolvedPath;
    const relativePath =
      validation.relativePath ?? path.relative(rootPath, resolvedPath);

    // Open the resolved path and pin the fd. Stats come from fstat on the fd
    // and the read uses the same fd, so a path/symlink swap between validation
    // and read cannot change which bytes we read (TOCTOU mitigation).
    let handle: OpenedReadFile;
    try {
      handle = await this.deps.openForRead(resolvedPath);
    } catch {
      return {
        ok: false,
        code: "path_not_found",
        error: `File not found: ${relativePath}`,
      };
    }
    const stats = handle.stats;
    // fstat on the fd; a symlink target would already have been followed at
    // open, so treat a symlink result as a refuse-by-default anomaly.
    if (stats.isSymbolicLink()) {
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        code: "path_outside_workspace",
        error: `Refusing to follow a symbolic link: ${relativePath}`,
      };
    }
    if (stats.isDirectory()) {
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        code: "path_is_directory",
        error: `Path is a directory, not an image: ${relativePath}`,
      };
    }
    if (!stats.isFile()) {
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        code: "path_not_found",
        error: `Path is not a regular file: ${relativePath}`,
      };
    }
    if (stats.size > CHAT_IMAGE_LIMITS.maxRawFileBytes) {
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        code: "image_file_too_large",
        error: `File exceeds the ${CHAT_IMAGE_LIMITS.maxRawFileBytes} byte limit: ${relativePath}`,
      };
    }
    if (stats.size <= 0) {
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        code: "unsupported_image_type",
        error: `File is empty: ${relativePath}`,
      };
    }

    // Read from the pinned fd.
    let buffer: Buffer;
    try {
      buffer = await handle.read();
    } catch {
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        code: "path_not_found",
        error: `Could not read file: ${relativePath}`,
      };
    }
    if (context.signal?.aborted) {
      await handle.close().catch(() => undefined);
      return { ok: false, code: "cancelled", error: "Attachment cancelled." };
    }
    if (buffer.length > CHAT_IMAGE_LIMITS.maxRawFileBytes) {
      await handle.close().catch(() => undefined);
      return {
        ok: false,
        code: "image_file_too_large",
        error: `File exceeds the ${CHAT_IMAGE_LIMITS.maxRawFileBytes} byte limit: ${relativePath}`,
      };
    }
    await handle.close().catch(() => undefined);

    // Signature detection — drives decoding, not the extension.
    const detected = detectImageSignature(buffer);
    if (!detected) {
      return {
        ok: false,
        code: "unsupported_image_type",
        error: `Unsupported image type (not PNG/JPEG/WebP/GIF): ${relativePath}`,
      };
    }
    const claimedMime = mimeFromExtension(inputPath);
    if (claimedMime && claimedMime !== detected.mimeType) {
      return {
        ok: false,
        code: "image_signature_mismatch",
        error: `File extension suggests ${claimedMime} but the file contents are ${detected.mimeType}: ${relativePath}`,
      };
    }

    // Normalize.
    const opts: NormalizeOptions = {
      targetBytes: CHAT_IMAGE_LIMITS.targetPreparedImageBytes,
      maxLongEdge: CHAT_IMAGE_LIMITS.maxLongEdge,
      initialJpegQuality: CHAT_IMAGE_LIMITS.initialJpegQuality,
      minJpegQuality: CHAT_IMAGE_LIMITS.minJpegQuality,
      minLongEdge: CHAT_IMAGE_LIMITS.minLongEdge,
      maxEncodingAttempts: CHAT_IMAGE_LIMITS.maxEncodingAttempts,
      signal: context.signal,
    };
    let normalized;
    try {
      normalized = await this.deps.normalizer.normalize(
        buffer,
        detected.mimeType,
        opts
      );
    } catch (err) {
      if (err instanceof ImageNormalizationError) {
        return { ok: false, code: err.code, error: err.message };
      }
      return {
        ok: false,
        code: "image_processing_failed",
        error: `Failed to process image: ${relativePath}`,
      };
    }

    const fileName = path.basename(resolvedPath);
    const meta: AttachedImageMetadata = {
      file_name: fileName,
      relative_path: relativePath.split(path.sep).join("/"),
      mime_type: normalized.mimeType,
      prepared_size_bytes: normalized.buffer.length,
      width: normalized.width,
      height: normalized.height,
      sha256: normalized.sha256,
      detail,
    };
    const artifact: ImageModelArtifact = {
      kind: "image",
      fileName,
      relativePath: meta.relative_path,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.buffer.length,
      width: normalized.width,
      height: normalized.height,
      sha256: normalized.sha256,
      detail,
      dataUrl: normalized.dataUrl,
    };
    return { ok: true, meta, artifact };
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function relativeForDisplay(p: string): string {
  // Only show the basename for an absolute path outside the workspace, to avoid
  // leaking unrelated filesystem structure in failure messages.
  return path.isAbsolute(p) ? path.basename(p) : p;
}

function mimeFromExtension(filePath: string): SupportedImageMimeType | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return null;
  }
}

function guardCodeToResultCode(
  code: string | undefined
): AttachLocalImagesErrorCode {
  switch (code) {
    case "OUTSIDE_ROOTS":
    case "SYMLINK_ESCAPES":
    case "DOTPATH_TRAVERSAL":
    case "DENY_LISTED":
      return "path_outside_workspace";
    case "MALFORMED_INPUT":
    case "NOT_ABSOLUTE":
      return "invalid_arguments";
    case "REALPATH_FAILED":
      return "path_not_found";
    default:
      return "path_outside_workspace";
  }
}

// ---------------------------------------------------------------------------
// Permission preview (metadata-only; display only)
// ---------------------------------------------------------------------------

/**
 * Build a metadata-only permission preview for the approval prompt. The paths
 * are UNVALIDATED requested values for display only — the service re-validates
 * after approval.
 */
export function buildAttachLocalImagesPermissionPreview(
  args: Record<string, unknown>,
  destinationLabel: string
): PermissionPreview | undefined {
  const pathsRaw = args.paths;
  if (!Array.isArray(pathsRaw)) return undefined;
  const items = pathsRaw
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .slice(0, CHAT_IMAGE_LIMITS.maxImagesPerRequest);
  if (items.length === 0) return undefined;
  return {
    kind: "file_transfer",
    titleKey: "aiChatV2.imageTool.permissionTitle",
    descriptionKey: "aiChatV2.imageTool.permissionDescription",
    items,
    destinationLabel,
  };
}

// ---------------------------------------------------------------------------
// Production dependency factory
// ---------------------------------------------------------------------------

/**
 * Build production deps wiring Node `fs`, the Electron nativeImage codec, and
 * the conversation WorkspaceResolver. Kept separate so the service itself
 * stays free of Electron/filesystem imports and is unit-testable.
 */
export function createDefaultAIImageAttachmentToolDeps(options: {
  readonly destinationLabel: string;
  readonly normalizer?: AIImageNormalizer;
}): AIImageAttachmentToolDeps {
  // ElectronNativeImageCodec lazy-requires `electron` only inside decode(), so
  // importing the class here is safe (no Electron at module load).
  const normalizer =
    options.normalizer ?? new AIImageNormalizer(new ElectronNativeImageCodec());
  const resolver = new WorkspaceResolver();
  return {
    resolveWorkspace: (conversationId) => resolver.resolve(conversationId),
    createPathGuard: (roots) => new FilePathGuard(roots),
    normalizer,
    // Open + fstat + read on the SAME fd so a path/symlink swap between
    // validation and read cannot change the bytes we read.
    openForRead: async (p) => {
      const fileHandle = await fs.promises.open(p, "r");
      const stats = await fileHandle.stat();
      return {
        stats,
        read: () => fileHandle.readFile(),
        close: () => fileHandle.close(),
      };
    },
    destinationLabel: options.destinationLabel,
  };
}
