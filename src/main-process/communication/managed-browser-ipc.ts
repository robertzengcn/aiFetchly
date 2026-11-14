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
  MANAGED_BROWSER_CREDENTIAL_REQUEST,
  MANAGED_BROWSER_ACCOUNT_PICKER_REQUEST,
  MANAGED_BROWSER_SUBMIT_ACCOUNT_PICKER,
  MANAGED_BROWSER_SITE_CONFIRM_REQUEST,
  MANAGED_BROWSER_SUBMIT_SITE_CONFIRM,
  BROWSER_TASK_PAUSE,
  BROWSER_TASK_TAKE_CONTROL,
  BROWSER_TASK_RESUME,
  BROWSER_TASK_STOP,
  BROWSER_BATCH_RETURN_NOW,
  BROWSER_TASK_FOCUS_WINDOW,
  MANAGED_BROWSER_STATUS_EVENT,
  MANAGED_BROWSER_PROGRESS_EVENT,
  MANAGED_BROWSER_APPROVAL_EVENT,
  MANAGED_BROWSER_CHAT_NOTICE_EVENT,
  MANAGED_BROWSER_BATCH_EVENT,
  MANAGED_BROWSER_CACHE_PROGRESS_EVENT,
} from "@/config/channellist";
import {
  registerValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  browserCredentialSubmitSchema,
  accountPickerSubmitSchema,
  siteConfirmSubmitSchema,
} from "@/schemas/ipc/browserCredential";
import {
  getCredentialCardWaitRegistry,
  getAccountPickerWaitRegistry,
  getSiteConfirmWaitRegistry,
} from "@/service/browserLogin/BrowserCredentialLoginService";
import { getDefaultAgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";
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
import {
  browserTaskPauseSchema,
  browserTaskResumeSchema,
  browserTaskStopSchema,
  browserBatchReturnNowSchema,
  browserTaskFocusWindowSchema,
} from "@/schemas/ipc/browserTaskControl";
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
  // T19/C-FR-14: on startup, every non-terminal browser task from a prior
  // run is marked interrupted — no automatic resume, no mutation replay.
  void (async () => {
    try {
      const { getDefaultBrowserTaskModule } = await import(
        "@/modules/BrowserTaskModule"
      );
      await getDefaultBrowserTaskModule().markUnfinishedInterrupted();
    } catch {
      // startup sweep is best-effort
    }
  })();
  // PRD A-FR-05: credential-card requests reach the parent conversation as
  // an event; the card submits through the single-use validated channel.
  getCredentialCardWaitRegistry().setSink((request) =>
    sendToRenderer(win, MANAGED_BROWSER_CREDENTIAL_REQUEST, {
      requestId: request.requestId,
      // B01: the card must submit the owner conversation or the submit
      // schema (min(1)) rejects it before `consume` — the wait never
      // resolves and the job dies at the card TTL.
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      createdAt: request.createdAt,
      siteDomain: request.siteDomain,
      mode: request.mode,
      prefillUsername: request.prefillUsername,
    })
  );

  // B02/A-FR-03: account-picker requests stream to the owning conversation
  // the same way; the submit resolves the in-job picker wait.
  getAccountPickerWaitRegistry().setSink((request) =>
    sendToRenderer(win, MANAGED_BROWSER_ACCOUNT_PICKER_REQUEST, {
      requestId: request.requestId,
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      siteDomain: request.siteDomain,
      candidates: request.candidates,
      createdAt: request.createdAt,
    })
  );

  // B03/S-FR-04: extra-domain confirmation proposals stream to the owning
  // conversation; the apply resolves the wait and is token-gated in the
  // BrowserSiteModule (the token itself never crosses IPC).
  getSiteConfirmWaitRegistry().setSink((request) =>
    sendToRenderer(win, MANAGED_BROWSER_SITE_CONFIRM_REQUEST, {
      requestId: request.requestId,
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      siteId: request.siteId,
      registrableDomain: request.registrableDomain,
      proposedDomains: request.proposedDomains,
      createdAt: request.createdAt,
    })
  );

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
  // F21: live browser-batch events stream to the batch control card.
  void import("@/service/agentTools/runBrowserTasksTool").then(
    ({ setBrowserBatchEventSink }) => {
      setBrowserBatchEventSink((event) =>
        sendToRenderer(win, MANAGED_BROWSER_BATCH_EVENT, event)
      );
    }
  );
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
  // PRD C-FR-04: user-initiated task control. Every takeover sets BOTH
  // layers: the browser moves to user control (AI commands rejected) and
  // the agent loop stops at its next safe point via the control gate.
  const controlService = getDefaultAgentTaskControlService();
  const pauseOrTakeControl = async (input: {
    taskId: string;
    sessionId?: string;
  }): Promise<{ ok: boolean }> => {
    controlService.setState(input.taskId, "paused", "user_paused");
    // F06: the 60-minute pause cap only covers pauses with an open
    // intervention record — explicit pause opens one.
    controlService.beginIntervention(input.taskId, "user_paused");
    if (input.sessionId) {
      // T24/C-FR-05: PAUSE_REQUEST stops the in-flight program between
      // actions (executed results preserved), then the session moves to
      // user control.
      await getDefaultManagedBrowserModule()
        .pauseSession(input.sessionId)
        .catch(() => undefined);
    }
    return { ok: true };
  };
  registerValidatedHandler(
    BROWSER_TASK_PAUSE,
    browserTaskPauseSchema,
    pauseOrTakeControl
  );
  registerValidatedHandler(
    BROWSER_TASK_TAKE_CONTROL,
    browserTaskPauseSchema,
    pauseOrTakeControl
  );
  registerValidatedHandler(
    BROWSER_TASK_RESUME,
    browserTaskResumeSchema,
    async (input) => {
      // C-FR-07: resume advances the page revision (old refs invalid) and
      // leaves user control; the agent must observe before acting.
      if (input.sessionId) {
        await getDefaultManagedBrowserModule()
          .resumeAfterHandoff(input.sessionId)
          .catch(() => undefined);
      }
      // F06: closing the intervention keeps the cap record truthful.
      controlService.endIntervention(input.taskId);
      controlService.resume(input.taskId);
      return { ok: true, instructions: input.instructions ?? null };
    }
  );
  registerValidatedHandler(
    BROWSER_TASK_STOP,
    browserTaskStopSchema,
    async (input) => {
      controlService.cancel(input.taskId, "user_stop");
      // F17: stopping ONE batch child (`<batch>:<i>`) aborts only that
      // child — its siblings keep running. Whole-batch termination is
      // BROWSER_BATCH_RETURN_NOW's job.
      if (input.taskId.includes(":")) {
        const { abortTask } = await import(
          "@/service/agentTools/runBrowserTasksTool"
        );
        abortTask(input.taskId);
      }
      if (input.sessionId) {
        await getDefaultManagedBrowserModule()
          .stop(input.sessionId, "user_stop")
          .catch(() => undefined);
      }
      return { ok: true };
    }
  );
  registerValidatedHandler(
    BROWSER_BATCH_RETURN_NOW,
    browserBatchReturnNowSchema,
    async (input) => {
      // C-FR-11: finish unfinished tasks as partial — cancel every task
      // of the batch (control records + live child abort trees); the
      // batch collector returns what it has.
      controlService.cancelBatch(input.batchId);
      const { abortBatch } = await import(
        "@/service/agentTools/runBrowserTasksTool"
      );
      abortBatch(input.batchId);
      return { ok: true };
    }
  );
  registerValidatedHandler(
    BROWSER_TASK_FOCUS_WINDOW,
    browserTaskFocusWindowSchema,
    async () => {
      // C-FR-10: never steals focus automatically; the button requests it.
      // Chrome window focus is a follow-up worker capability.
      return { ok: false, reason: "focus_not_supported_yet" };
    }
  );

  registerValidatedHandler(
    MANAGED_BROWSER_SUBMIT_LOGIN_CREDENTIAL,
    browserCredentialSubmitSchema,
    async (input) => {
      const entry = getCredentialCardWaitRegistry().consume({
        requestId: input.requestId,
        conversationId: input.conversationId,
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
    MANAGED_BROWSER_SUBMIT_ACCOUNT_PICKER,
    accountPickerSubmitSchema,
    async (input) => {
      const entry = getAccountPickerWaitRegistry().consume({
        requestId: input.requestId,
        conversationId: input.conversationId,
      });
      if (!entry) {
        return { accepted: false };
      }
      entry.resolve({
        accountId: input.accountId,
        cancelled: input.cancelled,
      });
      return { accepted: true };
    }
  );

  registerValidatedHandler(
    MANAGED_BROWSER_SUBMIT_SITE_CONFIRM,
    siteConfirmSubmitSchema,
    async (input) => {
      const entry = getSiteConfirmWaitRegistry().consume({
        requestId: input.requestId,
        conversationId: input.conversationId,
      });
      if (!entry) {
        return { accepted: false };
      }
      entry.resolve({
        applied: !input.cancelled,
        domains: input.cancelled ? [] : input.domains,
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
