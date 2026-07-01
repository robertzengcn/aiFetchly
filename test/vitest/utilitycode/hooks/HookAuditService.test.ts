import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  ConsoleHookAuditLogger,
} from "@/service/hooks/HookAuditService";

describe("redactSecrets", () => {
  it("redacts OpenAI-style keys", () => {
    const out = redactSecrets("sk-abcdefghijklmnopqrstuvwxyz token");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-abcdefgh");
  });

  it("redacts bearer tokens", () => {
    const out = redactSecrets("Authorization: Bearer abcdef1234567890");
    expect(out).toMatch(/\[REDACTED\]/);
    expect(out).not.toContain("abcdef1234567890");
  });

  it("redacts cookie headers", () => {
    const out = redactSecrets("Cookie: sessionid=abcdefghijklmnop");
    expect(out).toMatch(/\[REDACTED\]/);
  });

  it("redacts common token field names", () => {
    const out = redactSecrets('api_key="verysecretvalue1234"');
    expect(out).toMatch(/\[REDACTED\]/);
  });

  it("preserves benign text", () => {
    const out = redactSecrets("user asked to run shell_execute");
    expect(out).toBe("user asked to run shell_execute");
  });
});

describe("ConsoleHookAuditLogger", () => {
  it("emits a JSON line tagged with [hook-audit] and does not throw on bad input", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (msg: string) => lines.push(msg);
    try {
      ConsoleHookAuditLogger.log({
        hookRunId: "r1",
        hookId: "h1",
        eventName: "PreToolUse",
        source: "builtin",
        type: "callback",
        status: "success",
        durationMs: 3,
        timestamp: "2026-06-23T00:00:00.000Z",
      });
    } finally {
      console.log = original;
    }
    expect(lines.some((l) => l.startsWith("[hook-audit] "))).toBe(true);
    const parsed = JSON.parse(lines[0].replace("[hook-audit] ", ""));
    expect(parsed.hookId).toBe("h1");
  });
});
