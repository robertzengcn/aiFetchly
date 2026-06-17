import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import type { PluginError, PluginSummary } from "@/entityTypes/pluginTypes";

/**
 * Produce UI-safe diagnostic bundles for a plugin.
 * Source of truth: Design §7.6.
 *
 * Pure data shaping + secret redaction. No side effects.
 */

export interface PluginSkillDiagnostic {
  readonly name: string;
  readonly enabled: boolean;
  readonly health: string;
  readonly error?: string;
}

export interface PluginMcpDiagnostic {
  readonly serverName: string;
  readonly enabled: boolean;
  readonly transport: string;
  readonly health: string;
  readonly error?: string;
}

export interface PluginDiagnosticsBundle {
  readonly pluginName: string;
  readonly generatedAt: string;
  readonly summary: PluginSummary;
  readonly manifest: Record<string, unknown>;
  readonly errors: readonly PluginError[];
  readonly skills: readonly PluginSkillDiagnostic[];
  readonly mcpServers: readonly PluginMcpDiagnostic[];
}

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:api[_-]?key|apikey)["'\s:=]+[A-Za-z0-9_-]{8,}/gi,
  /(?:bearer|token|password|passwd|secret)["'\s:=]+[^\s"'，。]{4,}/gi,
  /sk-[A-Za-z0-9]{16,}/g,
  /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT-like
];

function redactSecrets(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  return out;
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      if (
        (lk.includes("secret") ||
          lk.includes("password") ||
          lk.includes("token") ||
          lk.includes("apikey") ||
          lk === "key") &&
        typeof v === "string" &&
        v.length > 0
      ) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }
  return value;
}

export class PluginDiagnosticsService {
  static async buildBundle(
    pluginName: string
  ): Promise<PluginDiagnosticsBundle | null> {
    const pluginModule = new PluginManagementModule();
    const skillModule = new SkillManagementModule();
    const mcpModule = new MCPToolModule();

    const plugin = await pluginModule.getPluginByName(pluginName);
    if (!plugin) return null;

    const skills = await skillModule.findSkillsByPluginName(pluginName);
    const mcpServers = await mcpModule.findMcpByPluginName(pluginName);

    let storedErrors: PluginError[] = [];
    try {
      storedErrors = JSON.parse(
        plugin.lastLoadErrorsJson || "[]"
      ) as PluginError[];
    } catch {
      storedErrors = [];
    }

    let manifestRaw: Record<string, unknown> = {};
    try {
      manifestRaw = JSON.parse(plugin.manifestJson || "{}") as Record<
        string,
        unknown
      >;
    } catch {
      manifestRaw = {};
    }

    const summary: PluginSummary = {
      id: plugin.id,
      name: plugin.name,
      displayName: plugin.displayName,
      version: plugin.version,
      source: plugin.source as PluginSummary["source"],
      enabled: plugin.enabled === 1,
      health: plugin.health as PluginSummary["health"],
      skillCount: skills.length,
      mcpServerCount: mcpServers.length,
      permissions: safeParseArray(plugin.permissionsJson),
      lastUpdated: plugin.updatedAt
        ? new Date(plugin.updatedAt).toISOString()
        : new Date().toISOString(),
    };

    return {
      pluginName,
      generatedAt: new Date().toISOString(),
      summary,
      manifest: redactDeep(manifestRaw) as Record<string, unknown>,
      errors: storedErrors.map((e) => ({
        ...e,
        message: redactSecrets(e.message),
      })),
      skills: skills.map<PluginSkillDiagnostic>((s) => ({
        name: s.name,
        enabled: s.enabled === 1,
        health: "healthy",
      })),
      mcpServers: mcpServers.map<PluginMcpDiagnostic>((m) => ({
        serverName: m.serverName,
        enabled: m.enabled,
        transport: m.transport,
        health: "healthy",
      })),
    };
  }
}

function safeParseArray(json: string | undefined | null): readonly string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
