import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted; the factory must not reference top-level locals that
// are initialized after hoisting. We expose a stable `__enabled` knob and
// toggle it via `setAiEnabled`.
let enabled = true;
vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: () => enabled,
}));

import { verifyContactInfoForAi } from "@/service/ContactVerificationAiTools";

function setAiEnabled(v: boolean): void {
  enabled = v;
}

function ctx(): {
  conversationId: string;
  toolCallId: string;
  emitProgress?: (e: { phase: string; message: string }) => void;
  signal?: AbortSignal;
} {
  return { conversationId: "c1", toolCallId: "tc1" };
}

describe("verifyContactInfoForAi (AI tool)", () => {
  beforeEach(() => {
    setAiEnabled(true);
  });

  it("returns a failure BEFORE parsing when AI is disabled", async () => {
    setAiEnabled(false);
    const r = await verifyContactInfoForAi(
      { contacts: [{ emails: ["someone@example.com"] }] },
      ctx() as never
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not enabled/i);
  });

  it("verifies a placeholder email as invalid and returns snake_case output (no DNS needed)", async () => {
    const r = await verifyContactInfoForAi(
      { contacts: [{ emails: ["someone@example.com"] }] },
      ctx() as never
    );
    expect(r.success).toBe(true);
    expect(r.result).toBeDefined();
    const result = r.result as Record<string, unknown>;
    expect(result.verification_depth).toBe("standard");
    expect(result.verification_performed).toBe(true);
    expect(result.limitations).toBeDefined();
    const contacts = result.contacts as Array<{
      emails: Array<{
        status: string;
        normalized: string;
        checks: Record<string, unknown>;
      }>;
    }>;
    expect(contacts[0].emails[0].status).toBe("invalid");
    expect(contacts[0].emails[0].normalized).toBe("someone@example.com");
    expect(contacts[0].emails[0].checks).toHaveProperty("syntax_valid");
    expect(contacts[0].emails[0].checks).toHaveProperty("mail_routing");
  });

  it("verifies an explicit international phone (no DNS needed)", async () => {
    const r = await verifyContactInfoForAi(
      { contacts: [{ phones: ["+1 415 555 2671"] }] },
      ctx() as never
    );
    expect(r.success).toBe(true);
    const result = r.result as Record<string, unknown>;
    const contacts = result.contacts as Array<{
      phones: Array<{ status: string; normalized: string }>;
    }>;
    expect(contacts[0].phones[0].status).toBe("likely_valid");
    expect(contacts[0].phones[0].normalized).toBe("+14155552671");
  });

  it("verifies a mixed email+phone request in one call", async () => {
    const r = await verifyContactInfoForAi(
      {
        contacts: [
          {
            emails: ["someone@example.com"],
            phones: ["+44 20 7946 0958"],
          },
        ],
      },
      ctx() as never
    );
    expect(r.success).toBe(true);
    const result = r.result as Record<string, unknown>;
    const contacts = result.contacts as Array<{
      emails: Array<{ status: string }>;
      phones: Array<{ status: string }>;
    }>;
    expect(contacts[0].emails[0].status).toBe("invalid");
    expect(contacts[0].phones[0].status).toBe("likely_valid");
  });

  it("includes the snake_case summary block with input/unique counts", async () => {
    const r = await verifyContactInfoForAi(
      { contacts: [{ emails: ["someone@example.com"] }] },
      ctx() as never
    );
    const result = r.result as Record<string, unknown>;
    const summary = result.summary as Record<string, unknown>;
    expect(summary.input_emails).toBe(1);
    expect(summary.input_phones).toBe(0);
    expect(summary.invalid).toBe(1);
  });

  it("rejects an empty contacts array with an invalid-input error", async () => {
    const r = await verifyContactInfoForAi({ contacts: [] }, ctx() as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/invalid input/i);
  });

  it("preserves a national phone as ambiguous when no country evidence", async () => {
    const r = await verifyContactInfoForAi(
      { contacts: [{ phones: ["020 7946 0958"] }] },
      ctx() as never
    );
    const result = r.result as Record<string, unknown>;
    const contacts = result.contacts as Array<{
      phones: Array<{ status: string; normalized?: string }>;
    }>;
    expect(contacts[0].phones[0].status).toBe("ambiguous_region");
    expect(contacts[0].phones[0].normalized).toBeUndefined();
  });

  it("emits progress via the context emitProgress sink", async () => {
    const phases: string[] = [];
    const c = {
      conversationId: "c1",
      toolCallId: "tc1",
      emitProgress: (e: { phase: string }) => phases.push(e.phase),
    };
    await verifyContactInfoForAi(
      {
        contacts: [
          { emails: ["someone@example.com"], phones: ["+1 415 555 2671"] },
        ],
      },
      c as never
    );
    expect(phases.length).toBeGreaterThan(0);
    expect(phases).toContain("finalizing");
  });
});
