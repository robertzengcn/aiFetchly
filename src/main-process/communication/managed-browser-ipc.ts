import type { BrowserWindow } from "electron";
import {
  MANAGED_BROWSER_LIST_ELIGIBLE_ACCOUNTS,
  MANAGED_BROWSER_LIST_ACTIVE,
  MANAGED_BROWSER_START,
  MANAGED_BROWSER_STATUS,
  MANAGED_BROWSER_HANDOFF,
  MANAGED_BROWSER_VERIFY_MANUAL_LOGIN,
  MANAGED_BROWSER_RESUME,
  MANAGED_BROWSER_STOP,
  MANAGED_BROWSER_APPROVE,
  MANAGED_BROWSER_EXTEND_HANDOFF,
  MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS,
  MANAGED_BROWSER_GET_CACHE_STATUS,
  MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION,
  MANAGED_BROWSER_CLEAR_CACHE,
  MANAGED_BROWSER_UPDATE_SETTINGS,
  MANAGED_BROWSER_STATUS_EVENT,
  MANAGED_BROWSER_CHAT_NOTICE_EVENT,
  MANAGED_BROWSER_CACHE_PROGRESS_EVENT,
} from "@/config/channellist";
import {
  registerAiValidatedHandler,
  registerValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  listEligibleAccountsInputSchema,
  managedBrowserStartInputSchema,
  managedBrowserStatusInputSchema,
  managedBrowserHandoffInputSchema,
  managedBrowserVerifyManualLoginInputSchema,
  managedBrowserResumeInputSchema,
  managedBrowserStopInputSchema,
  managedBrowserApproveInputSchema,
  managedBrowserExtendHandoffInputSchema,
  managedBrowserGetEffectiveSettingsInputSchema,
  managedBrowserGetCacheStatusInputSchema,
  managedBrowserClearCacheInputSchema,
  managedBrowserUpdateSettingsInputSchema,
} from "@/schemas/ipc/managedBrowser";
import { getDefaultManagedBrowserModule } from "@/modules/ManagedBrowserModule";
import {
  getDefaultManagedBrowserCacheModule,
  ManagedBrowserCacheError,
} from "@/modules/ManagedBrowserCacheModule";
import { noInputSchema } from "@/schemas/ipc/_shared/common";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";
import type { SafeBrowserChatNotice } from "@/entityTypes/managedBrowserTypes";

/**
 * Managed-browser IPC (technical design §22).
 *
 * Session channels are AI-FACING: `registerAiValidatedHandler` checks
 * USER_AI_ENABLED FIRST (before parsing) — the AI-gate mandate. Settings and
 * cache channels are management-only (the settings page must work when AI is
 * disabled) and use the plain validated wrapper.
 *
 * Events to the renderer (status-changed, chat-notice, cache-progress) are
 * wired here from the process singletons. No handler touches a Model,
 * TypeORM repository, or the filesystem — everything routes through
 * ManagedBrowserModule / ManagedBrowserCacheModule.
 */

/** Safe webContents.send: a destroyed window must never crash the module. */
function sendToRenderer(
  win: BrowserWindow,
  channel: string,
  payload: unknown
): void {
  try {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  } catch {
    // Window teardown races are expected — drop the event.
  }
}

export function registerManagedBrowserIpcHandlers(win: BrowserWindow): void {
  // --- Event bridge: module singletons → renderer -----------------------
  const browserModule = getDefaultManagedBrowserModule();
  const cacheModule = getDefaultManagedBrowserCacheModule();
  browserModule.setStatusSink((status) =>
    sendToRenderer(win, MANAGED_BROWSER_STATUS_EVENT, status)
  );
  const forwardNotice = (notice: SafeBrowserChatNotice): void =>
    sendToRenderer(win, MANAGED_BROWSER_CHAT_NOTICE_EVENT, notice);
  browserModule.setNoticeSink(forwardNotice);
  cacheModule.setNoticeSink(forwardNotice);
  cacheModule.setProgressSink((progress) =>
    sendToRenderer(win, MANAGED_BROWSER_CACHE_PROGRESS_EVENT, progress)
  );

  // --- AI-facing session channels (USER_AI_ENABLED checked FIRST) -------
  registerAiValidatedHandler(
    MANAGED_BROWSER_LIST_ELIGIBLE_ACCOUNTS,
    listEligibleAccountsInputSchema,
    async () => browserModule.listEligibleAccounts()
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_LIST_ACTIVE,
    noInputSchema,
    async () => browserModule.listActiveSessions()
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_START,
    managedBrowserStartInputSchema,
    async (input) => browserModule.start(input, { aiEntryPoint: true })
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_STATUS,
    managedBrowserStatusInputSchema,
    async (input) => browserModule.getStatus(input.sessionId)
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_HANDOFF,
    managedBrowserHandoffInputSchema,
    // Renderer-initiated handoff is always user_requested; AI-driven handoff
    // reasons arrive as worker HANDOFF_REQUIRED events, never from IPC.
    async (input) => browserModule.requestHandoff(input.sessionId)
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_VERIFY_MANUAL_LOGIN,
    managedBrowserVerifyManualLoginInputSchema,
    async (input) => browserModule.verifyManualLogin(input.sessionId)
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_RESUME,
    managedBrowserResumeInputSchema,
    async (input) => browserModule.resumeAfterHandoff(input.sessionId)
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_STOP,
    managedBrowserStopInputSchema,
    async (input) =>
      browserModule.stop(
        input.sessionId,
        input.reason === "cancelled" ? "cancelled" : "user_stop"
      )
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_APPROVE,
    managedBrowserApproveInputSchema,
    async (input) => {
      browserModule.recordApproval(input);
      return { recorded: true as const };
    }
  );

  registerAiValidatedHandler(
    MANAGED_BROWSER_EXTEND_HANDOFF,
    managedBrowserExtendHandoffInputSchema,
    async (input) =>
      browserModule.extendHandoff(input.sessionId, input.extendMinutes)
  );

  // --- Management channels (NOT AI-gated; settings page) ----------------
  registerValidatedHandler(
    MANAGED_BROWSER_UPDATE_SETTINGS,
    managedBrowserUpdateSettingsInputSchema,
    async (input) => new ManagedBrowserSettingsModule().updatePreferences(input)
  );

  registerValidatedHandler(
    MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS,
    managedBrowserGetEffectiveSettingsInputSchema,
    async () => browserModule.getEffectiveSettingsForRenderer()
  );

  registerValidatedHandler(
    MANAGED_BROWSER_GET_CACHE_STATUS,
    managedBrowserGetCacheStatusInputSchema,
    async (input) =>
      input.scope === "all"
        ? cacheModule.getStatusForAllScopes()
        : cacheModule.getStatus(input.accountId as number)
  );

  registerValidatedHandler(
    MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION,
    managedBrowserGetCacheStatusInputSchema,
    async (input) => ({
      confirmationId: cacheModule.issueClearConfirmation({
        scope: input.scope,
        accountId: input.scope === "account" ? input.accountId : undefined,
      }),
    })
  );

  registerValidatedHandler(
    MANAGED_BROWSER_CLEAR_CACHE,
    managedBrowserClearCacheInputSchema,
    async (input) => {
      try {
        return await cacheModule.clearCache(input);
      } catch (error) {
        if (error instanceof ManagedBrowserCacheError) {
          // Approval/terminal codes — surfaced as msg, never paths.
          throw new Error(error.code);
        }
        throw error;
      }
    }
  );
}
