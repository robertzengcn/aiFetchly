// src/service/slashCommands/expandPrompt.ts
// CMD-06 (Phase 15) — argument-token substitution for prompt-type commands.
//
// SECURITY (TRS-06): this file is a PURE LEAF module. It MUST NOT import
// anything — no fs, no Electron, no TypeORM, no Vue, no other service. The
// argument-token literal (the `$ARGUMENTS` syntax) is the FEATURE being
// implemented here; the Phase-13 grep gate that asserted zero occurrences
// of that literal under src/service/slashCommands/ is superseded for THIS
// file only (Plan 15-01). The parser file SlashCommandParser.ts remains
// pure and free of the literal — region-scoped, verified separately.
//
// Expansion is text-only: a literal split-and-join replace-all is used
// instead of a regex to avoid `$`-meta escaping pitfalls and to keep the
// operation transparent. NO dynamic-code-execution primitive is invoked.

/**
 * The argument token that a prompt-command body can use to embed the raw
 * args string the user typed after the command name (15-CONTEXT.md D-01).
 *
 * Phase 15 ships exactly this one token. Positional tokens (`$1`, `$2`),
 * context tokens (`$WORKSPACE_PATH`, `$CONVERSATION_ID`), and `\$ARGUMENTS`
 * escaping are deliberately OUT OF SCOPE (15-CONTEXT.md "Deferred Ideas").
 */
const ARGUMENT_TOKEN = "$ARGUMENTS";

/**
 * Render a prompt-command body, substituting the user-supplied args.
 *
 * Semantics (15-CONTEXT.md decisions D-01 + D-02):
 *
 *   - D-01 minimal whole-string substitution: if the body contains the
 *     argument token, EVERY occurrence is replaced with the entire args
 *     string. Multiple occurrences all receive the same value. The
 *     substitution is robust to the token appearing mid-word.
 *   - D-02 fail-safe append: if the body contains NO argument token AND
 *     `args` is non-empty, the args are appended after the body separated
 *     by a blank line (`body + "\n\n" + args`) so the user's input is
 *     never silently dropped when an author forgot the token.
 *   - If the body has no token and args is empty, the body is returned
 *     unchanged.
 *   - If the body has no token, args is empty, and the body is empty,
 *     the empty string is returned.
 *
 * Never throws — every branch returns a string. The CMD-06 frontmatter
 * validator (promptCommandFrontmatter.ts) rejects empty bodies before
 * they reach dispatch, but this function remains total so unit tests and
 * future callers do not need their own guard.
 *
 * Pure leaf module: no imports. Verified by a grep gate in the plan
 * acceptance criteria (TRS-06 invariant).
 *
 * @param body - The raw prompt-command body (markdown).
 * @param args - The raw args string the user typed after the command
 *   name (already split from the name by SlashCommandParser). Empty
 *   string when the user supplied no args.
 * @returns The rendered prompt string.
 */
export function expandPrompt(body: string, args: string): string {
  // Defensive: accept any input that coerces to a string shape without
  // throwing. The public signature is `(string, string)`; these guards
  // only protect against runtime misuse (a caller passing `undefined`
  // via a loosened type). They never change the documented semantics.
  const safeBody = typeof body === "string" ? body : "";
  const safeArgs = typeof args === "string" ? args : "";

  // D-01: token present -> literal replace-all of EVERY occurrence.
  // split(token).join(replacement) is the standard regex-free replace-all
  // in JavaScript; it handles the literal token verbatim regardless of
  // `$`-meta or other regex-special characters, and it is robust to the
  // token appearing mid-word, multiple times, or adjacent to itself.
  if (safeBody.includes(ARGUMENT_TOKEN)) {
    return safeBody.split(ARGUMENT_TOKEN).join(safeArgs);
  }

  // D-02: token absent + non-empty args -> append after a blank line so
  // the user's args survive even when the author forgot the token.
  if (safeArgs.length > 0) {
    return safeBody + "\n\n" + safeArgs;
  }

  // Token absent + empty args -> body unchanged (or empty string when
  // the body itself is empty).
  return safeBody;
}
