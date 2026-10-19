import { log } from "@/modules/Logger";
import { ipcMain, dialog, type IpcMainInvokeEvent } from "electron";
import { PluginFileArtifactModule } from "@/modules/PluginFileArtifactModule";
import { isAppTrustedOrigin } from "@/service/OriginTrust";
import {
  PLUGIN_ARTIFACT_LIST,
  PLUGIN_ARTIFACT_PREVIEW,
  PLUGIN_ARTIFACT_EXPORT,
  PLUGIN_ARTIFACT_DELETE,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

/**
 * IPC handlers for the host-owned plugin artifact store (design §13.4).
 *
 * Ownership: every operation is authenticated twice (B09):
 *  1. the IPC sender frame must be a trusted app origin (see OriginTrust), and
 *  2. the Module verifies conversation ownership server-side against
 *     host-written metadata before any read/preview/export/delete — a
 *     renderer-supplied artifact id is a reference, never authorization.
 * Export destinations are chosen through the native save dialog (never a
 * renderer-supplied absolute path). Reads are not AI-gated: no AI request is
 * made; the store holds already-created local content (mirrors
 * ai-artifact-ipc policy).
 */

function assertTrustedSender(event?: IpcMainInvokeEvent): void {
  if (!event || !isAppTrustedOrigin(event?.senderFrame?.url)) {
    throw new Error(
      "Plugin artifact request from an untrusted origin was denied."
    );
  }
}

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseConversationId(data: unknown): Parsed<string> {
  const record =
    typeof data === "string"
      ? safeParseRecord(data)
      : data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null;
  if (!record) return { ok: false, error: "Invalid request payload." };
  const conversationId = record.conversationId;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return { ok: false, error: "conversationId is required." };
  }
  return { ok: true, value: conversationId };
}

function safeParseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseArtifactRequest(
  data: unknown
): Parsed<{ conversationId: string; artifactId: string }> {
  const conv = parseConversationId(data);
  if (!conv.ok) return conv;
  const record = (data && typeof data === "object"
    ? data
    : safeParseRecord(String(data))) as Record<string, unknown>;
  const artifactId = record.artifactId;
  if (typeof artifactId !== "string" || artifactId.length === 0) {
    return { ok: false, error: "artifactId is required." };
  }
  return { ok: true, value: { conversationId: conv.value, artifactId } };
}

async function handleList(event?: IpcMainInvokeEvent, data?: unknown) {
  const req = parseConversationId(data);
  if (!req.ok) return denied(req.error);
  try {
    assertTrustedSender(event);
    const module = new PluginFileArtifactModule();
    return ok(await module.listForConversation(req.value));
  } catch (err) {
    log.error("[plugin-artifact] list failed:", err);
    return denied(
      err instanceof Error ? err.message : "Failed to list plugin artifacts."
    );
  }
}

async function handlePreview(event?: IpcMainInvokeEvent, data?: unknown) {
  const req = parseArtifactRequest(data);
  if (!req.ok) return denied(req.error);
  try {
    assertTrustedSender(event);
    const module = new PluginFileArtifactModule();
    return ok(await module.preview(req.value.conversationId, req.value.artifactId));
  } catch (err) {
    log.error("[plugin-artifact] preview failed:", err);
    return denied(
      err instanceof Error ? err.message : "Failed to preview the plugin artifact."
    );
  }
}

async function handleExport(event: IpcMainInvokeEvent | undefined, data: unknown) {
  const req = parseArtifactRequest(data);
  if (!req.ok) return denied(req.error);
  try {
    assertTrustedSender(event);
    const module = new PluginFileArtifactModule();
    const list = await module.listForConversation(req.value.conversationId);
    const artifact = list.find((a) => a.id === req.value.artifactId);
    if (!artifact) return denied("Artifact not found for this conversation.");
    // Destination is chosen through the NATIVE save dialog — the renderer
    // never supplies an absolute path (design §13.4).
    const defaultName = `plugin-artifact-${artifact.id}.${
      artifact.format === "json" ? "json" : "csv"
    }`;
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
    });
    if (result.canceled || !result.filePath) {
      return ok({ cancelled: true });
    }
    const exported = await module.exportToPath(
      req.value.conversationId,
      req.value.artifactId,
      result.filePath
    );
    if (!exported.ok) return denied(exported.error);
    return ok({ cancelled: false, sizeBytes: exported.sizeBytes });
  } catch (err) {
    log.error("[plugin-artifact] export failed:", err);
    return denied(
      err instanceof Error ? err.message : "Failed to export the plugin artifact."
    );
  }
}

async function handleDelete(event?: IpcMainInvokeEvent, data?: unknown) {
  const req = parseArtifactRequest(data);
  if (!req.ok) return denied(req.error);
  try {
    assertTrustedSender(event);
    const module = new PluginFileArtifactModule();
    const result = await module.delete(req.value.conversationId, req.value.artifactId);
    if (!result.ok) return denied(result.error ?? "Delete failed.");
    return ok({ deleted: true });
  } catch (err) {
    log.error("[plugin-artifact] delete failed:", err);
    return denied(
      err instanceof Error ? err.message : "Failed to delete the plugin artifact."
    );
  }
}

export function registerPluginArtifactIpcHandlers(): void {
  ipcMain.handle(PLUGIN_ARTIFACT_LIST, async (event, data: unknown) =>
    handleList(event, data)
  );
  ipcMain.handle(PLUGIN_ARTIFACT_PREVIEW, async (event, data: unknown) =>
    handlePreview(event, data)
  );
  ipcMain.handle(PLUGIN_ARTIFACT_EXPORT, async (event, data: unknown) =>
    handleExport(event, data)
  );
  ipcMain.handle(PLUGIN_ARTIFACT_DELETE, async (event, data: unknown) =>
    handleDelete(event, data)
  );
}
