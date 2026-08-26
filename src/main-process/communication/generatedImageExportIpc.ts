import { ipcMain } from "electron";
import {
  AI_CHAT_V2_EXPORT_GENERATED_IMAGE,
} from "@/config/channellist";
import { canUseChat } from "@/main-process/communication/ai-chat-v2-ipc";
import { GeneratedImageReferenceService } from "@/service/GeneratedImageReferenceService";
import { GeneratedImageReferenceError } from "@/entityTypes/generatedImageReferenceTypes";
import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import {
  exportSingleGeneratedArtifact,
} from "@/service/agentTools/exportGeneratedArtifactsTool";
import type { ExportSingleGeneratedArtifactResult } from "@/service/agentTools/exportGeneratedArtifactsTool";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { userSafeError } from "@/service/AIChatErrorMapper";
import type { CommonMessage } from "@/entityTypes/commonType";

/** Renderer-facing outcome for one save-to-workspace action. */
export type GeneratedImageExportOutcome =
  | {
      status: "exported";
      destinationPath: string;
      relativeDestinationPath: string;
      fileName: string;
    }
  | { status: "workspace_required" };

function ok(data: GeneratedImageExportOutcome): CommonMessage<GeneratedImageExportOutcome> {
  return { status: true, msg: "", data };
}

function denied(msg: string): CommonMessage<GeneratedImageExportOutcome> {
  return { status: false, msg, data: undefined as unknown as GeneratedImageExportOutcome };
}

interface ParsedExportImageRequest {
  conversationId: string;
  reference: ChatV2GeneratedImageReference;
}

/**
 * Strictly validate the raw IPC payload. Accepts a plain object (renderer
 * convention); every field is type-checked so forged or malformed payloads
 * are rejected before any authorization work happens.
 */
function parseExportImageRequest(
  data: unknown
): ParsedExportImageRequest | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.conversationId !== "string" || raw.conversationId.length === 0) {
    return null;
  }
  const referenceRaw = raw.reference;
  if (!referenceRaw || typeof referenceRaw !== "object" || Array.isArray(referenceRaw)) {
    return null;
  }
  const reference = referenceRaw as Record<string, unknown>;
  if (typeof reference.messageId !== "string" || reference.messageId.length === 0) {
    return null;
  }
  if (
    typeof reference.imageIndex !== "number" ||
    !Number.isInteger(reference.imageIndex) ||
    reference.imageIndex < 0
  ) {
    return null;
  }
  // Strip any extra renderer-supplied fields — the reference must stay opaque.
  return {
    conversationId: raw.conversationId,
    reference: {
      messageId: reference.messageId,
      imageIndex: reference.imageIndex,
    },
  };
}

function freshToolCallId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `manual-export-${crypto.randomUUID()}`;
  }
  return `manual-export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Persist a tool_result row compatible with the renderer file-op chip rebuild
 * (fileOperationMetadata.extractArtifactExportOperations reads items[].status
 * + destination), so history chips render exactly like model-driven exports.
 */
async function persistChipCompatibleToolResult(input: {
  conversationId: string;
  assistantMessageId: string;
  protocolUrl: string;
  exported: Extract<ExportSingleGeneratedArtifactResult, { status: "exported" }>;
}): Promise<void> {
  const module = new AIChatV2Module();
  await module.saveToolResultMessage({
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    toolCallId: freshToolCallId(),
    toolName: "export_generated_artifacts",
    content: "",
    toolResult: {
      success: true,
      status: "completed",
      summary: `Saved ${input.exported.fileName} to the workspace.`,
      requestedCount: 1,
      exportedCount: 1,
      failedCount: 0,
      cancelledCount: 0,
      collisionPolicy: "rename",
      items: [
        {
          artifactUrl: input.protocolUrl,
          destination: input.exported.destinationPath,
          status: "exported",
          renamed: false,
        },
      ],
    },
  });
}

async function handleExportGeneratedImage(
  data: unknown
): Promise<CommonMessage<GeneratedImageExportOutcome>> {
  // AI gate FIRST — before parsing the payload or touching the filesystem.
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }

  const parsed = parseExportImageRequest(data);
  if (!parsed) {
    return denied("conversationId and a {messageId, imageIndex} reference are required");
  }

  // Authorize the single reference in the main process; never trust any
  // renderer-supplied path or URL.
  let protocolUrl: string;
  try {
    const authorized = await new GeneratedImageReferenceService().authorizeOnly({
      conversationId: parsed.conversationId,
      references: [parsed.reference],
    });
    const source = authorized[0];
    if (!source) {
      return denied("generated_image_reference_invalid");
    }
    protocolUrl = source.protocolUrl;
  } catch (err) {
    if (err instanceof GeneratedImageReferenceError) {
      // Typed, safe error code — no paths, no stack traces.
      return denied(err.code);
    }
    return denied(userSafeError(err));
  }

  // Approved workspace presence check (same resolver seam as the export tool).
  const workspace = await new WorkspaceResolver().resolve(parsed.conversationId);
  if (!workspace) {
    return ok({ status: "workspace_required" });
  }

  // Reuse the exact export policy of export_generated_artifacts for ONE file.
  const result = await exportSingleGeneratedArtifact({
    conversationId: parsed.conversationId,
    sourceUrl: protocolUrl,
  });
  if (result.status === "workspace_required") {
    return ok({ status: "workspace_required" });
  }
  if (result.status === "failed") {
    return denied(result.error);
  }

  try {
    await persistChipCompatibleToolResult({
      conversationId: parsed.conversationId,
      assistantMessageId: parsed.reference.messageId,
      protocolUrl,
      exported: result,
    });
  } catch (err) {
    // The file was copied successfully; persistence of the history chip must
    // not turn an already-successful export into a renderer-visible failure.
    console.error(
      "[generated-image-export] failed to persist tool_result row:",
      err
    );
  }

  return ok({
    status: "exported",
    destinationPath: result.destinationPath,
    relativeDestinationPath: result.relativeDestinationPath,
    fileName: result.fileName,
  });
}

/**
 * Register the save-to-workspace handler for generated chat images.
 *
 * Gated by canUseChat() FIRST; authorizes the opaque reference via
 * GeneratedImageReferenceService.authorizeOnly (exactly one reference);
 * returns {status:"workspace_required"} when no approved workspace exists so
 * the renderer can surface its request-workspace flow without throwing.
 */
export function registerGeneratedImageExportIpcHandlers(): void {
  ipcMain.handle(AI_CHAT_V2_EXPORT_GENERATED_IMAGE, async (_e, data: unknown) =>
    handleExportGeneratedImage(data)
  );
}
