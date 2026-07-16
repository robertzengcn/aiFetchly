// src/service/slashCommands/SlashCommandParser.ts
// Pure input classifier for slash commands (CMD-02).
//
// The parser's only job is to classify raw composer text into one of:
//   - not a command           (empty, no leading `/`, or leading `//`)
//   - suggest-only            (bare `/`, no name — opens dropdown)
//   - parsed command          (name + optional args)
//
// It does NOT consult any command store, validate command existence, or
// perform any prompt expansion. Plan 03's SlashCommandDispatcher composes
// parser + a command store to resolve commands.
//
// Phase-15 boundary (TRS-06 / CMD-06): Phase 15 will add argument-token
// substitution in the DISPATCHER (PromptCommand text expansion), NOT here.
// This parser only classifies input. Phase 13 built-ins take no arguments.

import type { ParsedSlashCommandInput } from "@/entityTypes/slashCommandTypes";

/**
 * Whitespace matcher for left-trim and the name/args split.
 * Covers space, tab, newline, carriage return, and other Unicode
 * whitespace per `\s`.
 */
const WHITESPACE = /\s/;

/**
 * Classify raw composer text into a {@link ParsedSlashCommandInput}.
 *
 * Algorithm (design §11.1):
 *   1. Left-trim the input.
 *   2. If empty OR does not start with "/": not a command.
 *   3. If it starts with "//": not a command (escaped or comment).
 *   4. isCommand = true.
 *   5. If the remainder after "/" is empty or all whitespace:
 *      suggest-only (name=undefined, args=undefined).
 *   6. Otherwise: split on the FIRST run of whitespace. name = token
 *      before; args = everything after (preserving internal whitespace).
 *      If no whitespace, name = entire remainder, args = undefined.
 *   7. Permissive on invalid name patterns — return isCommand:true with
 *      the raw name; the dispatcher produces the not-found message
 *      (CMD-08). This keeps the parser's contract narrow.
 *
 * Pure: no command-store, IPC, Electron, or Module imports. The only import
 * is the shared {@link ParsedSlashCommandInput} type.
 */
export function parseSlashCommandInput(raw: string): ParsedSlashCommandInput {
  // 1. Left-trim — find the first non-whitespace character.
  let start = 0;
  while (start < raw.length && WHITESPACE.test(raw.charAt(start))) {
    start++;
  }
  const trimmed = raw.slice(start);

  // 2. Empty or non-`/`-leading → not a command.
  if (trimmed.length === 0 || trimmed.charAt(0) !== "/") {
    return { isCommand: false, raw };
  }

  // 3. `//` (or `///`) → not a command.
  if (trimmed.length >= 2 && trimmed.charAt(1) === "/") {
    return { isCommand: false, raw };
  }

  // 5. Bare `/` or `/` + whitespace → suggest-only (no name).
  // After step 3 we know char 0 is "/" and char 1 (if any) is not "/".
  // Find the first non-whitespace character after the leading "/".
  let i = 1;
  while (i < trimmed.length && WHITESPACE.test(trimmed.charAt(i))) {
    i++;
  }
  if (i >= trimmed.length) {
    return { isCommand: true, name: undefined, args: undefined, raw };
  }

  // 6. Split on the first run of whitespace after the name token.
  // name = [i, nameEnd); args = remainder after the whitespace run.
  let nameEnd = i;
  while (
    nameEnd < trimmed.length &&
    !WHITESPACE.test(trimmed.charAt(nameEnd))
  ) {
    nameEnd++;
  }
  const name = trimmed.slice(i, nameEnd);

  let args: string | undefined;
  if (nameEnd >= trimmed.length) {
    // No trailing whitespace — args is undefined.
    args = undefined;
  } else {
    // Skip the whitespace run between name and args.
    let argsStart = nameEnd;
    while (
      argsStart < trimmed.length &&
      WHITESPACE.test(trimmed.charAt(argsStart))
    ) {
      argsStart++;
    }
    if (argsStart >= trimmed.length) {
      // Trailing whitespace only (e.g. "/review ") — no real args.
      args = undefined;
    } else {
      // Preserve internal whitespace in args (only the first run was
      // consumed as the name/args separator).
      args = trimmed.slice(argsStart);
    }
  }

  // 7. Permissive on name validity — return the raw token; the
  // dispatcher decides not-found (CMD-08). No validation here.
  return { isCommand: true, name, args, raw };
}
