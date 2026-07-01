import { describe, it, expect } from "vitest";
import { validateHookOutput } from "@/service/hooks/HookOutputValidator";
import { HOOK_LIMITS } from "@/entityTypes/hookTypes";

describe("validateHookOutput", () => {
  it("accepts an empty object as minimal output", () => {
    const r = validateHookOutput({});
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.output).toEqual({});
  });

  it("accepts a block output with continue:false and reason", () => {
    const r = validateHookOutput({
      continue: false,
      reason: "blocked by policy",
    });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.output.continue).toBe(false);
      expect(r.output.reason).toBe("blocked by policy");
    }
  });

  it("accepts each permission decision", () => {
    for (const d of ["allow", "ask", "deny"] as const) {
      const r = validateHookOutput({ permissionDecision: d });
      expect(r.valid).toBe(true);
      if (r.valid) expect(r.output.permissionDecision).toBe(d);
    }
  });

  it("rejects primitive output", () => {
    expect(validateHookOutput(null).valid).toBe(false);
    expect(validateHookOutput(undefined).valid).toBe(false);
    expect(validateHookOutput("continue").valid).toBe(false);
    expect(validateHookOutput(42).valid).toBe(false);
    expect(validateHookOutput(true).valid).toBe(false);
  });

  it("rejects arrays", () => {
    expect(validateHookOutput([1, 2, 3]).valid).toBe(false);
  });

  it("rejects invalid permission decision", () => {
    const r = validateHookOutput({ permissionDecision: "yes" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toMatch(/permissionDecision/);
  });

  it("rejects non-boolean continue", () => {
    expect(validateHookOutput({ continue: "yes" }).valid).toBe(false);
  });

  it("rejects oversized reason", () => {
    const r = validateHookOutput({ reason: "x".repeat(HOOK_LIMITS.maxReasonChars + 1) });
    expect(r.valid).toBe(false);
  });

  it("rejects oversized systemMessage", () => {
    const r = validateHookOutput({
      systemMessage: "x".repeat(HOOK_LIMITS.maxSystemMessageChars + 1),
    });
    expect(r.valid).toBe(false);
  });

  it("rejects oversized additionalContext", () => {
    const r = validateHookOutput({
      additionalContext: "x".repeat(HOOK_LIMITS.maxAdditionalContextChars + 1),
    });
    expect(r.valid).toBe(false);
  });

  it("rejects non-object updatedInput", () => {
    expect(validateHookOutput({ updatedInput: "nope" }).valid).toBe(false);
    expect(validateHookOutput({ updatedInput: null }).valid).toBe(false);
    expect(validateHookOutput({ updatedInput: [1, 2] }).valid).toBe(false);
  });

  it("rejects non-object updatedToolOutput", () => {
    expect(validateHookOutput({ updatedToolOutput: 5 }).valid).toBe(false);
  });

  it("accepts a well-formed updatedInput", () => {
    const r = validateHookOutput({ updatedInput: { command: "ls" } });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.output.updatedInput).toEqual({ command: "ls" });
  });

  it("rejects oversized serialized updatedInput", () => {
    const huge = { blob: "x".repeat(HOOK_LIMITS.maxUpdatedInputBytes + 10) };
    expect(validateHookOutput({ updatedInput: huge }).valid).toBe(false);
  });

  it("ignores unknown fields", () => {
    const r = validateHookOutput({ continue: true, bogus: "drop" });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.output.continue).toBe(true);
      expect((r.output as Record<string, unknown>).bogus).toBeUndefined();
    }
  });
});
