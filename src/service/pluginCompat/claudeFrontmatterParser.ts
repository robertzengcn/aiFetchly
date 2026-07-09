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
 *
 * Anything beyond this subset causes the parser to skip the offending
 * line rather than throw. Callers that need strict rejection (e.g. the
 * Claude skill adapter) validate required fields afterwards and produce
 * a structured `claude-frontmatter-invalid` error.
 *
 * No external dependencies. Hand-rolled to keep the bundle small and
 * force fail-fast on constructs we don't support.
 */

export interface ParsedFrontmatter {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

const FLOW_ARRAY_RE = /^\[(.*)\]$/;

function parseFlowArray(value: string): unknown[] | null {
  const match = value.match(FLOW_ARRAY_RE);
  if (!match) return null;
  const inner = match[1].trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
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
      // Could be start of block-style array; peek subsequent lines.
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
