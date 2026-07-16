/**
 * WorkspaceTrustFilter — TRS-01 Phase 14 binary trust derivation.
 *
 * The filter is the single chokepoint where workspace approval state
 * becomes {@link AIFetchlySourceTrust} flags. Phase 14 is binary: an
 * approved workspace trusts instructions + commands only; agents/hooks/
 * skills stay false until their phases (16/17/18) ship per-capability
 * trust gates.
 *
 * Pure unit test — no mocks, no IO. The function is a pure mapping.
 */
import { describe, expect, it } from "vitest";
import { derivePhase14Trust } from "@/service/workspaceWatch/WorkspaceTrustFilter";

describe("WorkspaceTrustFilter — derivePhase14Trust (TRS-01 Phase 14 binary)", () => {
  it("derivePhase14Trust(true) trusts instructions + commands only", () => {
    expect(derivePhase14Trust(true)).toEqual({
      instructions: true,
      commands: true,
      agents: false,
      hooks: false,
      skills: false,
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
