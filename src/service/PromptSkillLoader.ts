/**
 * PromptSkillLoader — bounded SKILL.md parsing (design §10.2, PRD §13.1).
 *
 * Loads a portable prompt-skill manifest from a skill root directory:
 *   - accepts real directories, POSIX symlinks, and Windows junctions
 *     (readdir Dirent isDirectory() returns true for junctions/symlinked
 *     dirs on Windows only with realpath checks — we realpath first);
 *   - enforces the 256 KiB SKILL.md size cap BEFORE reading;
 *   - parses supported YAML frontmatter through the restricted parser and
 *     preserves unknown fields (never executed);
 *   - validates name/description and derives conservative fallbacks from the
 *     directory name and first heading;
 *   - hashes the exact bytes (SHA-256) so invocation can verify the file has
 *     not changed since registration;
 *   - performs NO execution of any kind (NFR-10: loading never runs
 *     commands, helpers, hooks, or network requests).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { parseRestrictedFrontmatter } from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";
import type { PromptSkillManifest } from "@/entityTypes/promptSkillTypes";

export const SKILL_MD_FILE = "SKILL.md";
export const SKILL_MD_MAX_BYTES = 256 * 1024;

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const DESCRIPTION_MAX_CHARS = 1024;

export interface LoadedPromptSkillFile {
  readonly manifest: PromptSkillManifest;
  readonly body: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
}

export type PromptSkillLoadResult =
  | { readonly ok: true; readonly file: LoadedPromptSkillFile }
  | {
      readonly ok: false;
      readonly code:
        | "SKILL_MD_MISSING"
        | "SKILL_MD_TOO_LARGE"
        | "SKILL_MD_NOT_REGULAR_FILE"
        | "SKILL_MD_FRONTMATTER_INVALID"
        | "SKILL_MD_ENCODING_INVALID"
        | "SKILL_MD_REALPATH_FAILED";
      readonly message: string;
    };

/** Resolve the canonical skill root (follows symlinks/junctions; bounded). */
export function canonicalizeSkillRoot(rootDir: string): string | null {
  try {
    const resolved = path.resolve(rootDir);
    if (!fs.existsSync(resolved)) return null;
    const real = fs.realpathSync(resolved);
    const stat = fs.statSync(real); // stat follows links — junctions included
    if (!stat.isDirectory()) return null;
    return real;
  } catch {
    return null;
  }
}

export function loadSkillMarkdownFile(
  skillRootDir: string
): PromptSkillLoadResult {
  let canonicalRoot: string;
  try {
    const resolved = canonicalizeSkillRoot(skillRootDir);
    if (!resolved) {
      return {
        ok: false,
        code: "SKILL_MD_REALPATH_FAILED",
        message: `Skill root does not resolve to a directory: ${skillRootDir}`,
      };
    }
    canonicalRoot = resolved;
  } catch {
    return {
      ok: false,
      code: "SKILL_MD_REALPATH_FAILED",
      message: `Failed to resolve skill root: ${skillRootDir}`,
    };
  }

  const mdPath = path.join(canonicalRoot, SKILL_MD_FILE);
  let stat: fs.Stats;
  try {
    // lstat then stat: a SYMLINKED SKILL.md is acceptable only when its
    // target stays inside the canonical root (PRD §20.3).
    stat = fs.statSync(mdPath);
  } catch {
    return {
      ok: false,
      code: "SKILL_MD_MISSING",
      message: `No ${SKILL_MD_FILE} in ${skillRootDir}`,
    };
  }
  if (!stat.isFile()) {
    return {
      ok: false,
      code: "SKILL_MD_NOT_REGULAR_FILE",
      message: `${SKILL_MD_FILE} is not a regular file`,
    };
  }
  if (stat.size > SKILL_MD_MAX_BYTES) {
    return {
      ok: false,
      code: "SKILL_MD_TOO_LARGE",
      message: `${SKILL_MD_FILE} is ${stat.size} bytes (limit ${SKILL_MD_MAX_BYTES})`,
    };
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(mdPath);
  } catch {
    return {
      ok: false,
      code: "SKILL_MD_MISSING",
      message: `Failed to read ${SKILL_MD_FILE}`,
    };
  }

  // Reject invalid text encoding: lone surrogates / NUL bytes.
  const text = bytes.toString("utf-8");
  if (
    text.includes("\0") ||
    /[\uD800-\uDFFF]/.test(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))
  ) {
    return {
      ok: false,
      code: "SKILL_MD_ENCODING_INVALID",
      message: `${SKILL_MD_FILE} is not valid UTF-8 text`,
    };
  }

  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const manifest = parseSkillManifest(text, path.basename(canonicalRoot));
  if (!manifest) {
    return {
      ok: false,
      code: "SKILL_MD_FRONTMATTER_INVALID",
      message: `${SKILL_MD_FILE} frontmatter failed restricted parse`,
    };
  }
  const body = extractBody(text);

  return {
    ok: true,
    file: { manifest, body, contentHash, sizeBytes: bytes.length },
  };
}

/**
 * Parse the manifest. Frontmatter is OPTIONAL — a bare markdown body is a
 * valid portable skill whose name falls back to the directory name.
 */
export function parseSkillManifest(
  text: string,
  directoryFallbackName: string
): PromptSkillManifest | null {
  let scalars: ReadonlyMap<string, string> = new Map();
  let arrays: ReadonlyMap<string, readonly string[]> = new Map();
  let body = text;

  const parsed = parseRestrictedFrontmatter(text);
  if (parsed !== null) {
    scalars = parsed.scalars;
    arrays = parsed.arrays;
    body = parsed.body;
  }

  // Derive a conservative fallback name/description when frontmatter is
  // absent or incomplete (design §10.2).
  const firstHeading = (body.match(/^#{1,3}\s+(.+)$/m)?.[1] ?? "").trim();
  const declaredName = scalars.get("name")?.trim() ?? "";
  const name =
    declaredName !== "" && NAME_RE.test(declaredName)
      ? declaredName
      : normalizeFallbackName(directoryFallbackName, firstHeading);
  if (!NAME_RE.test(name)) return null;

  const description = clampDescription(
    scalars.get("description")?.trim() ||
      (firstHeading !== ""
        ? `${name}: ${firstHeading}`
        : `${name} prompt skill`)
  );

  const allowedTools = arrays.get("allowed-tools");
  const declaredCredentials = arrays.get("declared-credentials");
  const resourceDirectories = arrays.get("resource-directories");

  const userInvocable = scalars.has("user-invocable")
    ? /^(true|yes|1)$/i.test(scalars.get("user-invocable") ?? "")
    : undefined;
  const disableModelInvocation = scalars.has("disable-model-invocation")
    ? /^(true|yes|1)$/i.test(scalars.get("disable-model-invocation") ?? "")
    : undefined;

  const known = new Set([
    "name",
    "description",
    "allowed-tools",
    "declared-credentials",
    "resource-directories",
    "user-invocable",
    "disable-model-invocation",
  ]);
  const unknownFields: Record<string, string | readonly string[]> = {};
  for (const [k, v] of scalars) {
    if (!known.has(k)) unknownFields[k] = v;
  }
  for (const [k, v] of arrays) {
    if (!known.has(k)) unknownFields[k] = v;
  }

  return {
    schemaVersion: 1,
    name,
    description,
    ...(allowedTools ? { allowedTools } : {}),
    ...(declaredCredentials ? { declaredCredentials } : {}),
    ...(resourceDirectories ? { resourceDirectories } : {}),
    ...(userInvocable !== undefined ? { userInvocable } : {}),
    ...(disableModelInvocation !== undefined ? { disableModelInvocation } : {}),
    unknownFields,
  };
}

function normalizeFallbackName(dirName: string, firstHeading: string): string {
  const candidate = (dirName || firstHeading || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return candidate;
}

function clampDescription(description: string): string {
  return description.length > DESCRIPTION_MAX_CHARS
    ? `${description.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
    : description;
}

/** Body after frontmatter; when no frontmatter exists, the full text. */
export function extractBody(text: string): string {
  const parsed = parseRestrictedFrontmatter(text);
  return parsed ? parsed.body : text;
}
