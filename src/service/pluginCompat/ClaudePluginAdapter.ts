import * as fs from "fs";
import * as path from "path";
import {
  PLUGIN_NAME_REGEX,
  resolvePluginRelativePath,
  type PluginError,
  type PluginManifest,
  type PluginMcpServerDeclaration,
  type PluginAgentDeclaration,
  type PluginCommandDeclaration,
} from "@/entityTypes/pluginTypes";
import type { ClaudeAdaptResult } from "@/service/pluginCompat/pluginFormatTypes";

/**
 * Pure translator: Claude manifest JSON → AiFetchly PluginManifest + extras.
 *
 * Rules (Tech Design §5, §9.2):
 *   - name required, must match PLUGIN_NAME_REGEX.
 *   - version optional in Claude; defaults to "0.0.0".
 *   - description optional in Claude; defaults to "".
 *   - skills normalization: true → ["skills/"]; string → [string];
 *     string[] → string[] (deduped); object map → ["skills/<key>/SKILL.md", ...].
 *   - agents normalization: true → default "agents/"; string → [string];
 *     string[] → string[]; object map → "agents/<key>.md" unless a value has
 *     a string `source`. Inline `content` is unsupported (file imports only).
 *     When `agents` is absent but an `agents/` dir exists, auto-detect it.
 *   - mcpServers: when `mcp` is an object, use inline (alternative B).
 *     Otherwise leave mcpServersPaths empty; the loader checks for sibling
 *     .mcp.json at the plugin root.
 *   - hooks path recorded as opaque (Phase 3 will consume).
 *   - commands / outputStyles / lsp carried opaquely.
 *
 * Internal key `__claudeOpaque__` carries fields the runtime doesn't yet
 * consume. Read it only when manifest.format === "claude".
 */

export interface ClaudePluginAdapterOptions {
  readonly pluginRoot: string;
}

/** Key under which opaque carry-through is stashed on the manifest. */
export const CLAUDE_OPAQUE_KEY = "__claudeOpaque__";

/** Whether a manifest was produced by the Claude compatibility adapter. */
export function isClaudeManifest(manifest: PluginManifest): boolean {
  return manifest.format === "claude";
}

/**
 * Read the opaque carry-through bag the adapter stashed on the manifest. Only
 * meaningful when {@link isClaudeManifest} is true. Returns an empty record for
 * non-Claude manifests or when nothing was carried.
 */
export function getClaudeOpaque(
  manifest: PluginManifest
): Record<string, unknown> {
  const v = (manifest as unknown as Record<string, unknown>)[CLAUDE_OPAQUE_KEY];
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Typed accessor for the Claude `commands` declaration carried opaquely on the
 * manifest (design §10.7). Returns undefined for non-Claude manifests or when
 * no `commands` field was declared.
 */
export function getClaudeCommandDeclaration(
  manifest: PluginManifest
): PluginCommandDeclaration | undefined {
  if (!isClaudeManifest(manifest)) return undefined;
  const opaque = getClaudeOpaque(manifest);
  const commands = opaque.commands;
  if (commands === undefined) return undefined;
  return commands as PluginCommandDeclaration;
}

type SkillDecl =
  | string
  | readonly string[]
  | true
  | Record<string, { source?: string; content?: string; description?: string }>;

type AgentDecl = PluginAgentDeclaration;

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

/**
 * Normalize the Claude `agents` field. Returns the normalized declaration
 * (string | string[] | true | object map), or undefined when nothing is
 * declared. Path safety is validated per entry; object-map `content`-only
 * entries are rejected (file imports only).
 */
function normalizeAgentsField(
  raw: AgentDecl | undefined,
  pluginRoot: string,
  errors: PluginError[]
): PluginAgentDeclaration | undefined {
  // Object map: validate per-entry.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, { source?: string; description?: string }> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const v = val as
        | {
            source?: string;
            content?: string;
            description?: string;
          }
        | undefined;
      if (
        v &&
        typeof v.content === "string" &&
        (typeof v.source !== "string" || v.source.length === 0)
      ) {
        errors.push({
          code: "agent-unsupported-field",
          componentType: "agent",
          componentName: key,
          message: `Agent "${key}" uses inline "content", which is not supported (file imports only).`,
          recoverable: false,
        });
        continue;
      }
      if (v && typeof v.source === "string") {
        try {
          resolvePluginRelativePath(pluginRoot, v.source);
        } catch {
          errors.push({
            code: "agent-path-invalid",
            componentType: "agent",
            componentName: key,
            path: v.source,
            message: `Agent source path "${v.source}" escapes the plugin directory.`,
            recoverable: false,
          });
          continue;
        }
        out[key] = {
          source: v.source,
          ...(v.description ? { description: v.description } : {}),
        };
      } else {
        out[key] = v?.description ? { description: v.description } : {};
      }
    }
    return out;
  }

  if (raw === undefined) return undefined;
  if (raw === true) return true;

  if (typeof raw === "string") {
    try {
      resolvePluginRelativePath(pluginRoot, raw);
    } catch {
      errors.push({
        code: "agent-path-invalid",
        componentType: "agent",
        path: raw,
        message: `Agent path "${raw}" escapes the plugin directory.`,
        recoverable: false,
      });
    }
    return raw;
  }

  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p !== "string") continue;
      try {
        resolvePluginRelativePath(pluginRoot, p);
      } catch {
        errors.push({
          code: "agent-path-invalid",
          componentType: "agent",
          path: p,
          message: `Agent path "${p}" escapes the plugin directory.`,
          recoverable: false,
        });
      }
    }
    return [...raw];
  }

  return undefined;
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

    // Agents: normalize declared form; auto-detect agents/ when absent.
    const agentsDecl = normalizeAgentsField(
      m.agents as AgentDecl | undefined,
      options.pluginRoot,
      errors
    );
    let effectiveAgents = agentsDecl;
    if (agentsDecl === undefined) {
      try {
        if (
          fs.statSync(path.join(options.pluginRoot, "agents")).isDirectory()
        ) {
          effectiveAgents = true;
        }
      } catch {
        // no agents/ dir — leave undefined
      }
    }

    // Inline mcp (alternative B) — only when it's a non-array object.
    let inlineMcp: Record<string, PluginMcpServerDeclaration> | undefined;
    if (m.mcp && typeof m.mcp === "object" && !Array.isArray(m.mcp)) {
      inlineMcp = m.mcp as Record<string, PluginMcpServerDeclaration>;
    }

    const hooksPath = typeof m.hooks === "string" ? m.hooks : undefined;

    // Opaque carry-through (agents is now a first-class field, not opaque).
    const opaque: Record<string, unknown> = {};
    for (const key of ["commands", "outputStyles", "lsp", "output-styles"]) {
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
      ...(effectiveAgents !== undefined ? { agents: effectiveAgents } : {}),
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
