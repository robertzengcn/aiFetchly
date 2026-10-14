import { describe, expect, it } from "vitest";
import { localizeWorkspaceError } from "@/views/utils/workspaceErrorLocalization";

const EN: Record<string, string> = {
  "workspaceChat.errors.queueLimit": "QUEUE FULL (en)",
};

/**
 * B15: central renderer mapping of typed queue errors — localized actionable
 * copy per code, English fallback when a key is missing, and an explicit
 * unknown-error fallback that never drops the reason.
 */
describe("localizeWorkspaceError (B15)", () => {
  it("maps a coded denial to localized copy", () => {
    const out = localizeWorkspaceError(
      "[QUEUE_LIMIT_REACHED] Queue limit reached (5 messages).",
      (key) => EN[key]
    );
    expect(out.code).toBe("QUEUE_LIMIT_REACHED");
    expect(out.text).toBe("QUEUE FULL (en)");
  });

  it("falls back to prefix-stripped English guidance when the key is missing", () => {
    const out = localizeWorkspaceError(
      "[QUEUE_LIMIT_REACHED] Queue limit reached (5 messages).",
      () => undefined
    );
    expect(out.code).toBe("QUEUE_LIMIT_REACHED");
    expect(out.text).toContain("queue is full");
    expect(out.text.startsWith("[")).toBe(false);
  });

  it("passes unknown codes and prefix-less messages through unchanged", () => {
    const unknown = localizeWorkspaceError("[BOGUS_CODE] something", () => undefined);
    expect(unknown.code).toBe("BOGUS_CODE");
    expect(unknown.text).toBe("[BOGUS_CODE] something");

    const plain = localizeWorkspaceError("Could not connect.", () => undefined);
    expect(plain.code).toBeNull();
    expect(plain.text).toBe("Could not connect.");
  });
});
