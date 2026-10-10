/**
 * Pure frontmatter split helpers shared by the sync coordinator and the
 * portable memory service (design §7.3). Kept dependency-free so both the
 * main process and tests can import them.
 */

import yaml from "js-yaml";

/** Strict syntactic split of YAML frontmatter from a Markdown body. */
export function splitFrontmatter(
  text: string
): {
  readonly raw: unknown;
  readonly body: string;
  readonly error?: string;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      raw: null,
      body: normalized,
      error: "file must start with a '---' frontmatter fence",
    };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return {
      raw: null,
      body: normalized,
      error: "unterminated frontmatter fence",
    };
  }
  const yamlText = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  try {
    const parsed = yaml.load(yamlText, { schema: yaml.JSON_SCHEMA }) as unknown;
    return { raw: parsed, body };
  } catch (err) {
    return {
      raw: null,
      body,
      error: `invalid YAML frontmatter: ${
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      }`,
    };
  }
}

/** Parse the YAML frontmatter block of a serialized record (or null). */
export function parseYamlFrontmatter(content: string): unknown {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) return null;
  try {
    return yaml.load(content.slice(4, end));
  } catch {
    return null;
  }
}

/** Strip the frontmatter block from a serialized record; return the body. */
export function stripFrontmatterBlock(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) return content;
  return content.slice(end + 5);
}
