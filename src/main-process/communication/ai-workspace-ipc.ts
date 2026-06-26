import { ipcMain, BrowserWindow } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  AI_WORKSPACE_SET,
  AI_WORKSPACE_GET,
  AI_WORKSPACE_APPROVE,
  AI_WORKSPACE_REVOKE,
  AI_WORKSPACE_LIST,
} from "@/config/channellist";
import { WorkspaceModule } from "@/modules/WorkspaceModule";
import type { CommonMessage } from "@/entityTypes/commonType";

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

function isAIEnabled(): boolean {
  return new Token().getValue(USER_AI_ENABLED) === "true";
}

/**
 * Test-only: reset module cache so the next handler call builds a fresh
 * WorkspaceModule against newly installed mocks. Never call from production.
 */
export function _resetAIWorkspaceSingletonsForTesting(): void {
  // WorkspaceModule is cheap to construct; no persistent singleton to clear.
}

export function registerAIWorkspaceIpcHandlers(_win: BrowserWindow): void {
  ipcMain.handle(AI_WORKSPACE_SET, async (_e, data: unknown): Promise<CommonMessage<unknown>> => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    try {
      if (!data || typeof data !== "object") {
        return denied("Invalid workspace payload.");
      }
      const payload = data as Record<string, unknown>;
      if (
        typeof payload.conversationId !== "string" ||
        typeof payload.rootPath !== "string"
      ) {
        return denied("conversationId and rootPath are required strings.");
      }
      const module = new WorkspaceModule();
      const record = await module.setWorkspace({
        conversationId: payload.conversationId,
        rootPath: payload.rootPath,
        label:
          typeof payload.label === "string" ? payload.label : null,
      });
      return ok(record);
    } catch (err) {
      return denied(
        err instanceof Error ? err.message : "Failed to set workspace."
      );
    }
  });

  ipcMain.handle(AI_WORKSPACE_GET, async (_e, conversationId: unknown): Promise<CommonMessage<unknown>> => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    try {
      if (typeof conversationId !== "string") {
        return denied("conversationId must be a string.");
      }
      const module = new WorkspaceModule();
      const record = await module.getActiveWorkspace(conversationId);
      return ok(record);
    } catch (err) {
      return denied(
        err instanceof Error ? err.message : "Failed to get workspace."
      );
    }
  });

  ipcMain.handle(AI_WORKSPACE_APPROVE, async (_e, id: unknown): Promise<CommonMessage<unknown>> => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    try {
      if (typeof id !== "number" || !Number.isFinite(id)) {
        return denied("workspace id must be a number.");
      }
      const module = new WorkspaceModule();
      const record = await module.approveWorkspace(id);
      return ok(record);
    } catch (err) {
      return denied(
        err instanceof Error ? err.message : "Failed to approve workspace."
      );
    }
  });

  ipcMain.handle(AI_WORKSPACE_REVOKE, async (_e, id: unknown): Promise<CommonMessage<unknown>> => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    try {
      if (typeof id !== "number" || !Number.isFinite(id)) {
        return denied("workspace id must be a number.");
      }
      const module = new WorkspaceModule();
      const record = await module.revokeWorkspace(id);
      return ok(record);
    } catch (err) {
      return denied(
        err instanceof Error ? err.message : "Failed to revoke workspace."
      );
    }
  });

  ipcMain.handle(AI_WORKSPACE_LIST, async (_e, conversationId: unknown): Promise<CommonMessage<unknown>> => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    try {
      if (typeof conversationId !== "string") {
        return denied("conversationId must be a string.");
      }
      const module = new WorkspaceModule();
      const list = await module.listWorkspaces(conversationId);
      return ok(list);
    } catch (err) {
      return denied(
        err instanceof Error ? err.message : "Failed to list workspaces."
      );
    }
  });
}
