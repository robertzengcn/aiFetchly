import { parseFrontmatter } from "@/service/pluginCompat/claudeFrontmatterParser";
import type {
  AgentDefinitionView,
  AgentDefinitionHealth,
} from "@/entityTypes/agentTypes";
import type { PluginError } from "@/entityTypes/pluginTypes";

/**
 * Pure translator: one plugin agent Markdown file → AgentDefinitionView.
 * Mirrors ClaudeSkillFormatAdapter: no I/O. Caller reads the file.
 *
 * Security (PRD §17, design §10.8): privilege-bearing frontmatter fields are
 * ignored and surfaced as recoverable `agent-unsupported-field` warnings;
 * they never reach the runtime.
 */

export interface ClaudeAgentAdaptOptions {
  readonly pluginName: string;
  readonly sourcePath: string;
  /** Directory segments between the declared agent root and this file's dir. */
  readonly namespaceSegments: readonly string[];
}

export interface ClaudeAgentAdaptSuccess {
  readonly ok: true;
  readonly definition: AgentDefinitionView;
  readonly manifest: Record<string, unknown>;
  readonly warnings: PluginError[];
}

export interface ClaudeAgentAdaptFailure {
  readonly ok: false;
  readonly errors: PluginError[];
}

export type ClaudeAgentAdaptResult =
  | ClaudeAgentAdaptSuccess
  | ClaudeAgentAdaptFailure;

const SEGMENT_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

const FORBIDDEN_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "permissionMode", label: "permissionMode" },
  { key: "hooks", label: "hooks" },
  { key: "mcpServers", label: "mcpServers" },
  { key: "alwaysAllow", label: "alwaysAllow" },
  { key: "disallowedTools", label: "disallowedTools" },
  { key: "mcp", label: "mcp" },
  { key: "servers", label: "servers" },
];

const CLAUDE_MODEL_ALIASES = new Set(["haiku", "sonnet", "opus"]);

const CLAUDE_TOOL_ALIASES: Readonly<Record<string, string | null>> = {
  Read: "file_read",
  Grep: "grep_files",
  Glob: "glob_files",
  Bash: null,
  Edit: null,
  MultiEdit: null,
  Write: null,
};

export function normalizeClaudeAgentToolName(name: string): string | null {
  if (Object.prototype.hasOwnProperty.call(CLAUDE_TOOL_ALIASES, name)) {
    return CLAUDE_TOOL_ALIASES[name] ?? null;
  }
  return name;
}

export function isClaudeModelAlias(model: string): boolean {
  return CLAUDE_MODEL_ALIASES.has(model.toLowerCase());
}

/** Stricter than skills: bad/empty name is an error, never invented. */
export function sanitizeAgentSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export function buildPluginAgentId(
  pluginName: string,
  namespaceSegments: readonly string[],
  agentName: string
): string {
  return [pluginName, ...namespaceSegments, agentName].join(":");
}

function missingField(
  sourcePath: string,
  field: string,
  message: string
): PluginError {
  return {
    code: "agent-frontmatter-missing-field",
    componentType: "agent",
    path: sourcePath,
    message,
    recoverable: false,
  };
}

export class ClaudeAgentFormatAdapter {
  static adapt(
    markdown: string,
    options: ClaudeAgentAdaptOptions
  ): ClaudeAgentAdaptResult {
    const { pluginName, sourcePath, namespaceSegments } = options;
    const { frontmatter, body } = parseFrontmatter(markdown);
    const warnings: PluginError[] = [];

    // Required: name (non-empty, sanitizable)
    const rawName = frontmatter.name;
    const name =
      typeof rawName === "string" && rawName.length > 0
        ? sanitizeAgentSegment(rawName)
        : "";
    if (!name || !SEGMENT_REGEX.test(name)) {
      return {
        ok: false,
        errors: [
          missingField(
            sourcePath,
            "name",
            `Agent at "${sourcePath}" is missing a valid "name" (must match /^[a-z0-9][a-z0-9_-]*$/).`
          ),
        ],
      };
    }

    // Required: description
    const rawDescription = frontmatter.description;
    if (typeof rawDescription !== "string" || rawDescription.length === 0) {
      return {
        ok: false,
        errors: [
          missingField(
            sourcePath,
            "description",
            `Agent at "${sourcePath}" is missing required frontmatter field "description".`
          ),
        ],
      };
    }

    // Required: non-empty body → systemPrompt
    const systemPrompt = body.trim();
    if (systemPrompt.length === 0) {
      return {
        ok: false,
        errors: [
          missingField(sourcePath, "body", `Agent body at "${sourcePath}" is empty.`),
        ],
      };
    }

    // Optional fields
    const manifest: Record<string, unknown> = {};
    const tools = normalizeToolNames(
      toStringArray(frontmatter.tools),
      name,
      sourcePath,
      warnings
    );
    const skills = normalizeToolNames(
      toStringArray(frontmatter.skills),
      name,
      sourcePath,
      warnings
    );
    const allowedTools = Array.from(new Set([...tools, ...skills]));
    const defaultModel = normalizeModel(
      frontmatter.model,
      name,
      sourcePath,
      manifest,
      warnings
    );
    const mode = toMode(frontmatter.mode);
    const maxToolCalls = toPositiveInt(frontmatter.maxToolCalls, 8);
    const maxRuntimeMs = toPositiveInt(frontmatter.maxRuntimeMs, 300000);
    const maxContinueCalls = toPositiveInt(frontmatter.maxTurns, 8);
    const outputSchema = toOutputSchema(frontmatter.outputSchema);

    // Forbidden fields → warnings only; raw value stashed in manifest for diagnostics.
    if (typeof frontmatter.color === "string") manifest.color = frontmatter.color;
    if (typeof frontmatter.background === "string")
      manifest.background = frontmatter.background;
    if (typeof frontmatter.effort === "string") manifest.effort = frontmatter.effort;
    for (const { key, label } of FORBIDDEN_FIELDS) {
      if (frontmatter[key] !== undefined) {
        manifest[label] = frontmatter[key];
        warnings.push({
          code: "agent-unsupported-field",
          componentType: "agent",
          componentName: name,
          path: sourcePath,
          message: `Agent field "${label}" is not supported and was ignored.`,
          recoverable: true,
        });
      }
    }

    const health: AgentDefinitionHealth = "healthy";
    const definition: AgentDefinitionView = {
      id: buildPluginAgentId(pluginName, namespaceSegments, name),
      name,
      description: rawDescription,
      version: 1,
      systemPrompt,
      allowedTools,
      ...(defaultModel ? { defaultModel } : {}),
      mode,
      maxToolCalls,
      maxRuntimeMs,
      maxContinueCalls,
      outputSchema,
      status: "active",
      source: "plugin",
      pluginName,
      pluginComponentPath: sourcePath,
      manifest,
      health,
    };

    return { ok: true, definition, manifest, warnings };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
}

function normalizeToolNames(
  rawTools: readonly string[],
  componentName: string,
  sourcePath: string,
  warnings: PluginError[]
): string[] {
  const out: string[] = [];
  for (const raw of rawTools) {
    const mapped = normalizeClaudeAgentToolName(raw);
    if (mapped !== raw) {
      if (mapped) {
        out.push(mapped);
      } else {
        warnings.push({
          code: "agent-unsupported-field",
          componentType: "agent",
          componentName,
          path: sourcePath,
          message: `Claude agent tool "${raw}" is not exposed to AiFetchly v1 plugin agents and was ignored.`,
          recoverable: true,
        });
      }
      continue;
    }
    out.push(mapped);
  }
  return out;
}

function normalizeModel(
  rawModel: unknown,
  componentName: string,
  sourcePath: string,
  manifest: Record<string, unknown>,
  warnings: PluginError[]
): string | undefined {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return undefined;
  }
  if (!isClaudeModelAlias(rawModel)) {
    return rawModel;
  }
  manifest.claudeModelAlias = rawModel;
  warnings.push({
    code: "agent-unsupported-field",
    componentType: "agent",
    componentName,
    path: sourcePath,
    message: `Claude model alias "${rawModel}" is not an AiFetchly model id and was ignored.`,
    recoverable: true,
  });
  return undefined;
}

function toMode(value: unknown): AgentDefinitionView["mode"] {
  if (
    value === "coordinator" ||
    value === "specialist" ||
    value === "verifier" ||
    value === "formatter"
  ) {
    return value;
  }
  return "specialist";
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function toOutputSchema(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
