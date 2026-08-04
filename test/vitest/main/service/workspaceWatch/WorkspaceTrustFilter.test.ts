/**
 * WorkspaceTrustFilter — TRS-01 trust derivation chokepoint.
 *
 * The filter is the single chokepoint where workspace approval state becomes
 * {@link AIFetchlySourceTrust} flags. Since Phase 17 (D-TrustUX) all five
 * flags track the same binary approval, so an approved workspace trusts EVERY
 * capability — instructions, commands, agents, hooks, and skills — and a
 * revoked/untrusted workspace trusts none. (Phase 14 previously hardcoded
 * agents/hooks/skills to false; that limitation was removed.)
 *
 * Pure unit test — no mocks, no IO. The function is a pure mapping.
 */
import { describe, expect, it } from "vitest";
import { derivePhase14Trust } from "@/service/workspaceWatch/WorkspaceTrustFilter";

describe("WorkspaceTrustFilter — derivePhase14Trust (TRS-01 binary trust)", () => {
  it("derivePhase14Trust(true) trusts every capability", () => {
    expect(derivePhase14Trust(true)).toEqual({
      instructions: true,
      commands: true,
      agents: true,
      hooks: true,
      skills: true,
    });
  });

  it("derivePhase14Trust(false) returns all-false (workspace untrusted)", () => {
    expect(derivePhase14Trust(false)).toEqual({
      instructions: false,
      commands: false,
      agents: false,
      hooks: false,
      skills: false,
    });
  });
});
