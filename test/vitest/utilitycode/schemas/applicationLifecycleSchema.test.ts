import { describe, expect, it } from "vitest";
import {
  applicationCloseChoiceAckSchema,
  applicationCloseChoiceSubmissionSchema,
} from "@/schemas/ipc/applicationLifecycle";

/**
 * Boundary-validation tests for the application-lifecycle IPC schemas
 * (technical design §10): unknown keys, oversized tokens, invalid enum
 * values, and smuggled process IDs / quit reasons must all be rejected.
 */
describe("applicationCloseChoiceAckSchema", () => {
  it("accepts a well-formed token", () => {
    const parsed = applicationCloseChoiceAckSchema().safeParse({
      token: "abcd1234-efgh",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown keys", () => {
    const parsed = applicationCloseChoiceAckSchema().safeParse({
      token: "abcd1234-efgh",
      pid: 1234,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a too-short token", () => {
    const parsed = applicationCloseChoiceAckSchema().safeParse({ token: "abc" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a too-long token", () => {
    const parsed = applicationCloseChoiceAckSchema().safeParse({
      token: "a".repeat(65),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects tokens with unsafe characters", () => {
    const parsed = applicationCloseChoiceAckSchema().safeParse({
      token: "abc; rm -rf /",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("applicationCloseChoiceSubmissionSchema", () => {
  it("accepts each valid choice", () => {
    for (const choice of ["hide", "exit", "cancel"] as const) {
      const parsed = applicationCloseChoiceSubmissionSchema().safeParse({
        token: "tok-token-1234",
        choice,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects an invalid choice value", () => {
    const parsed = applicationCloseChoiceSubmissionSchema().safeParse({
      token: "tok-token-1234",
      choice: "restart",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects smuggled extra fields such as process ids", () => {
    const parsed = applicationCloseChoiceSubmissionSchema().safeParse({
      token: "tok-token-1234",
      choice: "exit",
      pid: 42,
      reason: "because",
    });
    expect(parsed.success).toBe(false);
  });
});
