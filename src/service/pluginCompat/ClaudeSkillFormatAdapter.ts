import type { SkillManifest } from "@/entityTypes/skillTypes";
import type { PluginError } from "@/entityTypes/pluginTypes";
import { parseFrontmatter } from "@/service/pluginCompat/claudeFrontmatterParser";

/**
 * Translates a Claude SKILL.md file into a SkillManifest-shaped object that
 * the existing SkillImportService / SkillManagementModule pipeline consumes.
 *
 * The skill is always treated as documentation-only (runtime: "javascript",
 * documentationOnly: true) — matching the existing buildManifestFromSkillMarkdown
 * behavior in SkillImportService.ts.
 *
 * Pure: no I/O. The caller reads the file and passes content + sourcePath.
 */

export interface ClaudeSkillAdaptSuccess {
  readonly ok: true;
  readonly manifest: SkillManifest;
  /** Markdown body (everything after frontmatter). */
  readonly body: string;
  /** Source path of the .md file inside the plugin (for diagnostics). */
  readonly sourcePath: string;
}

export interface ClaudeSkillAdaptFailure {
  readonly ok: false;
  readonly error: PluginError;
}

export type ClaudeSkillAdaptResult =
  | ClaudeSkillAdaptSuccess
  | ClaudeSkillAdaptFailure;

const NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

/** Derive a skill name from the SKILL.md file path when frontmatter omits "name".
 *  For "skills/hello/SKILL.md" → "hello"; for "skills/SKILL.md" → "skills". */
function deriveSkillNameFromPath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash === -1) return "imported-skill";
  const parent = trimmed.substring(0, lastSlash);
  const slashBeforeParent = parent.lastIndexOf("/");
  const dirName = slashBeforeParent === -1 ? parent : parent.substring(slashBeforeParent + 1);
  return dirName || "imported-skill";
}

function sanitizeSkillName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!normalized) return "imported-skill";
  if (NAME_REGEX.test(normalized)) return normalized;
  if (/^[a-z]/.test(normalized)) return normalized;
  return `skill-${normalized}`;
}

function normalizeFileExtensions(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim().toLowerCase();
    if (!trimmed) continue;
    const withDot = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
    out.push(withDot);
  }
  return out.length > 0 ? out : undefined;
}

export class ClaudeSkillFormatAdapter {
  /**
   * Adapt a SKILL.md file's content into a SkillManifest.
   * Skill name is derived from the parent directory name when frontmatter omits "name".
   *
   * Errors:
   *   - claude-frontmatter-missing-field: required field `description` absent.
   */
  static adapt(
    skillMdContent: string,
    sourcePath: string
  ): ClaudeSkillAdaptResult {
    const { frontmatter, body } = parseFrontmatter(skillMdContent);

    const rawName = frontmatter.name;
    const rawDescription = frontmatter.description;

    const name =
      typeof rawName === "string" && rawName.length > 0
        ? sanitizeSkillName(rawName)
        : sanitizeSkillName(deriveSkillNameFromPath(sourcePath));

    if (typeof rawDescription !== "string" || rawDescription.length === 0) {
      return {
        ok: false,
        error: {
          code: "claude-frontmatter-missing-field",
          componentType: "skill",
          path: sourcePath,
          message: `Claude skill at "${sourcePath}" is missing required frontmatter field "description".`,
          recoverable: false,
        },
      };
    }
    const version =
      typeof frontmatter.version === "string" ? frontmatter.version : "0.0.0";

    const supportedFileTypes = normalizeFileExtensions(
      frontmatter.supportedFileTypes ?? frontmatter.supported_file_types
    );

    const manifest: SkillManifest = {
      name,
      version,
      description: `${rawDescription} [documentation-only in aiFetchly]`,
      runtime: "javascript",
      entry: "__skill_md_wrapper__.js",
      parameters: {
        type: "object",
        properties: {
          attachment_ref: {
            type: "string",
            description:
              "Optional. When set, loads staged attachment markdown for this conversation.",
          },
        },
        additionalProperties: false,
      },
      documentationOnly: true,
      ...(supportedFileTypes ? { supportedFileTypes } : {}),
    };

    return { ok: true, manifest, body, sourcePath };
  }
}
