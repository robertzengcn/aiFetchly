import { ipcMain, BrowserWindow, dialog } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  AI_WORKSPACE_SET,
  AI_WORKSPACE_GET,
  AI_WORKSPACE_APPROVE,
  AI_WORKSPACE_REVOKE,
  AI_WORKSPACE_LIST,
  DIALOG_PICK_FOLDER,
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

function safeParse<T = unknown>(data: unknown): T | null {
  if (typeof data !== "string" || data.length === 0) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Test-only: reset module cache so the next handler call builds a fresh
 * WorkspaceModule against newly installed mocks. Never call from production.
 */
export function _resetAIWorkspaceSingletonsForTesting(): void {
  // WorkspaceModule is cheap to construct; no persistent singleton to clear.
}

export function registerAIWorkspaceIpcHandlers(_win: BrowserWindow): void {
  ipcMain.handle(
    AI_WORKSPACE_SET,
    async (_e, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAIEnabled()) {
        return denied("AI functionality is only available to subscribers.");
      }
      try {
        const payload = safeParse<Record<string, unknown>>(data);
        if (!payload) {
          return denied("Invalid workspace payload.");
        }
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
          label: typeof payload.label === "string" ? payload.label : null,
        });
        return ok(record);
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "Failed to set workspace."
        );
      }
    }
  );

  ipcMain.handle(
    AI_WORKSPACE_GET,
    async (_e, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAIEnabled()) {
        return denied("AI functionality is only available to subscribers.");
      }
      try {
        const payload = safeParse<{ conversationId?: unknown }>(data);
        if (!payload || typeof payload.conversationId !== "string") {
          return denied("conversationId must be a string.");
        }
        const module = new WorkspaceModule();
        const record = await module.getActiveWorkspace(payload.conversationId);
        return ok(record);
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "Failed to get workspace."
        );
      }
    }
  );

  ipcMain.handle(
    AI_WORKSPACE_APPROVE,
    async (_e, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAIEnabled()) {
        return denied("AI functionality is only available to subscribers.");
      }
      try {
        const payload = safeParse<{ id?: unknown }>(data);
        if (
          !payload ||
          typeof payload.id !== "number" ||
          !Number.isFinite(payload.id)
        ) {
          return denied("workspace id must be a number.");
        }
        const module = new WorkspaceModule();
        const record = await module.approveWorkspace(payload.id);
        return ok(record);
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "Failed to approve workspace."
        );
      }
    }
  );

  ipcMain.handle(
    AI_WORKSPACE_REVOKE,
    async (_e, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAIEnabled()) {
        return denied("AI functionality is only available to subscribers.");
      }
      try {
        const payload = safeParse<{ id?: unknown }>(data);
        if (
          !payload ||
          typeof payload.id !== "number" ||
          !Number.isFinite(payload.id)
        ) {
          return denied("workspace id must be a number.");
        }
        const module = new WorkspaceModule();
        const record = await module.revokeWorkspace(payload.id);
        return ok(record);
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "Failed to revoke workspace."
        );
      }
    }
  );

  ipcMain.handle(
    AI_WORKSPACE_LIST,
    async (_e, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAIEnabled()) {
        return denied("AI functionality is only available to subscribers.");
      }
      try {
        const payload = safeParse<{ conversationId?: unknown }>(data);
        if (!payload || typeof payload.conversationId !== "string") {
          return denied("conversationId must be a string.");
        }
        const module = new WorkspaceModule();
        const list = await module.listWorkspaces(payload.conversationId);
        return ok(list);
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "Failed to list workspaces."
        );
      }
    }
  );

  // Folder picker dialog - returns selected folder path or null if cancelled.
  // Gated on AI enablement per CLAUDE.md mandate for AI-serving IPC handlers.
  ipcMain.handle(
    DIALOG_PICK_FOLDER,
    async (): Promise<CommonMessage<string | null>> => {
      if (!isAIEnabled()) {
        return denied("AI functionality is only available to subscribers.");
      }
      try {
        const result = await dialog.showOpenDialog(_win, {
          properties: ["openDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return ok(null);
        }
        return ok(result.filePaths[0]);
      } catch (err) {
        return denied(
          err instanceof Error
            ? err.message
            : "Failed to pick workspace folder."
        );
      }
    }
  );
}
