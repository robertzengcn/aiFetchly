import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AIWorkspaceMemoryService } from "@/service/AIWorkspaceMemoryService";
import {
  AI_WORKSPACE_MEMORY_LIST,
  AI_WORKSPACE_MEMORY_CREATE,
  AI_WORKSPACE_MEMORY_UPDATE,
  AI_WORKSPACE_MEMORY_ARCHIVE,
  AI_WORKSPACE_MEMORY_DELETE,
  AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM,
  AI_WORKSPACE_MEMORY_AUTO_DREAM_STATUS,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  AIWorkspaceMemoryCreateInput,
  AIWorkspaceMemoryUpdateInput,
  AIWorkspaceMemorySearchInput,
} from "@/entityTypes/aiWorkspaceMemoryTypes";

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

let workspaceMemoryService: AIWorkspaceMemoryService | null = null;

function getWorkspaceMemoryService(): AIWorkspaceMemoryService {
  if (!workspaceMemoryService) {
    workspaceMemoryService = new AIWorkspaceMemoryService();
  }
  return workspaceMemoryService;
}

function isAIEnabled(): boolean {
  return new Token().getValue(USER_AI_ENABLED) === "true";
}

function safeParse<T = unknown>(data: unknown): T | null {
  if (typeof data !== "string" || data.length === 0) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Test-only: drop the cached workspace memory service singleton so the next
 * handler call rebuilds it against freshly installed mocks. Never call from
 * production.
 */
export function _resetAIWorkspaceMemorySingletonsForTesting(): void {
  workspaceMemoryService = null;
}

export function registerAIWorkspaceMemoryIpcHandlers(): void {
  ipcMain.handle(AI_WORKSPACE_MEMORY_LIST, async (_e, data: unknown) => {
    try {
      const input = (safeParse<AIWorkspaceMemorySearchInput>(data) ??
        {}) as AIWorkspaceMemorySearchInput;
      if (typeof input.conversationId !== "string" || !input.conversationId) {
        return denied("conversationId is required");
      }
      const result = await getWorkspaceMemoryService().list(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "list failed");
    }
  });

  ipcMain.handle(AI_WORKSPACE_MEMORY_CREATE, async (_e, data: unknown) => {
    try {
      const input = safeParse<AIWorkspaceMemoryCreateInput>(data);
      if (
        !input ||
        typeof input.conversationId !== "string" ||
        !input.conversationId ||
        !input.title ||
        !input.content ||
        !input.type
      ) {
        return denied(
          "conversationId, title, content, and type are required"
        );
      }
      const result = await getWorkspaceMemoryService().createManualMemory(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "create failed");
    }
  });

  ipcMain.handle(AI_WORKSPACE_MEMORY_UPDATE, async (_e, data: unknown) => {
    try {
      const input = safeParse<AIWorkspaceMemoryUpdateInput>(data);
      if (
        !input ||
        typeof input.conversationId !== "string" ||
        !input.conversationId ||
        !input.memoryId
      ) {
        return denied("conversationId and memoryId are required");
      }
      const result = await getWorkspaceMemoryService().update(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "update failed");
    }
  });

  ipcMain.handle(AI_WORKSPACE_MEMORY_ARCHIVE, async (_e, data: unknown) => {
    try {
      const input = safeParse<{ conversationId?: string; memoryId?: string }>(
        data
      );
      if (!input || !input.conversationId || !input.memoryId) {
        return denied("conversationId and memoryId are required");
      }
      // The service resolves the workspace from conversationId itself; a
      // renderer-supplied workspaceKey in the payload is never trusted.
      await getWorkspaceMemoryService().archive(
        input.conversationId,
        input.memoryId
      );
      return ok(null);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "archive failed");
    }
  });

  ipcMain.handle(AI_WORKSPACE_MEMORY_DELETE, async (_e, data: unknown) => {
    try {
      const input = safeParse<{ conversationId?: string; memoryId?: string }>(
        data
      );
      if (!input || !input.conversationId || !input.memoryId) {
        return denied("conversationId and memoryId are required");
      }
      const n = await getWorkspaceMemoryService().delete(
        input.conversationId,
        input.memoryId
      );
      return ok(n);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "delete failed");
    }
  });

  // NOTE: Phase 4 wires these two to the shared workspace auto-dream service.
  // Until then they return a clear "not available" response so the channels
  // remain valid and the UI degrades gracefully.
  ipcMain.handle(AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM, async () => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    return denied("Workspace auto-dream is not available yet.");
  });

  ipcMain.handle(AI_WORKSPACE_MEMORY_AUTO_DREAM_STATUS, async () => {
    return ok({ aiEnabled: isAIEnabled(), autoDreamEnabled: false });
  });
}
