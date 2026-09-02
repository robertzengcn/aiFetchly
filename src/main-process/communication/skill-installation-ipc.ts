/**
 * Skill installation IPC handlers (design §15.1, PRD §21.3).
 *
 * Thin validated handlers over SkillInstallationModule:
 *   - PREPARE / APPROVE serve the AI-driven install flow → USER_AI_ENABLED is
 *     checked BEFORE parsing request data or doing work (NFR-07).
 *   - STATUS / CANCEL are plain lifecycle queries (no AI gate).
 *   - SUBMIT_SECRET is a dedicated secure channel: the value goes straight
 *     into the fail-closed credential store keyed by installation identity;
 *     it is never logged, echoed, or persisted anywhere else (NFR-03), and
 *     the session resumes only after the store confirms.
 */

import { ipcMain } from "electron";
import { z } from "zod";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  PROMPT_SKILL_INVOKE,
  SKILL_INSTALL_APPROVAL_TOKEN,
  SKILL_INSTALL_APPROVE,
  SKILL_INSTALL_CANCEL,
  SKILL_INSTALL_DISABLE,
  SKILL_INSTALL_ENABLE,
  SKILL_INSTALL_PREPARE,
  SKILL_INSTALL_REPAIR,
  SKILL_INSTALL_RUN_COMMAND,
  SKILL_INSTALL_STATUS,
  SKILL_INSTALL_SUBMIT_SECRET,
  SKILL_INSTALL_UNINSTALL,
  SKILL_INSTALL_UPDATE,
} from "@/config/channellist";
import {
  SkillInstallationModule,
  isSkillInstallerEnabled,
} from "@/modules/SkillInstallationModule";
import {
  SkillSessionIdSchema,
  rejectSecretShaped,
} from "@/entityTypes/skillInstallationTypes";
import type { CommonMessage } from "@/entityTypes/commonType";

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}
function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

function isAiEnabled(): boolean {
  return new Token().getValue(USER_AI_ENABLED) === "true";
}

const prepareSchema = z.object({
  conversationId: z.string().min(1),
  source: z.string().min(1),
  ref: z.string().max(200).optional(),
  subdirectory: z.string().max(500).optional(),
  mode: z.enum(["managed-copy", "linked"]).optional(),
  // FR-31 parity with the model tool schema: constraints run the deep
  // secret-shape validator — a pasted API key is a schema error here too
  // (found by the E2E matrix).
  constraints: z
    .array(z.string().max(2_000))
    .max(20)
    .superRefine((entries, ctx) => {
      for (const problem of rejectSecretShaped(entries, ["constraints"])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }
    })
    .optional(),
});

const approveSchema = z.object({
  sessionId: SkillSessionIdSchema,
  planRevision: z.string().min(1),
  approve: z.boolean(),
  /** Opaque token from the renderer approval card (review D1). */
  approvalToken: z.string().min(16).max(128),
  selectedSkillIds: z.array(z.string().max(200)).max(100).optional(),
});

const sessionSchema = z.object({ sessionId: z.string().min(1) });

/**
 * SUBMIT_SECRET: validated separately from the chat/tool schemas. The value
 * is accepted only alongside the session it belongs to; the handler stores
 * it under the installation identity and returns only a configured/not
 * status — the secret itself is never echoed back.
 */
const submitSecretSchema = z.object({
  sessionId: SkillSessionIdSchema,
  environmentVariable: z.string().min(3).max(100),
  value: z.string().min(1).max(8_192),
});

function decode<T>(
  schema: z.ZodType<T>,
  data: unknown
): { ok: true; value: T } | { ok: false; message: string } {
  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return { ok: false, message: "Invalid request payload" };
    }
  }
  const result = schema.safeParse(payload);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: "Invalid request payload" };
}

export function registerSkillInstallationIpcHandlers(): void {
  ipcMain.handle(SKILL_INSTALL_PREPARE, async (_event, data: unknown) => {
    if (!isAiEnabled()) return denied("AI functionality is only available to subscribers.");
    if (!isSkillInstallerEnabled()) return denied("The skill installer is disabled.");
    const decoded = decode(prepareSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const module = new SkillInstallationModule();
      const snapshot = await module.prepare({
        conversationId: decoded.value.conversationId,
        source: decoded.value.source,
        ...(decoded.value.ref !== undefined ? { ref: decoded.value.ref } : {}),
        ...(decoded.value.subdirectory !== undefined
          ? { subdirectory: decoded.value.subdirectory }
          : {}),
        ...(decoded.value.mode !== undefined ? { mode: decoded.value.mode } : {}),
        ...(decoded.value.constraints !== undefined
          ? { constraints: decoded.value.constraints }
          : {}),
      });
      return ok(snapshot);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Prepare failed.");
    }
  });

  ipcMain.handle(SKILL_INSTALL_APPROVE, async (_event, data: unknown) => {
    if (!isAiEnabled()) return denied("AI functionality is only available to subscribers.");
    const decoded = decode(approveSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const module = new SkillInstallationModule();
      const snapshot = await module.approve({
        sessionId: decoded.value.sessionId,
        planRevision: decoded.value.planRevision,
        approve: decoded.value.approve,
        approvalToken: decoded.value.approvalToken,
        ...(decoded.value.selectedSkillIds !== undefined
          ? { selectedSkillIds: decoded.value.selectedSkillIds }
          : {}),
      });
      return ok(snapshot);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Approve failed.");
    }
  });

  // Renderer-only approval-token channel (review D1): the token binds
  // approval to the install card. On the preload bridge but NOT a
  // model-facing tool, so no tool result ever carries it.
  ipcMain.handle(
    SKILL_INSTALL_APPROVAL_TOKEN,
    async (_event, data: unknown) => {
      const decoded = decode(sessionSchema, data);
      if (!decoded.ok) return denied(decoded.message);
      try {
        const token = await new SkillInstallationModule().getApprovalToken(
          decoded.value.sessionId
        );
        if (token === null) return denied("Unknown installation session.");
        return ok({ approvalToken: token });
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "Token lookup failed."
        );
      }
    }
  );

  ipcMain.handle(SKILL_INSTALL_STATUS, async (_event, data: unknown) => {
    const decoded = decode(sessionSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const module = new SkillInstallationModule();
      return ok(await module.getStatus(decoded.value.sessionId));
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Status failed.");
    }
  });

  ipcMain.handle(SKILL_INSTALL_CANCEL, async (_event, data: unknown) => {
    const decoded = decode(sessionSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const module = new SkillInstallationModule();
      return ok(await module.cancel(decoded.value.sessionId));
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Cancel failed.");
    }
  });

  ipcMain.handle(SKILL_INSTALL_SUBMIT_SECRET, async (_event, data: unknown) => {
    const decoded = decode(submitSecretSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const module = new SkillInstallationModule();
      const status = await module.getStatus(decoded.value.sessionId);
      if (status.state !== "awaiting_secret") {
        return denied("This session is not waiting for a credential.");
      }
      const installationId = status.installationId;
      if (!installationId) {
        return denied("The installation identity is not resolved yet.");
      }
      // SkillCredentialModule (TODO 9): fail-closed store + opaque binding
      // row in SQLite, per design §14.1/§20.3.
      const { SkillCredentialModule } = await import(
        "@/modules/SkillCredentialModule"
      );
      const credentialModule = new SkillCredentialModule();
      const stored = await credentialModule.store(
        installationId,
        decoded.value.environmentVariable,
        decoded.value.value
      );
      if (!stored.ok) return denied(stored.message);
      // Resume the state machine; the value never enters it.
      const snapshot = await module.resumeAfterSecret(decoded.value.sessionId);
      return ok({
        configured: true,
        environmentVariable: decoded.value.environmentVariable,
        snapshot,
      });
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Storing the credential failed.");
    }
  });
}

const installationSchema = z.object({ installationId: z.string().min(1) });
const uninstallSchema = z.object({
  installationId: z.string().min(1),
  deleteSecrets: z.boolean().optional(),
});

export function registerSkillInstallationLifecycleIpcHandlers(): void {
  ipcMain.handle(SKILL_INSTALL_UPDATE, async (_event, data: unknown) => {
    if (!isAiEnabled()) return denied("AI functionality is only available to subscribers.");
    const decoded = decode(installationSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const snapshot = await new SkillInstallationModule().update(
        decoded.value.installationId
      );
      return ok(snapshot);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Update failed.");
    }
  });

  ipcMain.handle(SKILL_INSTALL_REPAIR, async (_event, data: unknown) => {
    const decoded = decode(installationSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const report = await new SkillInstallationModule().repair(
        decoded.value.installationId
      );
      return ok(report);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Repair failed.");
    }
  });

  ipcMain.handle(SKILL_INSTALL_DISABLE, async (_event, data: unknown) => {
    const decoded = decode(installationSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      return ok(
        await new SkillInstallationModule().disable(decoded.value.installationId)
      );
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Disable failed.");
    }
  });

  ipcMain.handle(SKILL_INSTALL_ENABLE, async (_event, data: unknown) => {
    const decoded = decode(installationSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      return ok(
        await new SkillInstallationModule().enable(decoded.value.installationId)
      );
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Enable failed.");
    }
  });

  ipcMain.handle(SKILL_INSTALL_UNINSTALL, async (_event, data: unknown) => {
    const decoded = decode(uninstallSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const result = await new SkillInstallationModule().uninstall({
        installationId: decoded.value.installationId,
        ...(decoded.value.deleteSecrets !== undefined
          ? { deleteSecrets: decoded.value.deleteSecrets }
          : {}),
      });
      if (!result.ok) return denied(result.message);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Uninstall failed.");
    }
  });
}

const invokeSkillSchema = z.object({
  conversationId: z.string().min(1),
  skill: z.string().min(1),
  arguments: z.string().max(4_000).optional(),
});

/**
 * Explicit /skill invocation (PRD §9.5): resolves through the SAME
 * PromptSkillInvocationService as use_skill with invocationSource
 * "explicit". The hidden instruction block attaches via the assembler's
 * invoked-skill reattachment on the following turn.
 */
export function registerPromptSkillInvokeIpcHandler(): void {
  ipcMain.handle(PROMPT_SKILL_INVOKE, async (_event, data: unknown) => {
    const decoded = decode(invokeSkillSchema, data);
    if (!decoded.ok) return denied(decoded.message);
    try {
      const { getDefaultPromptSkillInvocationService } = await import(
        "@/service/PromptSkillInvocationService"
      );
      const { getDefaultFilesystemContextService } = await import(
        "@/service/ConversationFilesystemContextService"
      );
      const scope = await getDefaultFilesystemContextService()
        .resolve(decoded.value.conversationId)
        .then((r) => (r.ok ? r.context : null))
        .catch(() => null);
      const outcome =
        await getDefaultPromptSkillInvocationService().invoke(
          {
            skill: decoded.value.skill,
            ...(decoded.value.arguments !== undefined
              ? { arguments: decoded.value.arguments }
              : {}),
          },
          {
            conversationId: decoded.value.conversationId,
            conversationWorkspaceRoot: scope?.canonicalWorkspaceRoot ?? "",
            ...(scope?.workspaceId !== undefined && scope.workspaceId >= 0
              ? { workspaceId: scope.workspaceId }
              : {}),
            invocationSource: "explicit",
          }
        );
      if (!outcome.ok) {
        return denied(outcome.result.message);
      }
      // Never return the instruction body — only the short ack.
      return ok({ ...outcome.result });
    } catch (err) {
      return denied(
        err instanceof Error ? err.message : "Skill invocation failed."
      );
    }
  });
}

const runCommandSchema = z.object({
  sessionId: SkillSessionIdSchema,
  commandId: z.string().min(1).max(100),
  /** Same opaque token the approval card used (review D3: run execution is
   *  authorized at the same strength as approve, not by a bare boolean). */
  approvalToken: z.string().min(16).max(128),
});

// TODO 5 / FR-16: renderer-only execution of one APPROVED plan command.
// The model never supplies the command — only the persisted template id.
export function registerSkillInstallRunCommandIpcHandler(): void {
  ipcMain.handle(
    SKILL_INSTALL_RUN_COMMAND,
    async (_event, data: unknown) => {
      const decoded = decode(runCommandSchema, data);
      if (!decoded.ok) return denied(decoded.message);
      try {
        const module = new SkillInstallationModule();
        // Token binding (review D3): identical to the approve gate.
        const token = await module.getApprovalToken(decoded.value.sessionId);
        if (token === null || token !== decoded.value.approvalToken) {
          return denied("Invalid approval token for this session.");
        }
        const outcome = await module.runApprovedCommand(
          decoded.value.sessionId,
          decoded.value.commandId
        );
        if (!outcome.ok) return denied(outcome.message);
        return ok(outcome.result);
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "Command execution failed."
        );
      }
    }
  );
}
