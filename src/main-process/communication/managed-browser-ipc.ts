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
  MANAGED_BROWSER_BATCH_CONFIRM_REQUEST,
  MANAGED_BROWSER_SUBMIT_BATCH_CONFIRM,
  MANAGED_BROWSER_PROBE_DECISION_CAPABILITIES,
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
  batchConfirmSubmitSchema,
} from "@/schemas/ipc/browserCredential";
import {
  getCredentialCardWaitRegistry,
  getAccountPickerWaitRegistry,
  getSiteConfirmWaitRegistry,
} from "@/service/browserLogin/BrowserCredentialLoginService";
import { getBatchConfirmWaitRegistry } from "@/service/agentTools/runBrowserTasksTool";
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
import { getDefaultManagedBrowserAiToolService } from "@/service/ManagedBrowserAiToolService";
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
  // C-FR-14: the CONTROL records follow the task-row sweep — any
  // non-terminal record is interrupted at startup (no automatic resume).
  getDefaultAgentTaskControlService().sweepNonTerminalToInterrupted();
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
      passwordOnly: request.passwordOnly,
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

  // M-FR-04/W08: the batch confirmation card — the batch preview streams
  // to the owning conversation BEFORE any session starts.
  getBatchConfirmWaitRegistry().setSink((request) =>
    sendToRenderer(win, MANAGED_BROWSER_BATCH_CONFIRM_REQUEST, {
      requestId: request.requestId,
      conversationId: request.conversationId,
      tasks: request.tasks,
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
      // W06/M-FR-08: the ROOT conversation the prompt is published on.
      conversationId: request.conversationId,
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
    taskId?: string;
    sessionId?: string;
  }): Promise<{ ok: boolean; reason?: string }> => {
    // C-FR-16: the session card sends sessionId only — resolve the
    // runner task that owns the session so the CONTROL layer pauses too
    // (not just the browser session). B02: the resolution ALSO consults
    // the session's authoritative agent-task ownership (a batch child's
    // control record id), never a global sweep.
    const resolvedTaskId =
      input.taskId ??
      (input.sessionId
        ? (getDefaultManagedBrowserAiToolService().runnerTaskIdForSession(
            input.sessionId
          ) ??
          getDefaultManagedBrowserModule().getSessionOwnerAgentTaskId(
            input.sessionId
          ) ??
          undefined)
        : undefined);
    if (resolvedTaskId === undefined) {
      // B02: session-only pause with NO resolvable task — the browser
      // session pause below still applies (user-control layer), but NO
      // control records are touched. The old orphan sweep interrupted
      // EVERY nonterminal task in the process, including unrelated jobs.
      // The pause result is honest about what was actually paused.
      let sessionPaused = true;
      if (input.sessionId) {
        try {
          await getDefaultManagedBrowserModule().pauseSession(input.sessionId);
        } catch {
          sessionPaused = false;
        }
      }
      return {
        ok: sessionPaused,
        ...(sessionPaused
          ? {}
          : { reason: "session_pause_failed" }),
      };
    }
    // N01/C-FR-01: the browser pause runs FIRST — the control record
    // moves to paused only when the worker accepted the pause, so the
    // two layers can never disagree (a worker refusal leaves the gate
    // open and the browser unpaused).
    let sessionPaused = true;
    if (input.sessionId) {
      // T24/C-FR-05: PAUSE_REQUEST stops the in-flight program between
      // actions (executed results preserved), then the session moves to
      // user control. B02: a rejected worker pause is SURFACED (ok:
      // false), never swallowed into ok:true.
      try {
        await getDefaultManagedBrowserModule().pauseSession(input.sessionId);
      } catch {
        sessionPaused = false;
      }
    }
    if (!sessionPaused) {
      return { ok: false, reason: "session_pause_failed" };
    }
    // N01: an unknown task id is an honest failure — a silent no-op would
    // report ok while nothing was paused.
    if (!controlService.get(resolvedTaskId)) {
      return { ok: false, reason: "task_not_found" };
    }
    controlService.setState(resolvedTaskId, "paused", "user_paused");
    // F06: the 60-minute pause cap only covers pauses with an open
    // intervention record — explicit pause opens one.
    controlService.beginIntervention(resolvedTaskId, "user_paused");
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
      // B02: Resume VERIFIES the task/session pair — a task id that does
      // not own the session is refused (never resumed cross-task).
      if (input.taskId && input.sessionId) {
        const owner =
          getDefaultManagedBrowserAiToolService().runnerTaskIdForSession(
            input.sessionId
          ) ??
          getDefaultManagedBrowserModule().getSessionOwnerAgentTaskId(
            input.sessionId
          );
        if (owner !== null && owner !== input.taskId) {
          return { ok: false, reason: "task_session_mismatch" };
        }
      }
      // C-FR-07: resume advances the page revision (old refs invalid) and
      // leaves user control; the agent must observe before acting.
      let resumed = true;
      if (input.sessionId) {
        try {
          await getDefaultManagedBrowserModule().resumeAfterHandoff(
            input.sessionId
          );
        } catch {
          resumed = false;
        }
      }
      // F06: closing the intervention keeps the cap record truthful.
      // B02: resume resolves the task the SAME way pause does — a
      // session-only resume targets the session's authoritative owner;
      // without any resolvable task the resume fails honestly.
      const resolvedResumeTaskId =
        input.taskId ??
        (input.sessionId
          ? (getDefaultManagedBrowserAiToolService().runnerTaskIdForSession(
              input.sessionId
            ) ??
            getDefaultManagedBrowserModule().getSessionOwnerAgentTaskId(
              input.sessionId
            ) ??
            undefined)
          : undefined);
      if (resolvedResumeTaskId === undefined) {
        return {
          ok: resumed,
          ...(resumed ? {} : { reason: "session_resume_failed" }),
        };
      }
      // R01/C-FR-08: the task stays PAUSED when the browser cannot resume
      // — the control gate must not reopen onto a dead worker.
      if (!resumed) {
        return { ok: false, reason: "session_resume_failed" };
      }
      // N01: an unknown or terminal task id cannot resume — the boolean
      // result of the transition is surfaced, never ignored.
      controlService.endIntervention(resolvedResumeTaskId);
      // B13/C-FR-07: the user's instructions are stored on the control
      // record BEFORE the gate reopens — the resumed loop consumes them
      // ONCE (folded into its next decision input).
      if (input.instructions) {
        controlService.recordResumeInstructions(
          resolvedResumeTaskId,
          input.instructions
        );
      }
      // N01: the transition result is surfaced, never ignored — an
      // unknown or terminal task id cannot resume.
      const resumeOutcome = controlService.resume(resolvedResumeTaskId);
      if (!resumeOutcome) {
        return { ok: false, reason: "task_not_resumable" };
      }
      return { ok: true, instructions: input.instructions ?? null };
    }
  );
  registerValidatedHandler(
    BROWSER_TASK_STOP,
    browserTaskStopSchema,
    async (input) => {
      // N01/D-FR-08: a paired task/session Stop validates the pair (same
      // check as Resume) — a task that does not own the session is
      // refused instead of silently stopping a foreign session.
      if (input.taskId && input.sessionId) {
        const owner =
          getDefaultManagedBrowserAiToolService().runnerTaskIdForSession(
            input.sessionId
          ) ??
          getDefaultManagedBrowserModule().getSessionOwnerAgentTaskId(
            input.sessionId
          );
        if (owner !== null && owner !== input.taskId) {
          return { ok: false, reason: "task_session_mismatch" };
        }
      }
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
      // N01/C-FR-16: the worker stop failure is SURFACED — a swallowed
      // error would report ok while the browser is still running.
      let sessionStopped = true;
      if (input.sessionId) {
        try {
          await getDefaultManagedBrowserModule().stop(
            input.sessionId,
            "user_stop"
          );
        } catch {
          sessionStopped = false;
        }
      }
      return {
        ok: sessionStopped,
        ...(sessionStopped ? {} : { reason: "session_stop_failed" }),
      };
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
    async (input) => {
      // R01/C-FR-10: the user EXPLICITLY requested focus ("Open browser"
      // on the session card) — the worker's sanctioned bringToFront path.
      // Launches never steal focus; only this button does.
      try {
        await getDefaultManagedBrowserModule().focusWindow(input.sessionId);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "focus_failed",
        };
      }
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
    MANAGED_BROWSER_SUBMIT_BATCH_CONFIRM,
    batchConfirmSubmitSchema,
    async (input) => {
      const entry = getBatchConfirmWaitRegistry().consume({
        requestId: input.requestId,
        conversationId: input.conversationId,
      });
      if (!entry) {
        return { accepted: false };
      }
      entry.resolve({
        confirmed: input.confirmed && !input.cancelled,
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

  // R01/D-FR-18: the decision-capability probe — THREE separate probes
  // (chat round-trip / verified JSON Schema / forced tool) reported
  // independently; the probed flags persist on decisionRoute so the chat
  // decision client negotiates only supported output modes.
  registerValidatedHandler(
    MANAGED_BROWSER_PROBE_DECISION_CAPABILITIES,
    managedBrowserGetEffectiveSettingsInputSchema,
    async () => {
      // B04/PRD §7: the probe is gated like every AI entry point — a
      // disabled route is a structured all-false result, never a doomed
      // provider call, and nothing is persisted.
      const { BrowserAiAvailabilityService } = await import(
        "@/service/browserDecision/BrowserAiAvailabilityService"
      );
      const availability = new BrowserAiAvailabilityService().evaluate();
      if (!availability.available) {
        return {
          chat: false,
          structuredJsonSchema: false,
          forcedToolDecision: false,
          structuredError: availability.reasonCode ?? "ai_disabled",
          forcedToolError: availability.reasonCode ?? "ai_disabled",
        };
      }
      const { probeChatDecisionCapabilities } = await import(
        "@/service/browserDecision/ChatCapabilityProbe"
      );
      const { AiChatApi } = await import("@/api/aiChatApi");
      const api = new AiChatApi();
      // N04: the revision is captured BEFORE probing — the probes run
      // under THIS epoch, and the capabilities-only save (below) does not
      // bump it, so the stored revision matches the probed route. The
      // configured decision-model override is honored in the probes.
      const { providerConfigKey } = await import(
        "@/service/aiProvider/AIProviderConfigVersion"
      );
      const probedRevision = providerConfigKey();
      const effectiveBeforeProbe = await new ManagedBrowserSettingsModule()
        .getEffectiveSettings();
      const probedModel = effectiveBeforeProbe.decisionRoute.chatDecisionModel ?? undefined;
      let result;
      try {
        result = await probeChatDecisionCapabilities(
          async (request, signal) => {
            return (await api.openAIChatCompletion(
              {
                messages: request.messages as never,
                model: probedModel,
                response_format: request.response_format as never,
                ...(request.tools ? { tools: request.tools as never } : {}),
                ...(request.tool_choice
                  ? { tool_choice: request.tool_choice as never }
                  : {}),
                stream: false,
                temperature: request.temperature,
              },
              { signal }
            )) as never;
          },
          probedModel
        );
      } catch {
        // B04: a throwing transport is an all-false honest verdict —
        // nothing is persisted.
        result = {
          chat: false,
          structuredJsonSchema: false,
          forcedToolDecision: false,
          structuredError: "probe_transport_failed",
          forcedToolError: "probe_transport_failed",
        };
      }
      // Persist the probed flags scoped to the probed revision (B04/D-AC-08):
      // flags from another revision never apply. A12: the epoch is
      // REVALIDATED BEFORE the save — a concurrent route change during the
      // probes discards the results entirely (nothing persisted, all
      // negatives returned); a late old probe can never overwrite a newer
      // result.
      if (providerConfigKey() !== probedRevision) {
        return {
          chat: false,
          structuredJsonSchema: false,
          forcedToolDecision: false,
          structuredError: "probe_invalidated_by_concurrent_change",
          forcedToolError: "probe_invalidated_by_concurrent_change",
        };
      }
      const effective = effectiveBeforeProbe;
      await new ManagedBrowserSettingsModule().updatePreferences({
        decisionRoute: {
          chatCapabilities: {
            structuredJsonSchema: result.structuredJsonSchema,
            forcedToolDecision: result.forcedToolDecision,
            providerRevision: probedRevision,
          },
        },
      });
      // R10/D-AC-08: POST-SAVE recheck — the settings write is an
      // awaited read/merge; a concurrent settings save (route/model
      // change) that landed after the precheck must not silently keep
      // stale probe flags. The persisted revision is read back and the
      // probe reports invalidated when it no longer owns the slot.
      const persisted = await new ManagedBrowserSettingsModule()
        .getEffectiveSettings();
      if (
        persisted.decisionRoute.chatCapabilities?.providerRevision !==
        probedRevision
      ) {
        return {
          chat: false,
          structuredJsonSchema: false,
          forcedToolDecision: false,
          structuredError: "probe_invalidated_by_concurrent_change",
          forcedToolError: "probe_invalidated_by_concurrent_change",
        };
      }
      return {
        ...result,
        providerRevision: probedRevision,
        ...(effective.decisionRoute.chatDecisionModel
          ? { probedModel: effective.decisionRoute.chatDecisionModel }
          : {}),
      };
    }
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
