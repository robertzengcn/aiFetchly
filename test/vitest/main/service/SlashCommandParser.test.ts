/**
 * CMD-02 — SlashCommandParser input classification rules.
 *
 * The parser is a pure function (no registry/IPC/Electron imports).
 * Plan 03's SlashCommandDispatcher composes parser + registry to resolve
 * commands; the parser only classifies raw composer text.
 *
 * Rules (design §11.1):
 *   1. Empty or non-`/`-leading input → not a command.
 *   2. `//foo` → not a command (escaped or comment).
 *   3. Bare `/` → suggest-only (isCommand=true, name=undefined).
 *   4. `/name args` → command; args split on FIRST whitespace run,
 *      internal whitespace preserved.
 *   5. Leading whitespace is left-trimmed before classification.
 *
 * TRS-06 boundary: NO $ARGUMENTS substitution (phase 15).
 */
import { describe, expect, it } from "vitest";
import { parseSlashCommandInput } from "@/service/slashCommands/SlashCommandParser";

describe("parseSlashCommandInput (CMD-02)", () => {
  it.each([
    {
      label: "/review src → command with args",
      input: "/review src",
      expected: {
        isCommand: true,
        name: "review",
        args: "src",
        raw: "/review src",
      },
    },
    {
      label: "leading space then /review → command after left-trim",
      input: " /review",
      expected: {
        isCommand: true,
        name: "review",
        args: undefined,
        raw: " /review",
      },
    },
    {
      label: "multiple leading spaces then /review → command after left-trim",
      input: "   \t/review",
      expected: {
        isCommand: true,
        name: "review",
        args: undefined,
        raw: "   \t/review",
      },
    },
    {
      label: "//review → NOT a command (escaped/comment)",
      input: "//review",
      expected: { isCommand: false, name: undefined, args: undefined, raw: "//review" },
    },
    {
      label: "bare '/' → suggest-only (isCommand=true, name=undefined)",
      input: "/",
      expected: { isCommand: true, name: undefined, args: undefined, raw: "/" },
    },
    {
      label: "'/ ' (slash + whitespace) → suggest-only",
      input: "/   ",
      expected: { isCommand: true, name: undefined, args: undefined, raw: "/   " },
    },
    {
      label: "'/\\t\\n' (slash + tab/newline) → suggest-only",
      input: "/\t\n",
      expected: { isCommand: true, name: undefined, args: undefined, raw: "/\t\n" },
    },
    {
      label: "/unknown args here → command (dispatcher returns not-found)",
      input: "/unknown args here",
      expected: {
        isCommand: true,
        name: "unknown",
        args: "args here",
        raw: "/unknown args here",
      },
    },
    {
      label: "slash NOT at start → NOT a command",
      input: "hello /world",
      expected: {
        isCommand: false,
        name: undefined,
        args: undefined,
        raw: "hello /world",
      },
    },
    {
      label: "empty string → NOT a command",
      input: "",
      expected: { isCommand: false, name: undefined, args: undefined, raw: "" },
    },
    {
      label: "whitespace-only string → NOT a command",
      input: "   ",
      expected: { isCommand: false, name: undefined, args: undefined, raw: "   " },
    },
    {
      label: "/review   multiple   spaces → args preserve internal whitespace",
      input: "/review   multiple   spaces",
      expected: {
        isCommand: true,
        name: "review",
        args: "multiple   spaces",
        raw: "/review   multiple   spaces",
      },
    },
    {
      label: "/review\\t<tab-separated args> → split on first whitespace run",
      input: "/review\tfile-a\tfile-b",
      expected: {
        isCommand: true,
        name: "review",
        args: "file-a\tfile-b",
        raw: "/review\tfile-a\tfile-b",
      },
    },
    {
      label: "/status (no args) → command, args=undefined",
      input: "/status",
      expected: {
        isCommand: true,
        name: "status",
        args: undefined,
        raw: "/status",
      },
    },
    {
      label: "/review trailing space → command, args=undefined (empty remainder trimmed)",
      input: "/review ",
      expected: {
        isCommand: true,
        name: "review",
        args: undefined,
        raw: "/review ",
      },
    },
    {
      label: "///triple → NOT a command (starts with //)",
      input: "///triple",
      expected: { isCommand: false, name: undefined, args: undefined, raw: "///triple" },
    },
  ])("$label", ({ input, expected }) => {
    expect(parseSlashCommandInput(input)).toEqual(expected);
  });

  it("returns isCommand:true with the raw name even for invalid-name input (dispatcher returns not-found)", () => {
    // Per design §11.1 step 7 — invalid name patterns are still parsed
    // so the dispatcher can produce the right "Unknown slash command"
    // message (CMD-08). The parser stays permissive.
    const r = parseSlashCommandInput("/!invalid");
    expect(r.isCommand).toBe(true);
    expect(r.name).toBe("!invalid");
    expect(r.raw).toBe("/!invalid");
  });

  it("never mutates the input string (defensive — pure function)", () => {
    const input = "/review src";
    const snapshot = input;
    parseSlashCommandInput(input);
    expect(input).toBe(snapshot);
  });

  it("returned object exposes the original raw input verbatim (including leading whitespace)", () => {
    const r = parseSlashCommandInput("   /review");
    expect(r.raw).toBe("   /review");
  });
});
