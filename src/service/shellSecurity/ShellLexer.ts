/**
 * ShellLexer — character-aware shell tokenizer.
 *
 * The single source of structural truth for the permission layer. We do NOT
 * attempt to fully parse bash grammar (that would require tree-sitter and
 * native bindings, which are painful in Electron builds). Instead we tokenize
 * carefully enough to detect the structural hazards that matter for security:
 *
 *   - quote tracking (single/double) so we don't mis-detect operators inside
 *     strings, and so we know whether a token was expanded by bash
 *   - operator recognition: `&&`, `||`, `|`, `;`, `>`, `>>`, `>&`, `<`, `2>`,
 *     `&>`
 *   - unanalyzable constructs: command substitution `$(...)`, backticks,
 *     process substitution `>(...)` / `<(...)`, arithmetic `$((...))`,
 *     parameter expansion `${...}` and bare `$VAR` in command position
 *
 * Anything we cannot confidently classify is surfaced via `unanalyzable` so
 * the permission layer can degrade to `ask` (matching Claude Code's
 * "parser differentials are security-sensitive" principle).
 */

// ---------------------------------------------------------------------------
// Token model
// ---------------------------------------------------------------------------

export type TokenKind =
  | "word" // a plain or quoted argument / command token
  | "op_and" // &&
  | "op_or" // ||
  | "op_pipe" // |
  | "op_semi" // ;
  | "op_redirect_out" // > or >>
  | "op_redirect_in" // <
  | "op_redirect_fd" // 2>, &>, 1>, 2>>
  | "op_background" // &
  | "op_subshell_open" // (
  | "op_subshell_close" // )
  | "unanalyzable"; // any construct we refuse to reason about

export interface ShellToken {
  readonly kind: TokenKind;
  /** The raw source text of the token. */
  readonly text: string;
  /** True if the token contained any single- or double-quoted region. */
  readonly quoted: boolean;
  /** True if the token was produced by an expansion ($..., backtick). */
  readonly expanded: boolean;
  /**
   * True if the token's literal value is known statically. Quoted-only tokens
   * are literal; tokens containing $ or unquoted backticks are NOT literal.
   */
  readonly literal: boolean;
  /** Start offset in the original source (for diagnostics). */
  readonly start: number;
}

export interface LexResult {
  readonly tokens: readonly ShellToken[];
  /**
   * Set when the lexer hit a construct it refused to classify. The permission
   * layer treats any non-empty list here as "ask for approval".
   */
  readonly unanalyzable: readonly string[];
  /** True if the input contained a heredoc (`<<EOF` or `<<-EOF`). */
  readonly hasHeredoc: boolean;
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

const OPERATOR_STARTS = new Set(["&", "|", ";", ">", "<", "(", ")"]);

export function lex(command: string): LexResult {
  const tokens: ShellToken[] = [];
  const unanalyzable: string[] = [];
  let hasHeredoc = false;

  const src = command;
  const len = src.length;
  let i = 0;

  while (i < len) {
    const ch = src[i];

    // Whitespace — skip between tokens
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Line comments — rest of line is non-executing text but still suspicious
    // if it precedes a newline + command. We skip the comment.
    if (ch === "#") {
      while (i < len && src[i] !== "\n") i++;
      continue;
    }

    // Operators
    if (OPERATOR_STARTS.has(ch)) {
      const two = src.slice(i, i + 2);
      const three = src.slice(i, i + 3);
      if (three === ">>&" || three === "2>&" || three === "1>&" || three === "&>") {
        tokens.push({
          kind: "op_redirect_fd",
          text: three,
          quoted: false,
          expanded: false,
          literal: false,
          start: i,
        });
        i += 3;
        continue;
      }
      if (two === "&&") {
        tokens.push({ kind: "op_and", text: two, quoted: false, expanded: false, literal: true, start: i });
        i += 2;
        continue;
      }
      if (two === "||") {
        tokens.push({ kind: "op_or", text: two, quoted: false, expanded: false, literal: true, start: i });
        i += 2;
        continue;
      }
      if (two === ">>") {
        tokens.push({
          kind: "op_redirect_out",
          text: two,
          quoted: false,
          expanded: false,
          literal: true,
          start: i,
        });
        i += 2;
        continue;
      }
      if (two === "<<") {
        // Heredoc — the lexer does not consume the body; we just flag it.
        // Heredocs can hide arbitrary commands so we treat them as unanalyzable.
        hasHeredoc = true;
        unanalyzable.push("heredoc (<<)");
        // Advance past the delimiter token (e.g., EOF or 'EOF')
        i += 2;
        while (i < len && /[A-Za-z0-9_-]/.test(src[i])) i++;
        continue;
      }
      if (ch === ">") {
        // Check for process substitution >(...)
        if (src[i + 1] === "(") {
          unanalyzable.push("process substitution >( ... )");
          // Skip past the balanced parens
          i = skipBalancedParens(src, i + 1);
          continue;
        }
        tokens.push({
          kind: "op_redirect_out",
          text: ch,
          quoted: false,
          expanded: false,
          literal: true,
          start: i,
        });
        i++;
        // FD prefix like 2> already captured as a separate token if leading;
        // a trailing > with no space after `2` is handled below in word lex.
        continue;
      }
      if (ch === "<") {
        if (src[i + 1] === "(") {
          unanalyzable.push("process substitution <( ... )");
          i = skipBalancedParens(src, i + 1);
          continue;
        }
        tokens.push({
          kind: "op_redirect_in",
          text: ch,
          quoted: false,
          expanded: false,
          literal: true,
          start: i,
        });
        i++;
        continue;
      }
      if (ch === "|") {
        tokens.push({ kind: "op_pipe", text: ch, quoted: false, expanded: false, literal: true, start: i });
        i++;
        continue;
      }
      if (ch === ";") {
        tokens.push({ kind: "op_semi", text: ch, quoted: false, expanded: false, literal: true, start: i });
        i++;
        continue;
      }
      if (ch === "&") {
        tokens.push({
          kind: "op_background",
          text: ch,
          quoted: false,
          expanded: false,
          literal: true,
          start: i,
        });
        i++;
        continue;
      }
      if (ch === "(") {
        tokens.push({
          kind: "op_subshell_open",
          text: ch,
          quoted: false,
          expanded: false,
          literal: true,
          start: i,
        });
        i++;
        continue;
      }
      if (ch === ")") {
        tokens.push({
          kind: "op_subshell_close",
          text: ch,
          quoted: false,
          expanded: false,
          literal: true,
          start: i,
        });
        i++;
        continue;
      }
    }

    // FD-prefixed redirect like `2>` or `2>>` at the start of a token
    if (/[0-9]/.test(ch) && (src[i + 1] === ">" || src[i + 1] === "<")) {
      const fdLen = countLeadingDigits(src, i);
      const fdNum = src.slice(i, i + fdLen);
      const opStart = i + fdLen;
      const opChar = src[opStart];
      const nextChar = src[opStart + 1];
      const isDouble = nextChar === opChar;
      const opText = src.slice(i, opStart + (isDouble ? 2 : 1));
      tokens.push({
        kind: "op_redirect_fd",
        text: opText,
        quoted: false,
        expanded: false,
        literal: true,
        start: i,
      });
      i += opText.length;
      // Note: we don't treat `2>` itself as unanalyzable, but the target word
      // will be validated downstream by the path layer.
      // If the FD points into an expansion like `2>$1`, the target word lex
      // will mark it non-literal and the path layer rejects.
      void fdNum;
      continue;
    }

    // Otherwise, it's a word token (command or argument). Lex with quote
    // awareness so we can correctly decide whether the value is literal.
    const word = lexWord(src, i, unanalyzable);
    tokens.push(word.token);
    i = word.next;
  }

  return { tokens, unanalyzable, hasHeredoc };
}

// ---------------------------------------------------------------------------
// Word lexer
// ---------------------------------------------------------------------------

interface WordLexResult {
  readonly token: ShellToken;
  readonly next: number;
}

function lexWord(
  src: string,
  start: number,
  unanalyzable: string[]
): WordLexResult {
  let i = start;
  let quoted = false;
  let expanded = false;
  let literal = true;
  let text = "";

  const isWordBreak = (c: string): boolean =>
    c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === "\r" ||
    OPERATOR_STARTS.has(c) ||
    // A digit followed by > or < breaks the word (FD redirect)
    (/[0-9]/.test(c) && (src[i + 1] === ">" || src[i + 1] === "<"));

  while (i < src.length && !isWordBreak(src[i])) {
    const c = src[i];

    // Single-quoted region — literal, no expansion
    if (c === "'") {
      quoted = true;
      // Mark as unanalyzable only if we already had expansion; otherwise
      // single-quoted content is fully literal.
      i++;
      while (i < src.length && src[i] !== "'") {
        text += src[i];
        i++;
      }
      if (i < src.length) i++; // skip closing quote
      continue;
    }

    // Double-quoted region — literal except for $ and ` triggers
    if (c === '"') {
      quoted = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        const dc = src[i];
        if (dc === "\\") {
          // Inside double quotes, \ only escapes $ ` " \ newline
          text += src[i];
          text += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (dc === "$") {
          expanded = true;
          literal = false;
          // Detect $(...) command substitution inside double quotes
          if (src[i + 1] === "(") {
            unanalyzable.push("command substitution $(...) inside double quotes");
            i = skipBalancedParens(src, i + 1);
            text += "$(...)";
            continue;
          }
          text += dc;
          i++;
          continue;
        }
        if (dc === "`") {
          expanded = true;
          literal = false;
          unanalyzable.push("backtick command substitution inside double quotes");
          // Skip until closing backtick
          i++;
          while (i < src.length && src[i] !== "`") i++;
          if (i < src.length) i++;
          text += "`...`";
          continue;
        }
        text += dc;
        i++;
      }
      if (i < src.length) i++; // skip closing quote
      continue;
    }

    // Backslash escape outside quotes
    if (c === "\\") {
      text += src[i];
      text += src[i + 1] ?? "";
      i += 2;
      continue;
    }

    // Unquoted $ — parameter / command / arithmetic substitution
    if (c === "$") {
      expanded = true;
      literal = false;
      const next = src[i + 1];
      if (next === "(") {
        if (src[i + 2] === "(") {
          unanalyzable.push("arithmetic expansion $((...))");
          i = skipBalancedParens(src, i + 2);
          // skipBalancedParens consumed one paren; the second ")" remains
          if (src[i] === ")") i++;
          text += "$((...))";
          continue;
        }
        unanalyzable.push("command substitution $(...)");
        i = skipBalancedParens(src, i + 1);
        text += "$(...)";
        continue;
      }
      if (next === "{") {
        // Parameter expansion ${VAR} — analyzable but non-literal
        i += 2;
        while (i < src.length && src[i] !== "}") i++;
        if (i < src.length) i++;
        text += "${...}";
        continue;
      }
      // Bare $VAR — non-literal but analyzable
      i++;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) {
        i++;
      }
      text += "$VAR";
      continue;
    }

    // Unquoted backtick — command substitution
    if (c === "`") {
      expanded = true;
      literal = false;
      unanalyzable.push("backtick command substitution");
      i++;
      while (i < src.length && src[i] !== "`") i++;
      if (i < src.length) i++;
      text += "`...`";
      continue;
    }

    // Plain character
    text += c;
    i++;
  }

  return {
    token: { kind: "word", text, quoted, expanded, literal, start },
    next: i,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countLeadingDigits(src: string, from: number): number {
  let n = 0;
  while (from + n < src.length && /[0-9]/.test(src[from + n])) n++;
  return n;
}

/**
 * Skip a balanced `(...)` group starting at `openIdx` (which points to "(").
 * Returns the index AFTER the closing ")".
 *
 * Used for command / process substitution. We don't try to interpret the
 * inner content — we just consume it and let the caller mark it unanalyzable.
 */
function skipBalancedParens(src: string, openIdx: number): number {
  // openIdx points at "("
  let depth = 0;
  let i = openIdx;
  let inSingle = false;
  let inDouble = false;
  while (i < src.length) {
    const c = src[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === "\\" && i + 1 < src.length) {
        i += 2;
        continue;
      }
      if (c === '"') inDouble = false;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "(") {
      depth++;
      i++;
      continue;
    }
    if (c === ")") {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return i;
}
