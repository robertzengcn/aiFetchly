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

const NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

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
   *
   * Errors:
   *   - claude-frontmatter-missing-field: required field `name` or `description` absent.
   */
  static adapt(
    skillMdContent: string,
    sourcePath: string
  ): ClaudeSkillAdaptResult {
    const { frontmatter, body } = parseFrontmatter(skillMdContent);

    const rawName = frontmatter.name;
    const rawDescription = frontmatter.description;

    if (typeof rawName !== "string" || rawName.length === 0) {
      return {
        ok: false,
        error: {
          code: "claude-frontmatter-missing-field",
          componentType: "skill",
          path: sourcePath,
          message: `Claude skill at "${sourcePath}" is missing required frontmatter field "name".`,
          recoverable: false,
        },
      };
    }

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

    const name = sanitizeSkillName(rawName);
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
