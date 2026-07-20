/**
 * WorkspaceTrustFilter — TRS-01 trust derivation chokepoint.
 *
 * Single chokepoint where workspace approval state becomes
 * {@link AIFetchlySourceTrust} flags consumed by
 * {@link AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot}.
 *
 * Phase 17 (Plan 02 Task 2b) body replacement: under D-TrustUX all five flags
 * track the same binary approval, so an approved workspace now trusts EVERY
 * capability — including hooks (Phase 17, SC1), agents (Phase 16), and skills
 * (Phase 18). Phase 14 hardcoded agents/hooks/skills to false; that limitation
 * is removed here. The boolean input is derived (by the manager) from the
 * entity-backed sync trust cache in WorkspaceWatchManagerSingleton, which is
 * hydrated from the persisted AIFetchlyWorkspaceTrust entity (TRS-02).
 *
 * Design references: §8.2 (trust filtering before registry mutation),
 * §13.1 (Phase 14 binary gate vs Phase 17 per-capability entity).
 *
 * Pure module — no Electron, TypeORM, or service imports; safe to import
 * from any process context.
 */

import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";

/**
 * Derive the trust flags from a workspace's approval state.
 *
 * @param workspaceApproved - whether the workspace is approved for AI config
 *   (resolved by the manager from the entity-backed sync trust cache).
 * @returns AIFetchlySourceTrust with every capability flag set to the approval
 *   boolean (D-TrustUX — all flags track the same block approval). Hooks flow
 *   the approval so a trusted workspace's hooks reach the registry (SC1); a
 *   revoked workspace's hooks are dropped before mutation.
 */
export function derivePhase14Trust(
  workspaceApproved: boolean
): AIFetchlySourceTrust {
  return {
    instructions: workspaceApproved,
    commands: workspaceApproved,
    agents: workspaceApproved,
    hooks: workspaceApproved,
    skills: workspaceApproved,
  };
}
