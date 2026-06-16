import * as fs from "fs";
import * as path from "path";
import {
  PLUGIN_NAME_REGEX,
  PLUGIN_SEMVER_REGEX,
  resolvePluginRelativePath,
  type PluginError,
  type PluginManifest,
} from "@/entityTypes/pluginTypes";

/**
 * Loads and validates plugin manifests from disk.
 * Source of truth: Design §7.1, §4.2 validation constraints, §15.2.
 *
 * This service is strictly static: it parses JSON and validates paths.
 * It does NOT execute plugin code, resolve network resources, run pip,
 * or spawn any process.
 */

export interface PluginManifestReadResult {
  readonly success: true;
  readonly manifest: PluginManifest;
  readonly manifestPath: string;
}

export interface PluginManifestFailure {
  readonly success: false;
  readonly errors: readonly PluginError[];
}

export type PluginManifestLoadResult =
  | PluginManifestReadResult
  | PluginManifestFailure;

const MAX_DESCRIPTION_LENGTH = 500;

function fail(errors: PluginError[]): PluginManifestFailure {
  return { success: false, errors };
}

function ok(
  manifest: PluginManifest,
  manifestPath: string
): PluginManifestReadResult {
  return { success: true, manifest, manifestPath };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Validate an already-parsed manifest object against the plugin manifest schema.
 * `pluginRoot` is used to verify that declared component paths stay inside the
 * plugin directory.
 */
function validateManifest(
  raw: unknown,
  pluginRoot: string
): PluginManifestLoadResult {
  if (!raw || typeof raw !== "object") {
    return fail([
      {
        code: "manifest-schema-invalid",
        message: "Manifest must be a JSON object",
        recoverable: false,
      },
    ]);
  }

  const m = raw as Record<string, unknown>;
  const errors: PluginError[] = [];

  // Required string fields
  if (
    typeof m.name !== "string" ||
    !PLUGIN_NAME_REGEX.test(m.name)
  ) {
    errors.push({
      code: "manifest-schema-invalid",
      message:
        'Invalid or missing "name". Must match /^[a-z][a-z0-9_-]*$/ (e.g. "lead-tools").',
      recoverable: false,
    });
  }

  if (typeof m.version !== "string" || !PLUGIN_SEMVER_REGEX.test(m.version)) {
    errors.push({
      code: "plugin-version-invalid",
      message:
        'Invalid or missing "version". Must be semver (e.g. "1.0.0").',
      recoverable: false,
    });
  }

  if (typeof m.description !== "string" || m.description.length === 0) {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"description" is required and must be a non-empty string.',
      recoverable: false,
    });
  } else if (m.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({
      code: "manifest-schema-invalid",
      message: `"description" must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      recoverable: false,
    });
  }

  // Optional typed fields
  if (
    m.displayName !== undefined &&
    typeof m.displayName !== "string"
  ) {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"displayName" must be a string when present.',
      recoverable: false,
    });
  }
  if (m.author !== undefined && typeof m.author !== "string") {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"author" must be a string when present.',
      recoverable: false,
    });
  }
  if (
    m.source !== undefined &&
    !["local", "builtin", "marketplace"].includes(m.source as string)
  ) {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"source" must be one of: local, builtin, marketplace.',
      recoverable: false,
    });
  }

  // Components: at least one of skills / mcpServers must be present and non-empty
  if (m.skills !== undefined && !isStringArray(m.skills)) {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"skills" must be an array of relative path strings.',
      recoverable: false,
    });
  }
  if (m.mcpServers !== undefined && !isStringArray(m.mcpServers)) {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"mcpServers" must be an array of relative path strings.',
      recoverable: false,
    });
  }

  const skills = Array.isArray(m.skills) ? m.skills : [];
  const mcpServers = Array.isArray(m.mcpServers) ? m.mcpServers : [];
  if (skills.length === 0 && mcpServers.length === 0) {
    errors.push({
      code: "manifest-schema-invalid",
      message:
        'At least one of "skills" or "mcpServers" must be non-empty.',
      recoverable: false,
    });
  }

  if (m.permissions !== undefined && !isStringArray(m.permissions)) {
    errors.push({
      code: "manifest-schema-invalid",
      message: '"permissions" must be an array of strings when present.',
      recoverable: false,
    });
  }

  // Path safety for declared components (Design §4.2: relative + inside root)
  for (const skillPath of skills) {
    try {
      resolvePluginRelativePath(pluginRoot, skillPath);
    } catch {
      errors.push({
        code: "path-outside-plugin",
        componentType: "skill",
        path: skillPath,
        message: `Skill path "${skillPath}" escapes the plugin directory.`,
        recoverable: false,
      });
    }
  }
  for (const mcpPath of mcpServers) {
    try {
      resolvePluginRelativePath(pluginRoot, mcpPath);
    } catch {
      errors.push({
        code: "path-outside-plugin",
        componentType: "mcpServer",
        path: mcpPath,
        message: `MCP path "${mcpPath}" escapes the plugin directory.`,
        recoverable: false,
      });
    }
  }

  if (errors.length > 0) {
    return fail(errors);
  }

  // Build a typed manifest. Unknown top-level fields are allowed and
  // preserved (Design §4.2 last validation constraint) — runtime ignores them.
  const manifest = m as unknown as PluginManifest;
  return ok(manifest, ""); // manifestPath filled by caller
}

/**
 * Locate the plugin manifest file inside `pluginRoot`.
 * Prefers `.aifetchly-plugin/plugin.json`, falls back to root `plugin.json`.
 * Returns the absolute path or null when no manifest is found.
 */
function locateManifestFile(pluginRoot: string): string | null {
  const preferred = path.join(pluginRoot, ".aifetchly-plugin", "plugin.json");
  if (fs.existsSync(preferred)) {
    return preferred;
  }
  const fallback = path.join(pluginRoot, "plugin.json");
  if (fs.existsSync(fallback)) {
    return fallback;
  }
  return null;
}

export class PluginManifestService {
  /**
   * Load and validate the manifest from a plugin directory on disk.
   * Returns a discriminated union; never throws for expected validation
   * failures. Unexpected I/O errors propagate to the caller.
   */
  static async loadFromDirectory(
    pluginRoot: string
  ): Promise<PluginManifestLoadResult> {
    const manifestPath = locateManifestFile(pluginRoot);
    if (!manifestPath) {
      return fail([
        {
          code: "manifest-not-found",
          path: pluginRoot,
          message:
            "No plugin manifest found. Expected .aifetchly-plugin/plugin.json (or root plugin.json).",
          recoverable: false,
        },
      ]);
    }

    let rawContent: string;
    try {
      rawContent = fs.readFileSync(manifestPath, "utf-8");
    } catch (e: unknown) {
      return fail([
        {
          code: "manifest-not-found",
          path: manifestPath,
          message:
            e instanceof Error
              ? `Failed to read manifest: ${e.message}`
              : "Failed to read manifest",
          recoverable: false,
        },
      ]);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e: unknown) {
      return fail([
        {
          code: "manifest-invalid-json",
          path: manifestPath,
          message:
            e instanceof Error
              ? `Manifest is not valid JSON: ${e.message}`
              : "Manifest is not valid JSON",
          recoverable: false,
        },
      ]);
    }

    const validation = validateManifest(parsed, pluginRoot);
    if (!validation.success) {
      // Attach the manifest path for diagnostics.
      return fail(validation.errors);
    }
    return ok(validation.manifest, manifestPath);
  }

  /**
   * Validate an in-memory manifest object. Useful for previewing an import
   * before files are copied to the final install path.
   */
  static validateManifest(
    manifest: unknown,
    pluginRoot: string
  ): PluginManifestLoadResult {
    const result = validateManifest(manifest, pluginRoot);
    if (result.success) {
      return ok(result.manifest, "");
    }
    return result;
  }
}
