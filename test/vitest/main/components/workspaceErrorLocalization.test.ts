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

  /**
   * R8 P2-8 (FR-REC-004): stable sentinels that now travel the stream
   * transport (quota/auth/image-edit/context-window) map exactly like typed
   * codes — localized copy when the key resolves, English guidance
   * otherwise, and a vue-i18n key-echo is treated as missing.
   */
  it("maps bare sentinels to localized copy with English fallback", () => {
    const ctx = localizeWorkspaceError(
      "CONTEXT_WINDOW_EXCEEDED",
      () => undefined
    );
    expect(ctx.code).toBe("CONTEXT_WINDOW_EXCEEDED");
    expect(ctx.text).toContain("too long for the model's context window");

    const quota = localizeWorkspaceError("QUOTA_EXHAUSTED", () => undefined);
    expect(quota.code).toBe("QUOTA_EXHAUSTED");
    expect(quota.text).toContain("recharge your account");

    const auth = localizeWorkspaceError("AUTH_EXPIRED", () => undefined);
    expect(auth.text).toContain("sign in again");

    const editUnavailable = localizeWorkspaceError(
      "IMAGE_EDIT_UNAVAILABLE",
      () => undefined
    );
    expect(editUnavailable.text).toContain("edit-capable model");

    const editProvider = localizeWorkspaceError(
      "IMAGE_EDIT_PROVIDER_FAILED",
      () => undefined
    );
    expect(editProvider.text).toContain("provider failed to edit the image");
  });

  it("prefers the localized key over the English fallback and ignores key echoes", () => {
    const out = localizeWorkspaceError(
      "CONTEXT_WINDOW_EXCEEDED",
      (key) => (key === "workspaceChat.errors.contextWindow" ? "FENÊTRE" : undefined)
    );
    expect(out.text).toBe("FENÊTRE");

    // A vue-i18n key echo (missing translation) is NOT copy — fall through.
    const echo = localizeWorkspaceError(
      "QUOTA_EXHAUSTED",
      (key) => key
    );
    expect(echo.text).toContain("recharge your account");
  });
});
