import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AIUserMemoryService } from "@/service/AIUserMemoryService";
import { getSharedAutoDreamService } from "@/service/AIAutoDreamFactory";
import {
  AI_USER_MEMORY_LIST,
  AI_USER_MEMORY_CREATE,
  AI_USER_MEMORY_UPDATE,
  AI_USER_MEMORY_ARCHIVE,
  AI_USER_MEMORY_DELETE,
  AI_USER_MEMORY_RUN_AUTO_DREAM,
  AI_USER_MEMORY_AUTO_DREAM_STATUS,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
} from "@/entityTypes/aiUserMemoryTypes";

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

let memoryService: AIUserMemoryService | null = null;

function getMemoryService(): AIUserMemoryService {
  if (!memoryService) {
    memoryService = new AIUserMemoryService();
  }
  return memoryService;
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
 * Test-only: drop the cached memory service singleton so the next handler
 * call rebuilds it against freshly installed mocks. Never call from production.
 */
export function _resetAIUserMemorySingletonsForTesting(): void {
  memoryService = null;
}

export function registerAIUserMemoryIpcHandlers(): void {
  ipcMain.handle(AI_USER_MEMORY_LIST, async (_e, data: unknown) => {
    try {
      const input = (safeParse<AIUserMemorySearchInput>(data) ??
        {}) as AIUserMemorySearchInput;
      const result = await getMemoryService().list(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "list failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_CREATE, async (_e, data: unknown) => {
    try {
      const input = safeParse<AIUserMemoryCreateInput>(data);
      if (!input || !input.title || !input.content || !input.type) {
        return denied("title, content, and type are required");
      }
      const result = await getMemoryService().createManualMemory(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "create failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_UPDATE, async (_e, data: unknown) => {
    try {
      const input = safeParse<AIUserMemoryUpdateInput>(data);
      if (!input || !input.memoryId) {
        return denied("memoryId is required");
      }
      const result = await getMemoryService().update(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "update failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_ARCHIVE, async (_e, data: unknown) => {
    try {
      const memoryId = safeParse<string>(data);
      if (!memoryId) return denied("memoryId is required");
      await getMemoryService().archive(memoryId);
      return ok(null);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "archive failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_DELETE, async (_e, data: unknown) => {
    try {
      const memoryId = safeParse<string>(data);
      if (!memoryId) return denied("memoryId is required");
      const n = await getMemoryService().delete(memoryId);
      return ok(n);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "delete failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_RUN_AUTO_DREAM, async (_e, data: unknown) => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    try {
      const req = (safeParse<{ force?: boolean }>(data) ?? {}) as {
        force?: boolean;
      };
      const result = await getSharedAutoDreamService().runNow({
        force: req.force === true,
        reason: "manual_ipc",
      });
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "auto-dream failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_AUTO_DREAM_STATUS, async () => {
    try {
      const result = await getSharedAutoDreamService().getStatus();
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "status failed");
    }
  });
}
