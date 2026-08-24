/**
 * GeneratedImageReferenceService — secure resolver for opaque
 * (messageId, imageIndex) generated-image references.
 *
 * Resolves renderer-supplied references into authorized transient image
 * artifacts with ZERO trust in renderer-supplied paths: every candidate path
 * is derived exclusively from a strictly-parsed protocol URL inside the
 * assistant message metadata, verified against the current user's store, and
 * read through an fd-pinned descriptor opened after realpath containment.
 */
import fs from "fs";
import path from "path";
import { USEREMAIL } from "@/config/usersetting";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import { Token } from "@/modules/token";
import { log } from "@/modules/Logger";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2GeneratedImageReference,
  ChatV2GeneratedImageReferenceMetadata,
} from "@/entityTypes/aiChatV2Types";
import {
  GeneratedImageReferenceError,
  type AuthorizedGeneratedImageSource,
  type GeneratedImageProtocolIdentity,
  type PreparedGeneratedImageArtifact,
  type ResolveGeneratedImagesInput,
  type ResolveGeneratedImagesResult,
} from "@/entityTypes/generatedImageReferenceTypes";
import type {
  ImageDetail,
  SupportedImageMimeType,
} from "@/entityTypes/aiImageAttachmentToolTypes";
import {
  createDefaultAIImageAttachmentToolDeps,
  type OpenedReadFile,
} from "@/service/AIImageAttachmentToolService";
import { GeneratedImagePreparationService, type PreparedModelImage } from "@/service/GeneratedImagePreparationService";
import {
  AI_CHAT_GENERATED_IMAGE_HOST,
  AI_CHAT_GENERATED_IMAGE_PROTOCOL,
  getGeneratedImageUserRoot,
  normalizeGeneratedImageUserEmail,
  parseGeneratedImageProtocolIdentity,
  sanitizeGeneratedImagePathPart,
} from "@/service/AIChatGeneratedImageProtocol";
import { detectImageSignature } from "@/service/AIImageSignature";

export interface GeneratedImageReferenceServiceDeps {
  readonly getSourceMessage: (
    conversationId: string,
    messageId: string
  ) => Promise<AIChatMessageEntity | null>;
  readonly getCurrentUserEmail: () => string;
  readonly getUserDataPath: () => string;
  readonly realpath: typeof import("node:fs/promises").realpath;
  readonly openForRead: (absolutePath: string) => Promise<OpenedReadFile>;
  readonly prepareImage: (
    source: Buffer,
    detectedMimeType: SupportedImageMimeType,
    detail: "auto" | "low" | "high",
    signal?: AbortSignal
  ) => Promise<PreparedModelImage>;
}

const PROTOCOL_PREFIX = `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/`;

interface AuthorizedFileIdentity {
  readonly url: string;
  readonly fileName: string;
  readonly identity: GeneratedImageProtocolIdentity;
  readonly realResolved: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new GeneratedImageReferenceError(
    "generated_image_reference_invalid",
    "cancelled"
  );
  error.name = "AbortError";
  throw error;
}

function dedupeReferences(
  references: readonly ChatV2GeneratedImageReference[]
): ChatV2GeneratedImageReference[] {
  const seen = new Set<string>();
  const unique: ChatV2GeneratedImageReference[] = [];
  for (const reference of references) {
    const key = `${reference.messageId}:${reference.imageIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(reference);
  }
  return unique;
}

function extractDescriptor(
  entity: AIChatMessageEntity,
  imageIndex: number
): { url: string; fileName?: string } {
  let parsed: unknown = null;
  try {
    parsed = entity.metadata ? JSON.parse(entity.metadata) : null;
  } catch {
    parsed = null;
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.generatedImages) ||
    imageIndex < 0 ||
    imageIndex >= parsed.generatedImages.length
  ) {
    throw new GeneratedImageReferenceError("generated_image_reference_invalid");
  }
  const entry: unknown = parsed.generatedImages[imageIndex];
  if (!isRecord(entry) || typeof entry.url !== "string") {
    throw new GeneratedImageReferenceError("generated_image_reference_invalid");
  }
  if (!entry.url.startsWith(PROTOCOL_PREFIX)) {
    throw new GeneratedImageReferenceError("generated_image_reference_invalid");
  }
  return {
    url: entry.url,
    fileName:
      typeof entry.file_name === "string" ? entry.file_name : undefined,
  };
}

function expectedMimeTypeFromFileName(
  fileName: string
): SupportedImageMimeType | null {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return null;
}

function isContained(parentRoot: string, candidate: string): boolean {
  const relative = path.relative(parentRoot, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export class GeneratedImageReferenceService {
  private readonly deps: GeneratedImageReferenceServiceDeps;

  constructor(deps?: Partial<GeneratedImageReferenceServiceDeps>) {
    this.deps = {
      getSourceMessage:
        deps?.getSourceMessage ?? this.defaultGetSourceMessage,
      getCurrentUserEmail:
        deps?.getCurrentUserEmail ?? this.defaultGetCurrentUserEmail,
      getUserDataPath: deps?.getUserDataPath ?? defaultGetUserDataPath,
      realpath: deps?.realpath ?? fs.promises.realpath,
      openForRead:
        deps?.openForRead ??
        createDefaultAIImageAttachmentToolDeps({
          destinationLabel: "ai-chat-generated-image-edit",
        }).openForRead,
      prepareImage:
        deps?.prepareImage ?? defaultPrepareImage,
    };
  }

  private defaultGetSourceMessage(
    conversationId: string,
    messageId: string
  ): Promise<AIChatMessageEntity | null> {
    return new AIChatV2Module().getGeneratedImageSourceMessage(
      conversationId,
      messageId
    );
  }

  private defaultGetCurrentUserEmail(): string {
    return new Token().getValue(USEREMAIL);
  }

  async resolveGeneratedImages(
    input: ResolveGeneratedImagesInput
  ): Promise<ResolveGeneratedImagesResult> {
    const artifacts: PreparedGeneratedImageArtifact[] = [];
    const metadata: ChatV2GeneratedImageReferenceMetadata[] = [];
    let totalPreparedBytes = 0;
    let totalDataUrlChars = 0;
    for (const reference of dedupeReferences(input.references)) {
      ensureNotAborted(input.signal);
      const authorized = await this.authorizeOne(input.conversationId, reference);
      const pinned = await this.readViaPinnedDescriptor(authorized.realResolved);
      const detected = detectImageSignature(pinned.buffer);
      if (!detected) {
        throw new GeneratedImageReferenceError("generated_image_unsupported_type");
      }
      const expected = expectedMimeTypeFromFileName(authorized.identity.fileName);
      if (expected !== null && expected !== detected.mimeType) {
        throw new GeneratedImageReferenceError("generated_image_unsupported_type");
      }
      let prepared: PreparedModelImage;
      try {
        prepared = await this.deps.prepareImage(
          pinned.buffer,
          detected.mimeType,
          input.detail,
          input.signal
        );
      } catch (err: unknown) {
        throw new GeneratedImageReferenceError(
          GeneratedImagePreparationService.errorCodeForNormalizationError(err)
        );
      }
      artifacts.push({
        reference,
        fileName: authorized.fileName,
        mimeType: prepared.mimeType,
        width: prepared.width,
        height: prepared.height,
        preparedSizeBytes: prepared.preparedSizeBytes,
        dataUrl: prepared.dataUrl,
        detail: input.detail,
      });
      metadata.push({
        messageId: reference.messageId,
        imageIndex: reference.imageIndex,
        fileName: authorized.fileName,
        protocolUrl: authorized.url,
      });
      totalPreparedBytes += prepared.preparedSizeBytes;
      totalDataUrlChars += prepared.dataUrl.length;
    }
    if (totalDataUrlChars > CHAT_IMAGE_LIMITS.targetTotalDataUrlChars) {
      throw new GeneratedImageReferenceError(
        "generated_image_too_large",
        "combined generated-image payload exceeds request budget"
      );
    }
    return { artifacts, metadata, totalPreparedBytes, totalDataUrlChars };
  }

  async authorizeOnly(input: {
    conversationId: string;
    references: readonly ChatV2GeneratedImageReference[];
  }): Promise<readonly AuthorizedGeneratedImageSource[]> {
    const sources: AuthorizedGeneratedImageSource[] = [];
    for (const reference of dedupeReferences(input.references)) {
      const authorized = await this.authorizeOne(input.conversationId, reference);
      sources.push({
        reference,
        conversationId: input.conversationId,
        sourceMessageId: reference.messageId,
        protocolUrl: authorized.url,
        fileName: authorized.fileName,
        absolutePath: authorized.realResolved,
      });
    }
    return sources;
  }

  private async authorizeOne(
    conversationId: string,
    reference: ChatV2GeneratedImageReference
  ): Promise<AuthorizedFileIdentity> {
    const entity = await this.deps.getSourceMessage(
      conversationId,
      reference.messageId
    );
    if (!entity) {
      throw new GeneratedImageReferenceError("generated_image_missing");
    }
    if (entity.role !== "assistant" || entity.messageType !== MessageType.MESSAGE) {
      throw new GeneratedImageReferenceError("generated_image_not_owned");
    }
    const descriptor = extractDescriptor(entity, reference.imageIndex);
    const userDataPath = this.deps.getUserDataPath();
    const identity = parseGeneratedImageProtocolIdentity(
      descriptor.url,
      userDataPath
    );
    if (!identity) {
      throw new GeneratedImageReferenceError("generated_image_reference_invalid");
    }
    const normalizedEmail = normalizeGeneratedImageUserEmail(
      this.deps.getCurrentUserEmail()
    );
    if (
      identity.normalizedUser !== normalizedEmail ||
      identity.conversationPathPart !== sanitizeGeneratedImagePathPart(conversationId) ||
      identity.messagePathPart !== sanitizeGeneratedImagePathPart(reference.messageId)
    ) {
      throw new GeneratedImageReferenceError("generated_image_not_owned");
    }
    const userRoot = getGeneratedImageUserRoot(userDataPath, normalizedEmail);
    if (!isContained(userRoot, identity.candidatePath)) {
      log.warn(
        `[generated-image-ref] rejected outside-store reference code=generated_image_outside_store index=${reference.imageIndex}`
      );
      throw new GeneratedImageReferenceError("generated_image_outside_store");
    }
    let realRoot: string;
    try {
      realRoot = await this.deps.realpath(userRoot);
    } catch {
      throw new GeneratedImageReferenceError("generated_image_missing");
    }
    let realParentDir: string;
    try {
      realParentDir = await this.deps.realpath(path.dirname(identity.candidatePath));
    } catch {
      throw new GeneratedImageReferenceError("generated_image_missing");
    }
    const realResolved = path.join(realParentDir, identity.fileName);
    if (!isContained(realRoot, realResolved)) {
      log.warn(
        `[generated-image-ref] rejected escaped-realpath reference code=generated_image_outside_store index=${reference.imageIndex}`
      );
      throw new GeneratedImageReferenceError("generated_image_outside_store");
    }
    let linkStats: import("fs").Stats;
    try {
      linkStats = await fs.promises.lstat(realResolved);
    } catch {
      throw new GeneratedImageReferenceError("generated_image_missing");
    }
    if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
      throw new GeneratedImageReferenceError("generated_image_symlink_rejected");
    }
    return {
      url: descriptor.url,
      fileName: descriptor.fileName ?? identity.fileName,
      identity,
      realResolved,
    };
  }

  private async readViaPinnedDescriptor(
    absolutePath: string
  ): Promise<{ buffer: Buffer }> {
    let opened: OpenedReadFile | undefined;
    try {
      opened = await this.deps.openForRead(absolutePath);
      if (!opened.stats.isFile() || opened.stats.isSymbolicLink()) {
        throw new GeneratedImageReferenceError("generated_image_symlink_rejected");
      }
      if (opened.stats.size > CHAT_IMAGE_LIMITS.maxGeneratedSourceBytes) {
        throw new GeneratedImageReferenceError("generated_image_too_large");
      }
      return { buffer: await opened.read() };
    } finally {
      if (opened) {
        try {
          await opened.close();
        } catch {
          // close failures are non-fatal
        }
      }
    }
  }
}

function defaultGetUserDataPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { app } = require("electron") as typeof import("electron");
  return app.getPath("userData");
}

function defaultPrepareImage(
  source: Buffer,
  detectedMimeType: SupportedImageMimeType,
  detail: ImageDetail,
  signal?: AbortSignal
): Promise<PreparedModelImage> {
  return new GeneratedImagePreparationService().prepare(
    source,
    detectedMimeType,
    detail,
    signal
  );
}
