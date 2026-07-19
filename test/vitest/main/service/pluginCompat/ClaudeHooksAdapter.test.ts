import { describe, it, expect } from "vitest";
import { ClaudeHooksAdapter } from "@/service/pluginCompat/ClaudeHooksAdapter";

describe("ClaudeHooksAdapter", () => {
  it("adapts a PreToolUse hook with a tool pattern", () => {
    const raw = {
      PreToolUse: [
        {
          matcher: "shell_execute",
          hooks: [
            {
              type: "command",
              command: "echo 'denying'",
            },
          ],
        },
      ],
    };
    const r = ClaudeHooksAdapter.adapt(raw, "lead-pack");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matchers.length).toBe(1);
    const m = r.matchers[0];
    expect(m.event).toBe("PreToolUse");
    expect(m.matcher).toBe("shell_execute");
    expect(m.pluginName).toBe("lead-pack");
    expect(m.sourceCommand).toBe("echo 'denying'");
  });

  it("adapts multiple matchers across events", () => {
    const raw = {
      PreToolUse: [
        { matcher: "mcp_*", hooks: [{ type: "command", command: "a" }] },
      ],
      PostToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: "b" }] },
      ],
    };
    const r = ClaudeHooksAdapter.adapt(raw, "p");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matchers.map((m) => m.event).sort()).toEqual([
      "PostToolUse",
      "PreToolUse",
    ]);
  });

  it("treats missing matcher as wildcard", () => {
    const raw = {
      Stop: [{ hooks: [{ type: "command", command: "x" }] }],
    };
    const r = ClaudeHooksAdapter.adapt(raw, "p");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matchers[0].matcher).toBeUndefined();
  });

  it("skips unsupported events but does not error", () => {
    const raw = {
      UnsupportedEvent: [
        { hooks: [{ type: "command", command: "x" }] },
      ],
    };
    const r = ClaudeHooksAdapter.adapt(raw, "p");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matchers.length).toBe(0);
    expect(r.unsupported.length).toBe(1);
    expect(r.unsupported[0]).toBe("UnsupportedEvent");
  });

  it("fails on non-object input", () => {
    const r = ClaudeHooksAdapter.adapt("not an object", "p");
    expect(r.ok).toBe(false);
  });

  it("fails when matcher entry has no hooks array", () => {
    const raw = {
      PreToolUse: [{ matcher: "x" }],
    };
    const r = ClaudeHooksAdapter.adapt(raw, "p");
    expect(r.ok).toBe(true); // skipped, not failed
    if (!r.ok) return;
    expect(r.matchers.length).toBe(0);
  });

  it("only admits hooks of type 'command' (Claude convention)", () => {
    const raw = {
      PreToolUse: [
        {
          matcher: "x",
          hooks: [{ type: "other", command: "c" }],
        },
      ],
    };
    const r = ClaudeHooksAdapter.adapt(raw, "p");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matchers.length).toBe(0); // 'other'-type hooks skipped
  });
});
