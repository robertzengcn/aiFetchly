/**
 * SkillPermissionService — manages skill execution permissions.
 *
 * Uses the existing Token service (encrypted key-value store) for persistence.
 * Permission keys follow the pattern:
 *   SKILL_PERMISSION_<skillName>       → 'granted' | 'denied'
 *   SKILL_NETWORK_DOMAIN_<skillName>_<domain> → 'always' | 'once'
 */

import { Token } from "@/modules/token";
import type { SkillPermissionCategory } from "@/entityTypes/skillTypes";
import { SkillRegistry } from "@/config/skillsRegistry";

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function permissionKey(skillName: string): string {
  return `SKILL_PERMISSION_${skillName}`;
}

function networkDomainKey(skillName: string, domain: string): string {
  return `SKILL_NETWORK_DOMAIN_${skillName}_${domain}`;
}

/**
 * In-memory set for session-only (non-persistent) grants.
 * Cleared on app restart.
 */
const sessionGrants = new Set<string>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionStatus = "granted" | "denied" | "unknown";

export interface PermissionCheckResult {
  /** Whether the skill is allowed to execute. */
  readonly allowed: boolean;
  /** Why the permission was denied, if applicable. */
  readonly reason?: string;
  /** Whether to prompt the user (permission is unknown). */
  readonly needsPrompt: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Check whether a skill is allowed to execute.
 *
 * Flow:
 *  1. Look up the skill in the registry
 *  2. Pure skills → auto-allowed
 *  3. Check stored permission via Token service
 *  4. Return result indicating whether to proceed or prompt
 */
function checkPermission(skillName: string): PermissionCheckResult {
  const skill = SkillRegistry.getSkill(skillName);

  if (!skill) {
    return { allowed: false, reason: "Unknown skill", needsPrompt: false };
  }

  // Pure skills never require confirmation
  if (skill.permissionCategory === "pure") {
    return { allowed: true, needsPrompt: false };
  }

  // Check stored permission
  const token = new Token();
  const stored = token.getValue(permissionKey(skillName));

  if (stored === "granted") {
    return { allowed: true, needsPrompt: false };
  }

  if (stored === "denied") {
    return {
      allowed: false,
      reason: "Permission denied by user",
      needsPrompt: false,
    };
  }

  // Check session-only grant (non-persistent)
  if (sessionGrants.has(skillName)) {
    return { allowed: true, needsPrompt: false };
  }

  // No stored decision → need to prompt
  return { allowed: false, needsPrompt: true };
}

/**
 * Grant permission for a skill.
 *
 * @param skillName - The skill to grant permission for.
 * @param persistent - If true, store permanently; if false, only for this session.
 */
function grantPermission(skillName: string, persistent: boolean): void {
  if (persistent) {
    const token = new Token();
    token.setValue(permissionKey(skillName), "granted");
  } else {
    // Session-only grant — stored in memory, cleared on restart
    sessionGrants.add(skillName);
  }
}

/**
 * Deny permission for a skill (persists across sessions).
 */
function denyPermission(skillName: string): void {
  const token = new Token();
  token.setValue(permissionKey(skillName), "denied");
}

/**
 * Revoke a previously stored permission decision.
 * After revocation, the skill will prompt again on next use.
 */
function revokePermission(skillName: string): void {
  const token = new Token();
  token.setValue(permissionKey(skillName), "");
  sessionGrants.delete(skillName);
}

/**
 * Get the current permission status for a skill.
 */
function getPermissionStatus(skillName: string): PermissionStatus {
  const token = new Token();
  const value = token.getValue(permissionKey(skillName));

  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  return "unknown";
}

/**
 * Check whether a skill is allowed to access a specific network domain.
 */
function checkNetworkDomain(
  skillName: string,
  domain: string
): PermissionCheckResult {
  const token = new Token();
  const stored = token.getValue(networkDomainKey(skillName, domain));

  if (stored === "always") {
    return { allowed: true, needsPrompt: false };
  }

  if (stored === "once") {
    return { allowed: true, needsPrompt: false };
  }

  return { allowed: false, needsPrompt: true };
}

/**
 * Grant network domain access for a skill.
 */
function grantNetworkDomain(
  skillName: string,
  domain: string,
  persistent: boolean
): void {
  const token = new Token();
  token.setValue(
    networkDomainKey(skillName, domain),
    persistent ? "always" : "once"
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SkillPermissionService = {
  checkPermission,
  grantPermission,
  denyPermission,
  revokePermission,
  getPermissionStatus,
  checkNetworkDomain,
  grantNetworkDomain,
} as const;
