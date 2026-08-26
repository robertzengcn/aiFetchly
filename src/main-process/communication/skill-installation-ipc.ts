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
  SKILL_INSTALL_APPROVE,
  SKILL_INSTALL_CANCEL,
  SKILL_INSTALL_DISABLE,
  SKILL_INSTALL_ENABLE,
  SKILL_INSTALL_PREPARE,
  SKILL_INSTALL_REPAIR,
  SKILL_INSTALL_STATUS,
  SKILL_INSTALL_SUBMIT_SECRET,
  SKILL_INSTALL_UNINSTALL,
  SKILL_INSTALL_UPDATE,
} from "@/config/channellist";
import {
  SkillInstallationModule,
  isSkillInstallerEnabled,
} from "@/modules/SkillInstallationModule";
import { SkillCredentialService } from "@/service/SkillCredentialService";
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
  constraints: z.array(z.string().max(2_000)).max(20).optional(),
});

const approveSchema = z.object({
  sessionId: z.string().min(1),
  planRevision: z.string().min(1),
  approve: z.boolean(),
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
  sessionId: z.string().min(1),
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
      const snapshot = await module.approve(decoded.value);
      return ok(snapshot);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "Approve failed.");
    }
  });

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
      const store = new SkillCredentialService();
      const stored = store.store(
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
