/**
 * WorkspaceTrustFilter — TRS-01 Phase 14 binary trust derivation.
 *
 * Single chokepoint where workspace approval state becomes
 * {@link AIFetchlySourceTrust} flags consumed by
 * {@link AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot}. Phase 14 is
 * binary: an approved workspace trusts instructions + commands only; agents
 * (Phase 16), hooks (Phase 17), and skills (Phase 18) stay false until those
 * phases ship their own per-capability trust gates.
 *
 * Design references: §8.2 (trust filtering before registry mutation),
 * §13.1 (Phase 14 binary gate vs Phase 17 per-capability entity).
 *
 * This is a TEMPORARY Phase 14 binary derivation. Phase 17 replaces the body
 * of this function (same export signature) with a lookup against the
 * per-capability `AIFetchlyWorkspaceTrust` entity. Callers depend on the
 * {@link AIFetchlySourceTrust} shape, not on this binary derivation, so the
 * Phase 17 swap is mechanical.
 *
 * Pure module — no Electron, TypeORM, or service imports; safe to import
 * from any process context.
 */

import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";

/**
 * Derive the Phase 14 binary trust flags from a workspace's approval state.
 *
 * @param workspaceApproved - whether the workspace is approved for AI config
 *   (reuses the existing workspace approval state; per-capability entity is
 *   Phase 17, deferred per CONTEXT.md)
 * @returns AIFetchlySourceTrust with instructions + commands matching the
 *   approval flag and agents/hooks/skills always false in Phase 14.
 */
export function derivePhase14Trust(
  workspaceApproved: boolean
): AIFetchlySourceTrust {
  return {
    instructions: workspaceApproved,
    commands: workspaceApproved,
    agents: false,
    hooks: false,
    skills: false,
  };
}
