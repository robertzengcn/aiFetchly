import * as path from "path";

/**
 * Plugin Management System — shared type contracts.
 *
 * Source of truth: doc/skills/Plugin_Management_System_Technical_Design.md
 * Sections referenced inline (e.g. Design §4.2).
 */

// ---------------------------------------------------------------------------
// Identifiers and health (Design §4.2)
// ---------------------------------------------------------------------------

export type PluginSource = "local" | "builtin" | "marketplace";

export type PluginHealth =
  | "healthy"
  | "disabled"
  | "needs_configuration"
  | "partial_load"
  | "invalid"
  | "missing_files";

// ---------------------------------------------------------------------------
// Plugin manifest (Design §4.2)
// ---------------------------------------------------------------------------

export interface PluginManifest {
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly source?: PluginSource;
  readonly skills?: readonly string[];
  readonly mcpServers?: readonly string[];
  readonly permissions?: readonly string[];
  readonly dependencies?: readonly PluginDependency[];
  readonly homepage?: string;
  readonly repository?: string;
  /** Unknown top-level fields are allowed but preserved under diagnostics only. */
  readonly [extra: string]: unknown;
}

export interface PluginDependency {
  readonly name: string;
  readonly version?: string;
  readonly optional?: boolean;
}

// ---------------------------------------------------------------------------
// MCP server declaration (Design §4.3)
// ---------------------------------------------------------------------------

export type PluginMcpTransport = "stdio" | "sse" | "websocket";

export interface PluginMcpServersFile {
  readonly mcpServers: Record<string, PluginMcpServerDeclaration>;
}

export interface PluginMcpServerDeclaration {
  readonly transport?: PluginMcpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly host?: string;
  readonly port?: number;
  readonly url?: string;
  readonly timeout?: number;
  readonly description?: string;
  readonly authType?: "none" | "api_key" | "bearer_token" | "custom";
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component state (Design §5.4)
// ---------------------------------------------------------------------------

export interface PluginComponentStateEntry {
  readonly enabled: boolean;
  readonly lastKnownValid?: boolean;
}

export interface PluginMcpToolConfig {
  readonly enabled?: boolean;
  readonly customConfig?: Record<string, unknown>;
}

export interface PluginComponentState {
  readonly skills?: Record<string, PluginComponentStateEntry>;
  readonly mcpServers?: Record<
    string,
    {
      readonly enabled: boolean;
      readonly toolConfig?: Record<string, PluginMcpToolConfig>;
    }
  >;
}

// ---------------------------------------------------------------------------
// Errors (Design §14)
// ---------------------------------------------------------------------------

export type PluginErrorCode =
  | "manifest-not-found"
  | "manifest-invalid-json"
  | "manifest-schema-invalid"
  | "plugin-name-conflict"
  | "plugin-version-invalid"
  | "path-outside-plugin"
  | "component-not-found"
  | "skill-manifest-invalid"
  | "skill-import-failed"
  | "mcp-config-invalid"
  | "mcp-server-conflict"
  | "permission-denied"
  | "dependency-unsatisfied"
  | "install-io-failed"
  | "cache-missing"
  | "uninstall-failed"
  | "unknown";

export interface PluginError {
  readonly code: PluginErrorCode;
  readonly pluginName?: string;
  readonly componentType?: "plugin" | "skill" | "mcpServer";
  readonly componentName?: string;
  readonly path?: string;
  readonly message: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Summaries and inputs (Design §11.2, §6.2)
// ---------------------------------------------------------------------------

export interface PluginSummary {
  readonly id: number;
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly health: PluginHealth;
  readonly skillCount: number;
  readonly mcpServerCount: number;
  readonly permissions: readonly string[];
  readonly lastUpdated: string;
}

export interface PluginSkillComponent {
  readonly name: string;
  readonly enabled: boolean;
  readonly manifestPath: string;
  readonly health: PluginHealth;
  readonly error?: string;
}

export interface PluginMcpServerComponent {
  readonly name: string;
  readonly enabled: boolean;
  readonly transport: PluginMcpTransport;
  readonly health: PluginHealth;
  readonly toolCount: number;
  readonly error?: string;
}

export interface PluginDetail extends PluginSummary {
  readonly description: string;
  readonly author?: string;
  readonly skills: readonly PluginSkillComponent[];
  readonly mcpServers: readonly PluginMcpServerComponent[];
  readonly errors: readonly PluginError[];
  readonly manifest: Record<string, unknown>;
}

export interface PluginValidationResult {
  readonly valid: boolean;
  readonly errors: readonly PluginError[];
  readonly manifest?: PluginManifest;
}

export interface CreateInstalledPluginInput {
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly source: PluginSource;
  readonly installPath: string;
  readonly manifestJson: string;
  readonly permissionsJson?: string;
  readonly componentStateJson?: string;
  readonly enabled?: number;
  readonly health?: PluginHealth;
}

export interface UpdatePluginStateInput {
  readonly displayName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly manifestJson?: string;
  readonly permissionsJson?: string;
  readonly componentStateJson?: string;
  readonly health?: PluginHealth;
  readonly lastLoadErrorsJson?: string;
}

export interface PluginUninstallResult {
  readonly removedPlugin: boolean;
  readonly removedSkillNames: readonly string[];
  readonly removedMcpServerNames: readonly string[];
  readonly errors: readonly PluginError[];
}

// ---------------------------------------------------------------------------
// Package limits (Design §7.2)
// ---------------------------------------------------------------------------

export const PLUGIN_PACKAGE_LIMITS = {
  maxZipBytes: 50 * 1024 * 1024,
  maxExtractedBytes: 250 * 1024 * 1024,
  maxFiles: 5000,
} as const;

// ---------------------------------------------------------------------------
// Validation regexes (Design §4.2 validation constraints)
// ---------------------------------------------------------------------------

export const PLUGIN_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;
export const PLUGIN_SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;

// ---------------------------------------------------------------------------
// Path safety (Design §7.1)
// ---------------------------------------------------------------------------

/**
 * Resolve a plugin-relative path and verify it stays inside the plugin root.
 * Throws an Error when the relative path escapes the plugin directory.
 */
export function resolvePluginRelativePath(
  pluginRoot: string,
  relativePath: string
): string {
  const root = path.resolve(pluginRoot);
  const resolved = path.resolve(path.join(root, relativePath));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path "${relativePath}" escapes plugin directory`);
  }
  return resolved;
}
