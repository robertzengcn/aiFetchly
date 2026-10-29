import { BrowserWindow } from "electron";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { getNativeDialogService } from "@/service/dialogs/NativeDialogServiceProvider";
import {
  AI_WORKSPACE_SET,
  AI_WORKSPACE_GET,
  AI_WORKSPACE_APPROVE,
  AI_WORKSPACE_REVOKE,
  AI_WORKSPACE_LIST,
  DIALOG_PICK_FOLDER,
} from "@/config/channellist";
import { WorkspaceModule } from "@/modules/WorkspaceModule";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { byIdInputSchema, noInputSchema } from "@/schemas/ipc/_shared/common";

// WS-1 R1.5: input schemas (replacing the manual safeParse + typeof checks).
const workspaceSetSchema = lazySchema(() =>
  z.strictObject({
    conversationId: z.string(),
    rootPath: z.string(),
    label: z.string().optional(),
  })
);
const conversationIdSchema = lazySchema(() =>
  z.strictObject({ conversationId: z.string() })
);

/**
 * Test-only: reset module cache so the next handler call builds a fresh
 * WorkspaceModule against newly installed mocks. Never call from production.
 */
export function _resetAIWorkspaceSingletonsForTesting(): void {
  // WorkspaceModule is cheap to construct; no persistent singleton to clear.
}

export function registerAIWorkspaceIpcHandlers(_win: BrowserWindow): void {
  // Workspace choosing is intentionally NOT AI-gated: picking/listing a
  // local folder and its DB records involves no hosted-AI call, and users
  // may point the workspace at their own AI host. The AI file tools that
  // operate inside the workspace stay gated at their own IPC handlers.
  // All handlers are Zod-validated via registerValidatedHandler, which
  // emits the {status,msg,data} envelope and converts thrown errors to
  // {status:false,msg}. The renderer reads result.status / result.data.

  registerValidatedHandler(AI_WORKSPACE_SET, workspaceSetSchema, async (payload) => {
    const module = new WorkspaceModule();
    return await module.setWorkspace({
      conversationId: payload.conversationId,
      rootPath: payload.rootPath,
      label: payload.label ?? null,
    });
  });

  registerValidatedHandler(AI_WORKSPACE_GET, conversationIdSchema, async (payload) => {
    const module = new WorkspaceModule();
    return await module.getActiveWorkspace(payload.conversationId);
  });

  registerValidatedHandler(AI_WORKSPACE_APPROVE, byIdInputSchema, async (payload) => {
    const module = new WorkspaceModule();
    return await module.approveWorkspace(payload.id);
  });

  registerValidatedHandler(AI_WORKSPACE_REVOKE, byIdInputSchema, async (payload) => {
    const module = new WorkspaceModule();
    return await module.revokeWorkspace(payload.id);
  });

  registerValidatedHandler(AI_WORKSPACE_LIST, conversationIdSchema, async (payload) => {
    const module = new WorkspaceModule();
    return await module.listWorkspaces(payload.conversationId);
  });

  // Folder picker dialog. Local OS dialog — no AI enablement needed.
  registerValidatedHandler(DIALOG_PICK_FOLDER, noInputSchema, async () => {
    const dialogService = await getNativeDialogService();
    const result = await dialogService.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
}
