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
  SKILL_INSTALL_APPROVE_DEPENDENCY,
  SKILL_INSTALL_CANCEL,
  SKILL_INSTALL_PREPARE,
  SKILL_INSTALL_RETRY,
  SKILL_INSTALL_RUN_COMMAND,
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
  /** FR-29: bind the call to the calling conversation when known. */
  conversationId?: string;
}): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_APPROVE, input);
  return (resp as InstallSnapshot | null) ?? null;
}

/**
 * Approve or decline the typed installation of ONE missing plan dependency
 * (PRD §18 / FR-14) while the session holds at installing_dependencies.
 * Same token + plan-revision binding as the plan approval; the install runs
 * through the catalog-validated system dependency module.
 */
export async function approveSkillInstallDependency(input: {
  sessionId: string;
  dependencyId: string;
  approve: boolean;
  planRevision: string;
  approvalToken: string;
  /** FR-29: bind the call to the calling conversation when known. */
  conversationId?: string;
}): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_APPROVE_DEPENDENCY, input);
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
  sessionId: string,
  options?: { conversationId?: string }
): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_CANCEL, {
    sessionId,
    ...(options?.conversationId
      ? { conversationId: options.conversationId }
      : {}),
  });
  return (resp as InstallSnapshot | null) ?? null;
}

/**
 * Typed retry (FR-20 / §10.1): re-run a failed installation from the
 * recorded canonical source. The main process enforces the three-same-cause
 * stop rule; the returned snapshot (or error) tells the UI the outcome.
 */
export async function retrySkillInstall(
  sessionId: string,
  options?: { conversationId?: string }
): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_RETRY, {
    sessionId,
    ...(options?.conversationId
      ? { conversationId: options.conversationId }
      : {}),
  });
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

/**
 * Result of running ONE approved command template (FR-16): previews are
 * truncated server-side; injectedEnvNames carries variable NAMES only —
 * secret values never cross this boundary.
 */
export interface ApprovedCommandRunView {
  readonly ok: boolean;
  readonly commandId: string;
  readonly exitCode: number | null;
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
  readonly timedOut: boolean;
  readonly injectedEnvNames: readonly string[];
  readonly errorCode?: string;
  readonly message?: string;
}

/**
 * Run one APPROVED plan command from the persisted template (FR-06/FR-16).
 * The caller supplies only the template id — the main process revalidates
 * the persisted executable/args against the approved revision, injects
 * declared credentials directly into the child environment, and returns
 * redacted previews. The model can never substitute command text: it has no
 * channel that accepts one.
 */
export async function runApprovedSkillInstallCommand(input: {
  sessionId: string;
  commandId: string;
  approvalToken: string;
}): Promise<ApprovedCommandRunView | null> {
  const resp = await windowInvoke(SKILL_INSTALL_RUN_COMMAND, input);
  return (resp as ApprovedCommandRunView | null) ?? null;
}
