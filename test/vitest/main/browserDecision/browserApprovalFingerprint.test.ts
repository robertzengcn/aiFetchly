import { describe, expect, it } from "vitest";
import {
  computeApprovalFingerprint,
  digestSecretValue,
  type SemanticActionDescriptor,
  type SemanticActionNode,
} from "@/service/browserDecision/BrowserApprovalFingerprint";

/** PRD D-FR-27: approvals bind to the semantic action, not random refs. */

function descriptor(
  overrides: Partial<SemanticActionDescriptor>,
): SemanticActionNode {
  const leaf: SemanticActionDescriptor = {
    operation: "click",
    role: "button",
    name: "Publish",
    context: null,
    valueDigest: null,
    key: null,
    optionId: null,
    ...overrides,
  };
  return { kind: "leaf", descriptor: leaf };
}

describe("BrowserApprovalFingerprint payload binding (T15)", () => {
  it("changes when a SELECT option value changes", () => {
    const base = {
      actions: [descriptor({ operation: "select", optionId: "opt_a" })],
      siteRegistrableDomain: "example.com",
    };
    const changed = {
      ...base,
      actions: [descriptor({ operation: "select", optionId: "opt_b" })],
    };
    expect(computeApprovalFingerprint(base)).not.toBe(computeApprovalFingerprint(changed));
  });

  it("changes when a navigation destination changes", () => {
    const base = {
      actions: [descriptor({ operation: "navigate", context: "https://example.com/a" })],
      siteRegistrableDomain: "example.com",
    };
    const changed = {
      ...base,
      actions: [descriptor({ operation: "navigate", context: "https://example.com/b" })],
    };
    expect(computeApprovalFingerprint(base)).not.toBe(computeApprovalFingerprint(changed));
  });
});

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

// ---------------------------------------------------------------------------
// F13: whole-program semantics bind (structure + canonical payloads)
// ---------------------------------------------------------------------------

function leaf(operation: string, extra: Partial<SemanticActionDescriptor> = {}): SemanticActionNode {
  return descriptor({ operation, ...extra });
}

describe("F13 whole-program semantics binding", () => {
  it("distinguishes repeat maxIterations 1 vs 5 over the same body", () => {
    const one = computeApprovalFingerprint({
      actions: [
        {
          kind: "repeat",
          condition: "element",
          conditionTarget: "button:Refresh",
          maxIterations: 1,
          body: [leaf("click")],
        },
      ],
      siteRegistrableDomain: "example.com",
    });
    const five = computeApprovalFingerprint({
      actions: [
        {
          kind: "repeat",
          condition: "element",
          conditionTarget: "button:Refresh",
          maxIterations: 5,
          body: [leaf("click")],
        },
      ],
      siteRegistrableDomain: "example.com",
    });
    expect(one).not.toBe(five);
  });

  it("distinguishes a changed if condition and its discriminator", () => {
    const onElement = computeApprovalFingerprint({
      actions: [
        {
          kind: "if",
          condition: "element",
          conditionTarget: "button:Retry",
          then: [leaf("click")],
          else: [],
        },
      ],
      siteRegistrableDomain: "example.com",
    });
    const onText = computeApprovalFingerprint({
      actions: [
        {
          kind: "if",
          condition: "text",
          conditionTarget: `text:${digestSecretValue("Out of stock")}`,
          then: [leaf("click")],
          else: [],
        },
      ],
      siteRegistrableDomain: "example.com",
    });
    expect(onElement).not.toBe(onText);
    // A changed else branch changes the fingerprint too.
    const elseChanged = computeApprovalFingerprint({
      actions: [
        {
          kind: "if",
          condition: "element",
          conditionTarget: "button:Retry",
          then: [leaf("click")],
          else: [leaf("navigate", { context: "https://example.com/fallback" })],
        },
      ],
      siteRegistrableDomain: "example.com",
    });
    expect(elseChanged).not.toBe(onElement);
  });

  it("distinguishes SELECT values that collide under join(',')", () => {
    const a = computeApprovalFingerprint({
      actions: [leaf("select", { optionId: digestSecretValue(JSON.stringify(["a,b", "c"])) })],
      siteRegistrableDomain: "example.com",
    });
    const b = computeApprovalFingerprint({
      actions: [leaf("select", { optionId: digestSecretValue(JSON.stringify(["a", "b,c"])) })],
      siteRegistrableDomain: "example.com",
    });
    expect(a).not.toBe(b);
    // Same list, same digest (canonical serialization is stable).
    const again = computeApprovalFingerprint({
      actions: [leaf("select", { optionId: digestSecretValue(JSON.stringify(["a,b", "c"])) })],
      siteRegistrableDomain: "example.com",
    });
    expect(a).toBe(again);
  });

  it("binds the condition target semantically (role/name), not the raw ref", () => {
    const byRoleName = computeApprovalFingerprint({
      actions: [
        {
          kind: "repeat",
          condition: "element",
          conditionTarget: "button:Refresh",
          maxIterations: 3,
          body: [leaf("click")],
        },
      ],
      siteRegistrableDomain: "example.com",
    });
    // Same semantic target resolved from a different observation ref.
    const same = computeApprovalFingerprint({
      actions: [
        {
          kind: "repeat",
          condition: "element",
          conditionTarget: "button:Refresh",
          maxIterations: 3,
          body: [leaf("click")],
        },
      ],
      siteRegistrableDomain: "example.com",
    });
    expect(byRoleName).toBe(same);
  });
});
