import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AIWorkspaceMemoryService } from "@/service/AIWorkspaceMemoryService";
import { getSharedWorkspaceAutoDreamService } from "@/service/AIAutoDreamFactory";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { ai_workspace_manual_memory_enabled } from "@/config/settinggroupInit";
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

/**
 * Manual workspace memory toggle (PRD FR-011). Default-on when the setting row
 * is absent; only disabled when the value is exactly "false". Read failures
 * degrade to enabled so a transient DB error never locks users out of their
 * own memories. List is read-only and not gated; auto-dream is AI-gated
 * separately.
 */
async function isManualMemoryEnabled(): Promise<boolean> {
  try {
    const v = await new SystemSettingModule().getSettingValue(
      ai_workspace_manual_memory_enabled
    );
    return v !== "false";
  } catch (err) {
    console.error(
      "[workspace-memory] failed to read manual-memory toggle:",
      err
    );
    return true;
  }
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
      if (!(await isManualMemoryEnabled())) {
        return denied("Manual workspace memory is disabled in settings.");
      }
      const input = safeParse<AIWorkspaceMemoryCreateInput>(data);
      if (
        !input ||
        typeof input.conversationId !== "string" ||
        !input.conversationId ||
        !input.title ||
        !input.content ||
        !input.type
      ) {
        return denied("conversationId, title, content, and type are required");
      }
      const result = await getWorkspaceMemoryService().createManualMemory(
        input
      );
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "create failed");
    }
  });

  ipcMain.handle(AI_WORKSPACE_MEMORY_UPDATE, async (_e, data: unknown) => {
    try {
      if (!(await isManualMemoryEnabled())) {
        return denied("Manual workspace memory is disabled in settings.");
      }
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
      if (!(await isManualMemoryEnabled())) {
        return denied("Manual workspace memory is disabled in settings.");
      }
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
      if (!(await isManualMemoryEnabled())) {
        return denied("Manual workspace memory is disabled in settings.");
      }
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

  // Manual workspace auto-dream run. AI-gated. Resolves + consolidates per
  // workspace group; failures mark the run failed but never throw to the UI.
  ipcMain.handle(
    AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM,
    async (_e, data: unknown) => {
      if (!isAIEnabled()) {
        return denied("AI functionality is only available to subscribers.");
      }
      try {
        const req = (safeParse<{ force?: boolean }>(data) ?? {}) as {
          force?: boolean;
        };
        const result = await getSharedWorkspaceAutoDreamService().runNow({
          force: req.force === true,
          reason: "manual_ipc",
        });
        return ok(result);
      } catch (err) {
        return denied(err instanceof Error ? err.message : "auto-dream failed");
      }
    }
  );

  ipcMain.handle(AI_WORKSPACE_MEMORY_AUTO_DREAM_STATUS, async () => {
    try {
      const result = await getSharedWorkspaceAutoDreamService().getStatus();
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "status failed");
    }
  });
}
