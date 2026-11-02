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
  MANAGED_BROWSER_CANCEL_ACTIVE,
  MANAGED_BROWSER_CAPTURE_SCREENSHOT,
  MANAGED_BROWSER_EXTEND_HANDOFF,
  MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS,
  MANAGED_BROWSER_GET_CACHE_STATUS,
  MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION,
  MANAGED_BROWSER_CLEAR_CACHE,
  MANAGED_BROWSER_UPDATE_SETTINGS,
  MANAGED_BROWSER_SUBMIT_LOGIN_CREDENTIAL,
  MANAGED_BROWSER_STATUS_EVENT,
  MANAGED_BROWSER_PROGRESS_EVENT,
  MANAGED_BROWSER_APPROVAL_EVENT,
  MANAGED_BROWSER_CHAT_NOTICE_EVENT,
  MANAGED_BROWSER_CACHE_PROGRESS_EVENT,
} from "@/config/channellist";
import {
  registerValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import { browserCredentialSubmitSchema } from "@/schemas/ipc/browserCredential";
import { getCredentialCardWaitRegistry } from "@/service/browserLogin/BrowserCredentialLoginService";
import {
  listEligibleAccountsInputSchema,
  managedBrowserStartInputSchema,
  managedBrowserStatusInputSchema,
  managedBrowserHandoffInputSchema,
  managedBrowserVerifyManualLoginInputSchema,
  managedBrowserResumeInputSchema,
  managedBrowserStopInputSchema,
  managedBrowserApproveInputSchema,
  managedBrowserCancelActiveInputSchema,
  managedBrowserCaptureScreenshotInputSchema,
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
 * Session channels are provider-aware (PRD D-FR-01, D-11): they deliberately
 * do NOT use `registerAiValidatedHandler`, whose hosted-only entitlement would
 * strand custom-provider users. Every browser action enforces the
 * provider-aware browser gate inside ManagedBrowserModule /
 * ManagedBrowserAiToolService (hosted entitlement OR a valid custom provider).
 * Settings and cache channels are management-only and use the same validated
 * wrapper.
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
  browserModule.setProgressSink((progress) =>
    sendToRenderer(win, MANAGED_BROWSER_PROGRESS_EVENT, progress)
  );
  browserModule.setApprovalSink((request) =>
    sendToRenderer(win, MANAGED_BROWSER_APPROVAL_EVENT, {
      sessionId: request.sessionId,
      requestId: request.requestId,
      programDigest: request.programDigest,
      pageRevision: request.pageRevision,
      riskClass: request.riskClass,
      messageKey: request.messageKey,
      contentSummary: request.contentSummary,
    })
  );

  // --- Browser session channels (provider-aware gate, PRD D-FR-01) ------
  // These channels deliberately do NOT use registerAiValidatedHandler:
  // that wrapper enforces the hosted-only entitlement. Browser tools work
  // for custom-provider users; the module and ManagedBrowserAiToolService
  // enforce the provider-aware browser gate on every action.
  // Eligible-account listing is a management READ (also used by the
  // settings page) — not AI execution — so it stays ungated; the actual
  // START channel above carries the AI gate.
  // PRD A-FR-05/06: the credential card request event carries ONLY the
  // main-process-derived site domain and a single-use request id; the
  // submit handler validates and forwards to the wait registry, which
  // resolves the in-job sign-in. Values never touch chat or logs.
  registerValidatedHandler(
    MANAGED_BROWSER_SUBMIT_LOGIN_CREDENTIAL,
    browserCredentialSubmitSchema,
    async (input) => {
      const entry = getCredentialCardWaitRegistry().consume({
        requestId: input.requestId,
        conversationId: callerConversationId(input),
      });
      if (!entry) {
        return { accepted: false };
      }
      entry.resolve({
        username: input.username,
        password: input.password,
        save: input.save,
        cancelled: input.cancelled,
      });
      return { accepted: true };
    }
  );

  registerValidatedHandler(
    MANAGED_BROWSER_LIST_ELIGIBLE_ACCOUNTS,
    listEligibleAccountsInputSchema,
    async () => browserModule.listEligibleAccounts()
  );

  registerValidatedHandler(
    MANAGED_BROWSER_LIST_ACTIVE,
    noInputSchema,
    async () => browserModule.listActiveSessions()
  );

  registerValidatedHandler(
    MANAGED_BROWSER_START,
    managedBrowserStartInputSchema,
    async (input) => browserModule.start(input, { aiEntryPoint: true })
  );

  registerValidatedHandler(
    MANAGED_BROWSER_STATUS,
    managedBrowserStatusInputSchema,
    async (input) => browserModule.getStatus(input.sessionId)
  );

  registerValidatedHandler(
    MANAGED_BROWSER_HANDOFF,
    managedBrowserHandoffInputSchema,
    // Renderer-initiated handoff is always user_requested; AI-driven handoff
    // reasons arrive as worker HANDOFF_REQUIRED events, never from IPC.
    async (input) => browserModule.requestHandoff(input.sessionId)
  );

  registerValidatedHandler(
    MANAGED_BROWSER_VERIFY_MANUAL_LOGIN,
    managedBrowserVerifyManualLoginInputSchema,
    async (input) => browserModule.verifyManualLogin(input.sessionId)
  );

  registerValidatedHandler(
    MANAGED_BROWSER_RESUME,
    managedBrowserResumeInputSchema,
    async (input) => browserModule.resumeAfterHandoff(input.sessionId)
  );

  registerValidatedHandler(
    MANAGED_BROWSER_STOP,
    managedBrowserStopInputSchema,
    async (input) =>
      browserModule.stop(
        input.sessionId,
        input.reason === "cancelled" ? "cancelled" : "user_stop"
      )
  );

  registerValidatedHandler(
    MANAGED_BROWSER_APPROVE,
    managedBrowserApproveInputSchema,
    async (input) => {
      browserModule.recordApproval({
        sessionId: input.sessionId,
        requestId: input.requestId,
        decision: input.decision,
        ...(input.programDigest
          ? { programDigest: input.programDigest }
          : {}),
        ...(input.pageRevision
          ? { pageRevision: input.pageRevision }
          : {}),
      });
      return { recorded: true as const };
    }
  );

  registerValidatedHandler(
    MANAGED_BROWSER_CAPTURE_SCREENSHOT,
    managedBrowserCaptureScreenshotInputSchema,
    async (input) =>
      browserModule.captureSessionScreenshot(input.session_id)
  );

  registerValidatedHandler(
    MANAGED_BROWSER_CANCEL_ACTIVE,
    managedBrowserCancelActiveInputSchema,
    async (input) => {
      await browserModule.cancelActiveRequest(input.session_id);
      return { cancelled: true as const };
    }
  );

  registerValidatedHandler(
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
