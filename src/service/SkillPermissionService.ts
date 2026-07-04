/**
 * SkillPermissionService — manages skill execution permissions.
 *
 * Uses the existing Token service (encrypted key-value store) for persistence.
 * Permission keys follow the pattern:
 *   SKILL_PERMISSION_<skillName>       → 'granted' | 'denied'
 *   SKILL_NETWORK_DOMAIN_<skillName>_<domain> → 'always' | 'once'
 */

import { Token } from "@/modules/token";
import { SkillRegistry } from "@/config/skillsRegistry";

/** Legacy search-scrape tool IDs (pre-unification); permissions may still be stored under these keys. */
const LEGACY_SEARCH_SCRAPE_SKILL_NAMES: ReadonlySet<string> = new Set([
  "scrape_urls_from_google",
  "scrape_urls_from_bing",
  "scrape_urls_from_yandex",
  "scrape_urls_from_baidu",
]);

const UNIFIED_SEARCH_SCRAPE_SKILL = "scrape_urls_from_search_engine";

/**
 * Map a permission / invocation name to the registry skill used for category rules.
 */
function resolveRegistrySkillNameForPermission(skillName: string): string {
  if (LEGACY_SEARCH_SCRAPE_SKILL_NAMES.has(skillName)) {
    return UNIFIED_SEARCH_SCRAPE_SKILL;
  }
  return skillName;
}

/**
 * Effective stored permission: honours the exact key, unified key for legacy aliases,
 * and any legacy key when checking the unified skill (migration).
 */
function readSearchScrapePermissionToken(
  token: Token,
  skillName: string
): string {
  const direct = token.getValue(permissionKey(skillName));
  if (direct === "granted" || direct === "denied") {
    return direct;
  }
  if (skillName === UNIFIED_SEARCH_SCRAPE_SKILL) {
    for (const legacy of LEGACY_SEARCH_SCRAPE_SKILL_NAMES) {
      const v = token.getValue(permissionKey(legacy));
      if (v === "granted" || v === "denied") {
        return v;
      }
    }
    return direct;
  }
  if (LEGACY_SEARCH_SCRAPE_SKILL_NAMES.has(skillName)) {
    const unified = token.getValue(permissionKey(UNIFIED_SEARCH_SCRAPE_SKILL));
    if (unified === "granted" || unified === "denied") {
      return unified;
    }
  }
  return direct;
}

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
  const registryName = resolveRegistrySkillNameForPermission(skillName);
  const skill = SkillRegistry.getSkill(registryName);

  if (!skill) {
    return { allowed: false, reason: "Unknown skill", needsPrompt: false };
  }

  // Pure skills never require confirmation
  if (skill.permissionCategory === "pure") {
    return { allowed: true, needsPrompt: false };
  }

  // Check session-only grant first (set by "Allow Once" in the current
  // session). This must come before the shell always-prompt so that a
  // pending session grant can auto-approve the next invocation.
  //
  // F8 fix — for shell-category skills the grant is ONE-SHOT: it must be
  // consumed by the matching pending command. Without this, a single
  // "Allow Once" click (or one renderer grant IPC) silently turned into a
  // session-wide approval that bypassed the per-command shell prompt. We
  // delete the grant here, before returning, so the very next shell
  // command will again hit the always-prompt branch below unless a fresh
  // grant is issued. Non-shell skills retain their session-wide behaviour
  // since their threat model does not include arbitrary command execution.
  if (
    sessionGrants.has(skillName) ||
    (registryName !== skillName && sessionGrants.has(registryName))
  ) {
    if (skill.permissionCategory === "shell") {
      sessionGrants.delete(skillName);
      if (registryName !== skillName) sessionGrants.delete(registryName);
    }
    return { allowed: true, needsPrompt: false };
  }

  // Shell skills require a prompt per execution unless a session grant exists
  // (checked above). Stored (persistent) permissions are intentionally NOT
  // honoured for shell — each new app session must re-consent.
  if (skill.permissionCategory === "shell") {
    return { allowed: false, needsPrompt: true };
  }

  // Check stored permission
  const token = new Token();
  const stored = readSearchScrapePermissionToken(token, skillName);

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

  // No stored decision → need to prompt
  return { allowed: false, needsPrompt: true };
}

/**
 * Grant permission for a skill.
 *
 * @param skillName - The skill to grant permission for.
 * @param persistent - If true, store permanently; if false, only for this session.
 *
 * F8 note — for shell-category skills, a non-persistent grant is ONE-SHOT:
 * it is consumed by the next matching checkPermission call (see
 * checkPermission). Non-shell skills keep session-wide semantics.
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
  sessionGrants.delete(skillName);
  if (LEGACY_SEARCH_SCRAPE_SKILL_NAMES.has(skillName)) {
    sessionGrants.delete(UNIFIED_SEARCH_SCRAPE_SKILL);
  } else if (skillName === UNIFIED_SEARCH_SCRAPE_SKILL) {
    for (const leg of LEGACY_SEARCH_SCRAPE_SKILL_NAMES) {
      sessionGrants.delete(leg);
    }
  }
}

/**
 * Revoke a previously stored permission decision.
 * After revocation, the skill will prompt again on next use.
 */
function revokePermission(skillName: string): void {
  const token = new Token();
  token.setValue(permissionKey(skillName), "");
  sessionGrants.delete(skillName);
  if (LEGACY_SEARCH_SCRAPE_SKILL_NAMES.has(skillName)) {
    sessionGrants.delete(UNIFIED_SEARCH_SCRAPE_SKILL);
  } else if (skillName === UNIFIED_SEARCH_SCRAPE_SKILL) {
    for (const leg of LEGACY_SEARCH_SCRAPE_SKILL_NAMES) {
      sessionGrants.delete(leg);
    }
  }
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
