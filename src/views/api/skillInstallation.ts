import { windowInvoke } from "@/views/utils/apirequest";
import {
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
  selectedSkillIds?: readonly string[];
}): Promise<InstallSnapshot | null> {
  const resp = await windowInvoke(SKILL_INSTALL_APPROVE, input);
  return (resp as InstallSnapshot | null) ?? null;
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
