/**
 * STUB — RED phase of TDD for the restricted frontmatter parser (CFG-07).
 *
 * The real implementation lands in the GREEN commit. This stub exists so the
 * test suite compiles and the assertions fail (tests expect non-null results;
 * the stub always returns null).
 *
 * Security note (CFG-07): this file MUST NOT depend on any general-purpose
 * YAML library. The restricted grammar (scalars + string arrays only) is
 * hand-rolled to guarantee YAML tags can never execute. See the GREEN commit
 * for the full rationale.
 */

export interface ParsedFrontmatter {
  readonly scalars: ReadonlyMap<string, string>;
  readonly arrays: ReadonlyMap<string, readonly string[]>;
  readonly body: string;
}

export function parseRestrictedFrontmatter(
  _text: string
): ParsedFrontmatter | null {
  return null;
}
