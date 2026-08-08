/**
 * CMD-06 (Phase 15) — expandPrompt unit tests.
 *
 * expandPrompt is a PURE, zero-import function that implements the
 * Phase-1 argument-token substitution semantics locked by 15-CONTEXT.md:
 *
 *   - D-01 minimal whole-string substitution: every occurrence of the
 *     argument token is replaced with the entire args string the user
 *     typed after the command name.
 *   - D-02 fail-safe append: when the body contains NO argument token
 *     AND args are non-empty, the args are appended after the body,
 *     separated by a blank line.
 *   - When the body has no token and args are empty, the body is
 *     returned unchanged.
 *
 * Pure-leaf invariant (TRS-06): the function MUST NOT import fs,
 * Electron, TypeORM, Vue, or any other service — verified separately by
 * a grep gate. This test file exercises the seven behavior cases listed
 * in the plan's <behavior> block.
 */
import { describe, expect, it } from "vitest";
import { expandPrompt } from "@/service/slashCommands/expandPrompt";

describe("expandPrompt (CMD-06 / Phase 15 — D-01 + D-02)", () => {
  it.each([
    {
      label: "single occurrence — substitutes args verbatim",
      body: "Review $ARGUMENTS please",
      args: "src/service",
      expected: "Review src/service please",
    },
    {
      label: "multiple occurrences — D-01 replaces EVERY occurrence",
      body: "Review $ARGUMENTS and again $ARGUMENTS",
      args: "x",
      expected: "Review x and again x",
    },
    {
      label: "token absent + non-empty args — D-02 appends with blank line",
      body: "Review this",
      args: "src/a",
      expected: "Review this\n\nsrc/a",
    },
    {
      label: "token absent + empty args — body unchanged",
      body: "Review this",
      args: "",
      expected: "Review this",
    },
    {
      label: "token present + empty args — token replaced with empty string (no append)",
      body: "Review $ARGUMENTS now",
      args: "",
      expected: "Review  now",
    },
    {
      label: "token mid-word — robust to non-standalone placement",
      body: "pre$ARGUMENTS post",
      args: "X",
      expected: "preX post",
    },
    {
      label: "empty body + empty args — returns empty string, never throws",
      body: "",
      args: "",
      expected: "",
    },
  ])("$label", ({ body, args, expected }) => {
    expect(expandPrompt(body, args)).toBe(expected);
  });

  it("never throws on non-string input shape contract (returns a string)", () => {
    // The validator (Task 2) rejects empty bodies before they reach
    // dispatch, but expandPrompt itself must remain total — every
    // branch returns a string.
    expect(typeof expandPrompt("just body", "")).toBe("string");
    expect(typeof expandPrompt("", "leftover-args")).toBe("string");
  });

  it("D-02 does NOT append when the token is present (substitution only)", () => {
    // If the body uses the token, args are substituted only at the token
    // — they are NOT also appended at the end.
    const out = expandPrompt("$ARGUMENTS end", "payload");
    expect(out).toBe("payload end");
    expect(out.endsWith("payload\n\npayload")).toBe(false);
  });
});
