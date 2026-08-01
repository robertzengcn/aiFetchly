import { ipcMain } from "electron";
import { AIArtifactModule } from "@/modules/AIArtifactModule";
import { AI_ARTIFACT_GET, AI_ARTIFACT_LIST } from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  AIArtifactRecord,
  AIArtifactSummary,
  GetAIArtifactRequest,
  ListAIArtifactsRequest,
} from "@/entityTypes/aiArtifactTypes";

/**
 * IPC handlers for reading AI artifacts.
 *
 * Read access is intentionally NOT gated on USER_AI_ENABLED: artifact
 * creation is already gated through the AI Chat V2 stream, and reads only
 * return already-created local content. (See tech design §10.2, §21.5.)
 *
 * Handlers never touch TypeORM repositories directly — all persistence goes
 * through {@link AIArtifactModule}.
 */

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accept either a JSON string or an already-parsed object from the renderer. */
function parseObject(data: unknown): ParseResult<Record<string, unknown>> {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data ?? "{}");
      if (parsed && typeof parsed === "object") {
        return { ok: true, value: parsed as Record<string, unknown> };
      }
      return { ok: false, error: "Invalid request payload." };
    } catch {
      return { ok: false, error: "Invalid request payload." };
    }
  }
  if (data && typeof data === "object") {
    return { ok: true, value: data as Record<string, unknown> };
  }
  return { ok: false, error: "Invalid request payload." };
}

function parseGetArtifactRequest(data: unknown): ParseResult<GetAIArtifactRequest> {
  const parsed = parseObject(data);
  if (!parsed.ok) return parsed;
  const artifactId = parsed.value.artifactId;
  if (typeof artifactId !== "string" || artifactId.trim().length === 0) {
    return { ok: false, error: "artifactId is required." };
  }
  return { ok: true, value: { artifactId: artifactId.trim() } };
}

function parseListArtifactsRequest(
  data: unknown
): ParseResult<ListAIArtifactsRequest> {
  const parsed = parseObject(data);
  if (!parsed.ok) return parsed;
  const conversationId = parsed.value.conversationId;
  if (typeof conversationId !== "string" || conversationId.trim().length === 0) {
    return { ok: false, error: "conversationId is required." };
  }
  return { ok: true, value: { conversationId: conversationId.trim() } };
}

async function handleGetArtifact(
  data: unknown
): Promise<CommonMessage<AIArtifactRecord | null>> {
  const req = parseGetArtifactRequest(data);
  if (!req.ok) return denied(req.error);
  try {
    const module = new AIArtifactModule();
    const artifact = await module.getArtifact(req.value.artifactId);
    return ok(artifact);
  } catch (err) {
    console.error("[ai-artifact] get failed:", err);
    return denied(
      err instanceof Error ? err.message : "Failed to read the artifact."
    );
  }
}

async function handleListArtifacts(
  data: unknown
): Promise<CommonMessage<AIArtifactSummary[]>> {
  const req = parseListArtifactsRequest(data);
  if (!req.ok) return denied(req.error);
  try {
    const module = new AIArtifactModule();
    const artifacts = await module.listArtifacts(req.value.conversationId);
    return ok(artifacts);
  } catch (err) {
    console.error("[ai-artifact] list failed:", err);
    return denied(
      err instanceof Error ? err.message : "Failed to list artifacts."
    );
  }
}

export function registerAIArtifactIpcHandlers(): void {
  ipcMain.handle(AI_ARTIFACT_GET, async (_e, data: unknown) =>
    handleGetArtifact(data)
  );
  ipcMain.handle(AI_ARTIFACT_LIST, async (_e, data: unknown) =>
    handleListArtifacts(data)
  );
}
