/**
 * parseRestrictedFrontmatter — CFG-07 hand-rolled restricted frontmatter parser.
 *
 * SECURITY RATIONALE (read before editing):
 * Workspace-scanned markdown files are untrusted model input. General-purpose
 * YAML libraries execute YAML tags (language-specific object/function tags) on
 * their DEFAULT schema, which is a remote-code-execution vector from untrusted
 * files. This parser deliberately supports ONLY two forms:
 *
 *   - scalar lines:    `key: value`
 *   - string arrays:   `key:\n  - item`
 *
 * Anything else — tag directives (`!!js/function`, `!ref`), nested maps,
 * quoted multiline strings, unterminated blocks, stray list items — causes the
 * parser to FAIL CLOSED (return null). The body after the closing delimiter is
 * preserved exactly, modulo CRLF / lone-CR normalisation to LF at the input
 * boundary (documented below).
 *
 * DO NOT replace this with a YAML library dependency anywhere under
 * src/service/aifetchlyConfig/. If richer YAML is ever required in a later
 * phase, load it with an explicit safe schema AND keep strict validation;
 * phase 13 needs no richer grammar than the two forms above. There is a
 * grep gate in this plan's acceptance criteria that asserts no such import
 * exists.
 */

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const OPENER_PREFIX = "---\n";
const CLOSER_LINE = "---";

export interface ParsedFrontmatter {
  /** Scalar `key: value` entries (value trimmed). */
  readonly scalars: ReadonlyMap<string, string>;
  /** String-array entries (`key:\n  - item`). */
  readonly arrays: ReadonlyMap<string, readonly string[]>;
  /** Exact bytes after the closing delimiter (LF-normalised). */
  readonly body: string;
}

/**
 * Flatten a {@link ParsedFrontmatter} into the plain record shape consumed by
 * {@link buildPromptCommandDefinition} / {@link buildAgentDefinition}
 * (`Record<string, string | readonly string[]>`). Scalars and arrays are
 * merged; on a key collision arrays win (matches the frontmatter grammar where
 * a key is either scalar or array, never both). Shared so command/agent
 * readers do not each reimplement it.
 */
export function frontmatterRecord(
  parsed: ParsedFrontmatter
): Record<string, string | readonly string[]> {
  const record: Record<string, string | readonly string[]> = {};
  for (const [key, value] of parsed.scalars) record[key] = value;
  for (const [key, value] of parsed.arrays) record[key] = value;
  return record;
}

/**
 * Parse the initial restricted frontmatter block of `text`.
 *
 * Returns null (fail closed) when:
 *   - `text` does not start with the exact opener line `---\n`
 *   - the opener is never followed by a closing `---` line
 *   - any header line is a YAML tag directive or holds a tagged value
 *   - any header line is indented (nested map or stray list item)
 *   - any header line has no colon (malformed)
 *   - any key contains characters outside [A-Za-z][A-Za-z0-9_.-]*
 *
 * Body preservation: the substring after the closing `---` line is returned
 * byte-for-byte (whitespace, embedded `---` lines, and trailing newlines are
 * all preserved). CRLF and lone CR in the input are normalised to LF before
 * parsing, so the returned body uses LF endings.
 */
export function parseRestrictedFrontmatter(
  text: string
): ParsedFrontmatter | null {
  if (typeof text !== "string") return null;

  // Normalise CRLF (Windows) and lone CR (classic Mac) to LF at the input
  // boundary. The grammar is line-oriented and operates on LF-delimited lines;
  // the returned body therefore uses LF endings. Callers that require the
  // exact original byte sequence should normalise before calling or handle
  // re-serialisation themselves.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Must start with the exact opener line. Any leading whitespace, a missing
  // trailing newline, or trailing whitespace on the opener fails closed.
  if (!normalized.startsWith(OPENER_PREFIX)) return null;

  const lines = normalized.split("\n");
  // lines[0] === "---" (the opener). Find the FIRST subsequent line equal to
  // "---". A later "---" inside the body is preserved as body content.
  let closerIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === CLOSER_LINE) {
      closerIdx = i;
      break;
    }
  }
  if (closerIdx === -1) return null; // unterminated block — fail closed

  const headerLines = lines.slice(1, closerIdx);
  // Rejoin the body with LF. split() drops the trailing newline as an empty
  // element; rejoining restores it (so "---\n...\n---\nbody\n" -> body "body\n").
  const body = lines.slice(closerIdx + 1).join("\n");

  const scalars = new Map<string, string>();
  const arrays = new Map<string, readonly string[]>();

  let i = 0;
  while (i < headerLines.length) {
    const line = headerLines[i];

    // Reject YAML tag directives anywhere in the header (CFG-07). A line that
    // begins (after optional whitespace) with "!" is a tag directive or a
    // tagged value — fail closed rather than risk execution.
    if (/^\s*!/.test(line)) return null;

    // Reject indented lines at the top level. The only valid indented form is
    // "  - item" inside an array context, which is consumed by the array
    // branch below. A stray indented line here is a nested map or a list
    // outside an array — both fail closed.
    if (/^\s/.test(line)) return null;

    // Top-level "key: value" or "key:".
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) return null; // malformed (no colon)
    const key = line.slice(0, colonIdx);
    if (!KEY_PATTERN.test(key)) return null; // invalid key characters
    const valueRaw = line.slice(colonIdx + 1);
    const valueTrimmed = valueRaw.trim();
    // Reject values that start with a YAML tag marker (e.g. "!!js/function ...").
    if (valueTrimmed.startsWith("!")) return null;

    // Array start: "key:" with empty value AND the next line is an indented
    // "- item" line. Otherwise "key:" is treated as a scalar with empty value
    // (the restricted grammar has no explicit empty-array marker).
    const nextLine = headerLines[i + 1];
    if (
      valueTrimmed === "" &&
      nextLine !== undefined &&
      /^\s+-\s?/.test(nextLine)
    ) {
      const items: string[] = [];
      let j = i + 1;
      while (j < headerLines.length) {
        const itemLine = headerLines[j];
        const itemMatch = itemLine.match(/^\s+-\s?(.*)$/);
        if (!itemMatch) break; // stop collecting at the first non-item line
        const itemValue = itemMatch[1].trim();
        if (itemValue.startsWith("!")) return null; // tag in array value
        items.push(itemValue);
        j++;
      }
      arrays.set(key, items);
      i = j;
    } else {
      scalars.set(key, valueTrimmed);
      i++;
    }
  }

  return { scalars, arrays, body };
}
