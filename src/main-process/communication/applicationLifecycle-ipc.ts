import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { log } from "@/modules/Logger";
import {
  APPLICATION_LIFECYCLE_GET_STATE,
  APPLICATION_LIFECYCLE_STATE_CHANGED,
  APPLICATION_CLOSE_CHOICE_ACK,
  APPLICATION_CLOSE_CHOICE_SUBMIT,
} from "@/config/channellist";
import {
  applicationCloseChoiceAckSchema,
  applicationCloseChoiceSubmissionSchema,
  applicationLifecycleGetStateSchema,
} from "@/schemas/ipc/applicationLifecycle";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import type { ApplicationLifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";
import type { CloseChoiceFlow } from "@/main-process/lifecycle/CloseChoiceFlow";
import type { ApplicationLifecycleStateSnapshot } from "@/entityTypes/applicationLifecycleTypes";

/**
 * Application-lifecycle IPC handlers (technical design §10).
 *
 * Authorization: only the MAIN application window's webContents may submit
 * close choices (an authorized top-level renderer — never child windows,
 * never the browser bridge). Payloads are strict-object validated by the
 * Zod schemas; stale tokens and choices inconsistent with the current state
 * are typed rejections. The renderer can never send process IDs, shell
 * commands, or arbitrary quit reasons — the schema rejects unknown keys.
 *
 * Lifecycle IPC is NOT an AI feature and requires no AI entitlement check.
 */

export interface ApplicationLifecycleIpcDeps {
  readonly lifecycle: ApplicationLifecycleService;
  readonly closeChoiceFlow: CloseChoiceFlow;
  /** The single main application window (sender authorization). */
  readonly getMainWindow: () => BrowserWindow | null;
}

function isAuthorizedSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null
): boolean {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return false;
  // Structural id comparison — the electron tsconfig mock types
  // WebContents without `id` (same pattern as WS-7 R7.2 casts).
  const senderId = (event.sender as { id?: number }).id;
  const windowId = (win.webContents as { id?: number }).id;
  return senderId !== undefined && senderId === windowId;
}

export function registerApplicationLifecycleIpcHandlers(
  deps: ApplicationLifecycleIpcDeps
): void {
  const { lifecycle, closeChoiceFlow, getMainWindow } = deps;

  registerValidatedHandler<
    Record<string, never>,
    ApplicationLifecycleStateSnapshot
  >(
    APPLICATION_LIFECYCLE_GET_STATE,
    () => applicationLifecycleGetStateSchema(),
    () => {
      const snapshot = lifecycle.snapshot();
      return Promise.resolve({
        state: snapshot.state,
        phase: snapshot.phase,
        backgroundAvailable: snapshot.backgroundAvailable,
      });
    }
  );

  registerValidatedHandler<{ token: string }, { acknowledged: boolean }>(
    APPLICATION_CLOSE_CHOICE_ACK,
    applicationCloseChoiceAckSchema,
    (input, event) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        log.warn("[lifecycle-ipc] close-choice ack from unauthorized sender");
        return Promise.resolve({ acknowledged: false });
      }
      return Promise.resolve({
        acknowledged: closeChoiceFlow.acknowledge(input.token),
      });
    }
  );

  registerValidatedHandler<
    { token: string; choice: "hide" | "exit" | "cancel" },
    { accepted: boolean; stale: boolean }
  >(
    APPLICATION_CLOSE_CHOICE_SUBMIT,
    applicationCloseChoiceSubmissionSchema,
    (input, event) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        log.warn(
          "[lifecycle-ipc] close-choice submit from unauthorized sender"
        );
        return Promise.resolve({ accepted: false, stale: false });
      }
      // Stale (already-consumed/invalidated) submissions are silently
      // ignored by the flow; report acceptance back for UI state.
      const wasLive = lifecycle.isCloseChoiceTokenLive(input.token);
      closeChoiceFlow.submit(input.token, input.choice);
      return Promise.resolve({ accepted: wasLive, stale: !wasLive });
    }
  );
}

/**
 * Broadcast the lifecycle state to the main window (design §10
 * "Lifecycle changed event"). Safe to call at any time; never throws.
 */
export function broadcastLifecycleState(
  win: BrowserWindow | null,
  payload: unknown
): void {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(APPLICATION_LIFECYCLE_STATE_CHANGED, payload);
  } catch (err) {
    log.warn(
      "[lifecycle-ipc] state broadcast failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** Test helper channel cleanup (prevents duplicate-handler errors in tests). */
export function removeApplicationLifecycleIpcHandlers(): void {
  ipcMain.removeHandler(APPLICATION_LIFECYCLE_GET_STATE);
  ipcMain.removeHandler(APPLICATION_CLOSE_CHOICE_ACK);
  ipcMain.removeHandler(APPLICATION_CLOSE_CHOICE_SUBMIT);
}
