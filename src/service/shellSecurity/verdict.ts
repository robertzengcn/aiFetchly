/**
 * Permission verdict — the decision returned by `checkShellPermission`.
 *
 * Three tiers, matching Claude Code's layered model:
 *
 *   - `allow`  — proven safe (parser-trusted + paths in-workspace + no hazards)
 *   - `ask`    — analyzable but plausibly dangerous (writes, network, push...)
 *   - `deny`   — explicitly blocked by policy
 *
 * In this app, `executeShellCommand` runs *after* the user-consent prompt.
 * Both `ask` and `deny` block execution with a structured reason. `ask` is
 * distinguished in `permission_verdict` so a future UI can surface
 * "requires elevated approval" distinct from "hard-blocked by policy".
 */

export type VerdictTier = "allow" | "deny" | "ask";

export interface PermissionVerdict {
  readonly tier: VerdictTier;
  /** Stable machine-readable code, e.g. "DENYLIST_MATCH" or "PATH_OUTSIDE_ROOTS". */
  readonly code: string;
  /** Human-readable explanation, safe to surface to the AI/UI. */
  readonly reason: string;
}

export const allow = (): PermissionVerdict => ({
  tier: "allow",
  code: "OK",
  reason: "",
});

export const deny = (code: string, reason: string): PermissionVerdict => ({
  tier: "deny",
  code,
  reason,
});

export const ask = (code: string, reason: string): PermissionVerdict => ({
  tier: "ask",
  code,
  reason,
});
