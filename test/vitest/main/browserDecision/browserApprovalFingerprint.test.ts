import { describe, expect, it } from "vitest";
import {
  computeApprovalFingerprint,
  digestSecretValue,
  type SemanticActionDescriptor,
} from "@/service/browserDecision/BrowserApprovalFingerprint";

/** PRD D-FR-27: approvals bind to the semantic action, not random refs. */

function descriptor(
  overrides: Partial<SemanticActionDescriptor>,
): SemanticActionDescriptor {
  return {
    operation: "click",
    role: "button",
    name: "Publish",
    context: null,
    valueDigest: null,
    key: null,
    optionId: null,
    ...overrides,
  };
}

describe("BrowserApprovalFingerprint (D-FR-27)", () => {
  it("is stable across reobservations when the semantic action is unchanged", () => {
    // Same click resolved from two different observations: different refs,
    // same role/name. The fingerprint must match so the approval can be
    // consumed instead of looping.
    const a = computeApprovalFingerprint({
      actions: [descriptor({})],
      siteRegistrableDomain: "example.com",
    });
    const b = computeApprovalFingerprint({
      actions: [descriptor({})],
      siteRegistrableDomain: "example.com",
    });
    expect(a).toBe(b);
  });

  it("changes when the operation, target, or value changes", () => {
    const base = { actions: [descriptor({})], siteRegistrableDomain: "example.com" };
    const baseFp = computeApprovalFingerprint(base);
    expect(
      computeApprovalFingerprint({
        ...base,
        actions: [descriptor({ operation: "fill", valueDigest: digestSecretValue("x") })],
      }),
    ).not.toBe(baseFp);
    expect(
      computeApprovalFingerprint({
        ...base,
        actions: [descriptor({ name: "Delete" })],
      }),
    ).not.toBe(baseFp);
    expect(
      computeApprovalFingerprint({
        ...base,
        actions: [
          descriptor({}),
          descriptor({ role: "button", name: "Publish" }),
        ],
      }),
    ).not.toBe(baseFp);
  });

  it("changes when the site domain differs", () => {
    const a = computeApprovalFingerprint({
      actions: [descriptor({})],
      siteRegistrableDomain: "example.com",
    });
    const b = computeApprovalFingerprint({
      actions: [descriptor({})],
      siteRegistrableDomain: "example.org",
    });
    expect(a).not.toBe(b);
  });

  it("digests values so the approved text never appears in the fingerprint input", () => {
    const digest = digestSecretValue("hunter2");
    expect(digest).not.toContain("hunter2");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const a = computeApprovalFingerprint({
      actions: [descriptor({ operation: "fill", valueDigest: digest })],
      siteRegistrableDomain: "example.com",
    });
    const b = computeApprovalFingerprint({
      actions: [descriptor({ operation: "fill", valueDigest: digestSecretValue("hunter2") })],
      siteRegistrableDomain: "example.com",
    });
    expect(a).toBe(b);
  });
});
