import {
  windowInvoke,
  windowReceive,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import {
  PROMPT_SKILL_INVOKE,
  SKILL_INSTALL_PROGRESS,
  SKILL_INSTALL_APPROVAL_TOKEN,
  SKILL_INSTALL_APPROVE,
  SKILL_INSTALL_CANCEL,
  SKILL_INSTALL_PREPARE,
  SKILL_INSTALL_STATUS,
  SKILL_INSTALL_SUBMIT_SECRET,
} from "@/config/channellist";
import type {
  InstallSnapshot,
  SkillInstallPrepareArgs,
} from "@/entityTypes/skillInstallationTypes";

/**
 * Renderer API for the typed skill installer
 * (natural-language-skill-installation design §15.1).
 *
 * The renderer never receives or sends secret values except through the
 * dedicated SUBMIT_SECRET channel, and only for a session that is actively
 * awaiting one.
 */

export interface PrepareSkillInstallRequest {
  readonly conversationId: string;
  readonly source: string;
  readonly ref?: string;
  readonly subdirectory?: string;
  readonly mode?: "managed-copy" | "linked";
  readonly constraints?: readonly string[];
}

export async function prepareSkillInstall(
  req: PrepareSkillInstallRequest
): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_PREPARE, req);
  return (resp as InstallSnapshot | null) ?? null;
}

export async function approveSkillInstall(input: {
  sessionId: string;
  planRevision: string;
  approve: boolean;
  /** Opaque token from the renderer approval card (review D1). */
  approvalToken: string;
  selectedSkillIds?: readonly string[];
}): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_APPROVE, input);
  return (resp as InstallSnapshot | null) ?? null;
}

/**
 * Fetch the opaque approval token for the renderer approval card only
 * (review D1). Deliberately NOT a model-facing tool — the main-process
 * approve() gate rejects any approve without this token, so a
 * prompt-injected model cannot self-approve an installation.
 */
export async function getSkillInstallApprovalToken(
  sessionId: string
): Promise<string | null> {
  const resp = await windowInvoke(SKILL_INSTALL_APPROVAL_TOKEN, {
    sessionId,
  });
  const data = resp as { approvalToken?: string } | null;
  return data?.approvalToken ?? null;
}

export async function getSkillInstallStatus(
  sessionId: string
): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_STATUS, { sessionId });
  return (resp as InstallSnapshot | null) ?? null;
}

export async function cancelSkillInstall(
  sessionId: string
): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_CANCEL, { sessionId });
  return (resp as InstallSnapshot | null) ?? null;
}

export interface SubmitSecretResult {
  readonly configured: boolean;
  readonly environmentVariable: string;
  readonly snapshot: InstallSnapshot;
}

export async function submitSkillInstallSecret(input: {
  sessionId: string;
  environmentVariable: string;
  value: string;
}): Promise<SubmitSecretResult | null> {
  const resp = await windowInvoke(SKILL_INSTALL_SUBMIT_SECRET, input);
  return (resp as SubmitSecretResult | null) ?? null;
}

export type { SkillInstallPrepareArgs };

export interface InvokePromptSkillAck {
  readonly status: "loaded" | "already-loaded";
  readonly runtimeId: string;
  readonly name: string;
  readonly contentHash: string;
  readonly contextRevision: number;
}

/**
 * Explicit `/skill <name>` invocation (PRD §9.5) — the same invocation
 * service use_skill uses, with invocationSource "explicit". Returns only
 * the short acknowledgement; the instructions attach as hidden context.
 */
export async function invokePromptSkill(input: {
  conversationId: string;
  skill: string;
  arguments?: string;
}): Promise<InvokePromptSkillAck | null> {
  const resp = await windowInvoke(PROMPT_SKILL_INVOKE, input);
  return (resp as InvokePromptSkillAck | null) ?? null;
}

/** Monotonic per-session progress event (TODO 7, design §23.2). */
export interface SkillInstallProgressEvent {
  readonly sessionId: string;
  readonly seq: number;
  readonly state: string;
  readonly step: string;
  readonly messageKey: string;
  readonly recoverable: boolean;
  readonly errorCode?: string;
}

/**
 * Subscribe to live installation progress broadcasts. Returns an
 * unsubscribe function. Events are monotonic per session (seq).
 */
export function onSkillInstallProgress(
  callback: (event: SkillInstallProgressEvent) => void
): () => void {
  windowReceive(SKILL_INSTALL_PROGRESS, (data) => {
    const event = data as SkillInstallProgressEvent;
    if (event && typeof event.sessionId === "string") {
      callback(event);
    }
  });
  return () => {
    windowRemoveAllListeners(SKILL_INSTALL_PROGRESS);
  };
}
