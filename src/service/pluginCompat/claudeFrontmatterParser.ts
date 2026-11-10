/**
 * Minimal YAML-frontmatter parser for Claude SKILL.md files.
 *
 * Supports a deliberately tiny subset of YAML:
 *   - key: value (single-line, string)
 *   - key: true | false
 *   - key: <integer>
 *   - key: [a, b, c]            (flow-style array of strings)
 *   - key:
 *       - a                     (block-style array of strings)
 *       - b
 *   - key: >                    (folded block scalar; newlines become spaces)
 *   - key: |                    (literal block scalar)
 *
 * Nested maps (`metadata:` followed by indented `child:` lines) are skipped
 * so child keys are not promoted to the top level. Anything else beyond this
 * subset is skipped rather than thrown. Callers that need strict rejection
 * (e.g. the Claude skill adapter) validate required fields afterwards and
 * produce a structured `claude-frontmatter-invalid` error.
 *
 * No external dependencies. Hand-rolled to keep the bundle small and
 * force fail-fast on constructs we don't support.
 */

export interface ParsedFrontmatter {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

const FLOW_ARRAY_RE = /^\[(.*)\]$/;
/** `>`, `|`, with optional chomp (`-`/`+`) and an indent digit. */
const BLOCK_SCALAR_RE = /^([>|])([+-]?)(\d*)$/;

function parseFlowArray(value: string): unknown[] | null {
  const match = value.match(FLOW_ARRAY_RE);
  if (!match) return null;
  const inner = match[1].trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
}

/**
 * Render a YAML block scalar. `>` folds wrapped lines into spaces and keeps
 * blank lines as paragraph breaks. `|` keeps line breaks. Leading indent is
 * stripped from the least-indented content line.
 */
function renderBlockScalar(lines: readonly string[], style: ">" | "|"): string {
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  const stripped = lines.map((line) => {
    if (line.trim().length === 0) return "";
    return line.slice(Math.min(minIndent, line.length)).trimEnd();
  });

  if (style === "|") {
    return stripped.join("\n").trim();
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of stripped) {
    if (line.trim().length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(line.trim());
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs.join("\n\n").trim();
}

/**
 * Index of the first line at `start` that is a new top-level key (or the
 * closing delimiter). Blank lines and indented continuation lines are part
 * of the current block.
 */
function endOfIndentedBlock(lines: readonly string[], start: number): number {
  let j = start;
  while (j < lines.length) {
    const candidate = lines[j];
    if (candidate.trim() === "---") break;
    if (candidate.trim().length === 0) {
      let k = j + 1;
      while (k < lines.length && lines[k].trim().length === 0) k += 1;
      const next = lines[k];
      if (
        next === undefined ||
        next.trim() === "---" ||
        !/^\s/.test(next)
      ) {
        break;
      }
      j += 1;
      continue;
    }
    if (/^\s/.test(candidate)) {
      j += 1;
      continue;
    }
    break;
  }
  return j;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, unknown> = {};
  let bodyStartIndex = lines.length; // fallback if no closing delimiter

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") {
      bodyStartIndex = i + 1;
      break;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const sep = trimmed.indexOf(":");
    if (sep <= 0) continue;

    const key = trimmed.slice(0, sep).trim();
    const rawValue = trimmed.slice(sep + 1).trim();

    if (rawValue.length === 0) {
      const next = lines[i + 1];
      // Block-style array: `key:` followed by `  - item` lines.
      if (next !== undefined && /^\s+-\s?/.test(next)) {
        const blockValues: string[] = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          const candidate = lines[j];
          if (candidate.trim() === "---") break;
          const blockMatch = candidate.match(/^\s+-\s+(.*)$/);
          if (blockMatch) {
            blockValues.push(blockMatch[1].trim().replace(/^["']|["']$/g, ""));
            i = j;
          } else {
            break;
          }
        }
        if (blockValues.length > 0) {
          frontmatter[key] = blockValues;
        }
        continue;
      }
      // Nested map (`metadata:` / `author:`). Skip it so child keys are not
      // promoted to the top level. Slash commands only need the scalars.
      if (next !== undefined && /^\s/.test(next)) {
        const end = endOfIndentedBlock(lines, i + 1);
        i = end - 1;
      }
      continue;
    }

    const blockScalar = rawValue.match(BLOCK_SCALAR_RE);
    if (blockScalar) {
      const style = blockScalar[1] === "|" ? "|" : ">";
      const end = endOfIndentedBlock(lines, i + 1);
      frontmatter[key] = renderBlockScalar(lines.slice(i + 1, end), style);
      i = end - 1;
      continue;
    }

    // Boolean
    if (rawValue === "true" || rawValue === "false") {
      frontmatter[key] = rawValue === "true";
      continue;
    }

    // Integer
    if (/^-?\d+$/.test(rawValue)) {
      frontmatter[key] = parseInt(rawValue, 10);
      continue;
    }

    // Flow-style array
    const flow = parseFlowArray(rawValue);
    if (flow !== null) {
      frontmatter[key] = flow;
      continue;
    }

    // Plain string
    frontmatter[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  const body = lines.slice(bodyStartIndex).join("\n");
  return { frontmatter, body };
}
