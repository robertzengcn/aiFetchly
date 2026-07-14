import {
  PLUGIN_NAME_REGEX,
  resolvePluginRelativePath,
  type PluginError,
  type PluginManifest,
  type PluginMcpServerDeclaration,
} from "@/entityTypes/pluginTypes";
import type { ClaudeAdaptResult } from "@/service/pluginCompat/pluginFormatTypes";

/**
 * Pure translator: Claude manifest JSON → AiFetchly PluginManifest + extras.
 *
 * Rules (Tech Design §5):
 *   - name required, must match PLUGIN_NAME_REGEX.
 *   - version optional in Claude; defaults to "0.0.0".
 *   - description optional in Claude; defaults to "".
 *   - skills normalization: true → ["skills/"]; string → [string];
 *     string[] → string[] (deduped); object map → ["skills/<key>/SKILL.md", ...].
 *   - mcpServers: when `mcp` is an object, use inline (alternative B).
 *     Otherwise leave mcpServersPaths empty; the loader checks for sibling
 *     .mcp.json at the plugin root.
 *   - hooks path recorded as opaque (Phase 3 will consume).
 *   - commands / agents / outputStyles / lsp carried opaquely.
 *
 * Internal key `__claudeOpaque__` carries fields the runtime doesn't yet
 * consume. Read it only when manifest.format === "claude".
 */

export interface ClaudePluginAdapterOptions {
  readonly pluginRoot: string;
}

/** Key under which opaque carry-through is stashed on the manifest. */
export const CLAUDE_OPAQUE_KEY = "__claudeOpaque__";

type SkillDecl =
  | string
  | readonly string[]
  | true
  | Record<string, { source?: string; content?: string; description?: string }>;

function normalizeSkillsField(
  raw: SkillDecl | undefined,
  pluginRoot: string,
  errors: PluginError[]
): string[] {
  let candidatePaths: string[];

  if (raw === undefined || raw === true) {
    candidatePaths = ["skills/"];
  } else if (typeof raw === "string") {
    candidatePaths = [raw];
  } else if (Array.isArray(raw)) {
    candidatePaths = [...raw];
  } else if (typeof raw === "object" && raw !== null) {
    candidatePaths = Object.keys(raw).map((k) => `skills/${k}/SKILL.md`);
  } else {
    candidatePaths = ["skills/"];
  }

  // Validate each path stays inside plugin root and dedupe.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of candidatePaths) {
    if (typeof p !== "string" || p.length === 0) continue;
    try {
      resolvePluginRelativePath(pluginRoot, p);
    } catch {
      errors.push({
        code: "path-outside-plugin",
        componentType: "skill",
        path: p,
        message: `Skill path "${p}" escapes the plugin directory.`,
        recoverable: false,
      });
      continue;
    }
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export class ClaudePluginAdapter {
  static adapt(
    raw: unknown,
    options: ClaudePluginAdapterOptions
  ): ClaudeAdaptResult {
    if (!raw || typeof raw !== "object") {
      return {
        ok: false,
        errors: [
          {
            code: "manifest-schema-invalid",
            message: "Claude manifest must be a JSON object.",
            recoverable: false,
          },
        ],
      };
    }

    const m = raw as Record<string, unknown>;
    const errors: PluginError[] = [];

    const name = m.name;
    if (typeof name !== "string" || !PLUGIN_NAME_REGEX.test(name)) {
      errors.push({
        code: "manifest-schema-invalid",
        message:
          'Invalid or missing "name". Must match /^[a-z0-9][a-z0-9_-]*$/ (e.g. "lead-tools" or "2-commit-fast").',
        recoverable: false,
      });
    }

    const version =
      typeof m.version === "string" && m.version.length > 0
        ? m.version
        : "0.0.0";
    const description = typeof m.description === "string" ? m.description : "";

    const skillsPaths = normalizeSkillsField(
      m.skills as SkillDecl | undefined,
      options.pluginRoot,
      errors
    );

    // Inline mcp (alternative B) — only when it's a non-array object.
    let inlineMcp: Record<string, PluginMcpServerDeclaration> | undefined;
    if (m.mcp && typeof m.mcp === "object" && !Array.isArray(m.mcp)) {
      inlineMcp = m.mcp as Record<string, PluginMcpServerDeclaration>;
    }

    const hooksPath = typeof m.hooks === "string" ? m.hooks : undefined;

    // Opaque carry-through.
    const opaque: Record<string, unknown> = {};
    for (const key of [
      "commands",
      "agents",
      "outputStyles",
      "lsp",
      "output-styles",
    ]) {
      if (m[key] !== undefined) {
        opaque[key] = m[key];
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    const manifest = {
      name: typeof name === "string" ? name : "",
      version,
      description,
      format: "claude" as const,
      ...(typeof m.author === "string" ? { author: m.author } : {}),
      ...(typeof m.homepage === "string" ? { homepage: m.homepage } : {}),
      ...(typeof m.repository === "string" ? { repository: m.repository } : {}),
      skills: skillsPaths,
      mcpServers: inlineMcp ? Object.keys(inlineMcp) : [],
      [CLAUDE_OPAQUE_KEY]: opaque,
    } as unknown as PluginManifest;

    return {
      ok: true,
      adapted: {
        manifest,
        format: "claude",
        skillsPaths,
        mcpServersPaths: [],
        inlineMcp,
        hooksPath,
        opaque,
      },
    };
  }
}
