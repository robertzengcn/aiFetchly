/**
 * Compound command splitter.
 *
 * Walks the lexer output and produces "segments" — maximal runs of words
 * separated by command-combining operators (`&&`, `||`, `|`, `;`). Each
 * segment carries its own list of redirections so the path layer can validate
 * them independently.
 *
 * Matches Claude Code's behavior: pipe segments are validated independently,
 * and the original command is revalidated after stripping redirects so a
 * stripped redirect can't bypass a check.
 */

import type { ShellToken } from "./ShellLexer";

export interface Redirection {
  /** Raw text of the redirect target (may be a $expansion — caller rejects). */
  readonly target: string;
  /** True if the target token was non-literal ($VAR, $(...), backtick). */
  readonly nonLiteral: boolean;
  /** Source operator text, e.g. `>`, `>>`, `<`, `2>`. */
  readonly operator: string;
  /** Direction of the redirect. */
  readonly direction: "in" | "out";
}

export interface CommandSegment {
  /** argv-style word texts for the command + args (excluding redirects). */
  readonly words: readonly string[];
  /** True if any word was quoted, expanded, or non-literal. */
  readonly hasNonLiteral: boolean;
  /** Redirections associated with this segment. */
  readonly redirects: readonly Redirection[];
  /** True if the segment is empty (e.g. trailing `;` or `&&`). */
  readonly empty: boolean;
  /** Raw source span, for diagnostics. */
  readonly raw: string;
}

const REDIRECT_OPS = new Set(["op_redirect_out", "op_redirect_in", "op_redirect_fd"]);

/**
 * Split tokens into segments. Tokens that aren't words or redirects and
 * aren't separators (e.g. `op_background`, parens) are surfaced — the caller
 * should already have rejected the input via the hazard layer before reaching
 * this point, so we treat them as segment terminators here.
 */
export function splitCompound(tokens: readonly ShellToken[]): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let words: string[] = [];
  let hasNonLiteral = false;
  let redirects: Redirection[] = [];
  let rawStart = 0;

  const flush = (rawEnd: number): void => {
    const raw = tokens.length
      ? tokens.slice(rawStart, rawEnd).map((t) => t.text).join(" ")
      : "";
    segments.push({
      words,
      hasNonLiteral,
      redirects,
      empty: words.length === 0 && redirects.length === 0,
      raw,
    });
    words = [];
    hasNonLiteral = false;
    redirects = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.kind === "word") {
      words.push(tok.text);
      if (!tok.literal || tok.expanded || tok.quoted) hasNonLiteral = true;
      continue;
    }

    if (REDIRECT_OPS.has(tok.kind)) {
      // Expect a target word next
      const next = tokens[i + 1];
      if (!next || next.kind !== "word") {
        // Missing redirect target — flag as non-literal so the path layer
        // can't accidentally approve (this is `>` with no target, which
        // bash treats as a syntax error anyway).
        redirects.push({
          target: "",
          nonLiteral: true,
          operator: tok.text,
          direction: tok.kind === "op_redirect_in" ? "in" : "out",
        });
        continue;
      }
      redirects.push({
        target: next.text,
        nonLiteral: !next.literal || next.expanded,
        operator: tok.text,
        direction: tok.kind === "op_redirect_in" ? "in" : "out",
      });
      i++; // consume target
      continue;
    }

    // Separators
    if (
      tok.kind === "op_and" ||
      tok.kind === "op_or" ||
      tok.kind === "op_pipe" ||
      tok.kind === "op_semi" ||
      tok.kind === "op_background" ||
      tok.kind === "op_subshell_open" ||
      tok.kind === "op_subshell_close"
    ) {
      flush(i);
      rawStart = i + 1;
      continue;
    }

    // Unknown / unanalyzable — terminate segment
    flush(i);
    rawStart = i + 1;
  }

  flush(tokens.length - 1);
  return segments;
}
