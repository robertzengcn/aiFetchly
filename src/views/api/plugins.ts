import { windowInvoke } from "@/views/utils/apirequest";
import {
  PLUGIN_IMPORT,
  PLUGIN_INSTALL_FROM_SOURCE,
  PLUGIN_VALIDATE_PACKAGE,
  PLUGIN_LIST,
  PLUGIN_GET,
  PLUGIN_TOGGLE,
  PLUGIN_UNINSTALL,
  PLUGIN_RELOAD,
  PLUGIN_EXPORT_DIAGNOSTICS,
  PLUGIN_TOGGLE_SKILL,
  PLUGIN_TOGGLE_MCP_SERVER,
  PLUGIN_TOGGLE_MCP_TOOL,
  PLUGIN_TEST_MCP_CONNECTION,
  PLUGIN_DISCOVER_MCP_TOOLS,
} from "@/config/channellist";

/**
 * Renderer API client for the Plugin Management System.
 * Source of truth: Design §11.2.
 */

export type PluginSource = "local" | "builtin" | "marketplace";

export type PluginHealth =
  | "healthy"
  | "disabled"
  | "needs_configuration"
  | "partial_load"
  | "invalid"
  | "missing_files";

export interface PluginSummary {
  id: number;
  name: string;
  displayName?: string;
  version: string;
  source: PluginSource;
  enabled: boolean;
  health: PluginHealth;
  skillCount: number;
  mcpServerCount: number;
  permissions: string[];
  lastUpdated: string;
}

export interface PluginSkillComponent {
  name: string;
  enabled: boolean;
  manifestPath: string;
  health: string;
  error?: string;
}

export interface PluginMcpServerComponent {
  id: number;
  name: string;
  enabled: boolean;
  transport: string;
  health: string;
  toolCount: number;
  error?: string;
}

export interface PluginDetail extends PluginSummary {
  description: string;
  author?: string;
  skills: PluginSkillComponent[];
  mcpServers: PluginMcpServerComponent[];
  errors: Array<{ code: string; message: string; recoverable: boolean }>;
  manifest: Record<string, unknown>;
  sourceKind?: PluginSourceKind;
  sourceUri?: string;
  sourceRef?: string;
}

export type PluginSourceKind =
  | "local-zip"
  | "local-folder"
  | "git"
  | "github"
  | "npm"
  | "url";

export interface PluginInstallSourceRequest {
  kind: PluginSourceKind;
  overwrite?: boolean;
  zipPath?: string;
  folderPath?: string;
  uri?: string;
  ref?: string;
  npmPackage?: string;
  npmVersion?: string;
  npmRegistry?: string;
  npmAuthScope?: string;
  npmAuthToken?: string;
}

export interface PluginValidationResult {
  valid: boolean;
  errors?: Array<{ code: string; message: string }>;
  name?: string;
  version?: string;
}

export interface PluginDiagnosticsBundle {
  pluginName: string;
  generatedAt: string;
  summary: PluginSummary;
  manifest: Record<string, unknown>;
  errors: Array<{ code: string; message: string; recoverable: boolean }>;
  skills: Array<{ name: string; enabled: boolean; health: string }>;
  mcpServers: Array<{
    serverName: string;
    enabled: boolean;
    transport: string;
    health: string;
  }>;
}

export async function listPlugins(): Promise<PluginSummary[] | null> {
  return await windowInvoke(PLUGIN_LIST);
}

export async function getPlugin(name: string): Promise<PluginDetail | null> {
  return await windowInvoke(PLUGIN_GET, { name });
}

export async function importPlugin(
  zipPath: string,
  overwrite = false
): Promise<PluginSummary | null> {
  return await windowInvoke(PLUGIN_IMPORT, { zipPath, overwrite });
}

export async function installPluginFromSource(
  req: PluginInstallSourceRequest
): Promise<PluginSummary | null> {
  return await windowInvoke(PLUGIN_INSTALL_FROM_SOURCE, req);
}

export async function validatePluginPackage(
  zipPath: string
): Promise<PluginValidationResult | null> {
  return await windowInvoke(PLUGIN_VALIDATE_PACKAGE, { zipPath });
}

export async function togglePlugin(
  name: string,
  enabled: boolean
): Promise<void> {
  await windowInvoke(PLUGIN_TOGGLE, { name, enabled });
}

export async function uninstallPlugin(name: string): Promise<void> {
  await windowInvoke(PLUGIN_UNINSTALL, { name });
}

export async function reloadPlugins(): Promise<{
  enabled: number;
  disabled: number;
  errors: number;
} | null> {
  return await windowInvoke(PLUGIN_RELOAD);
}

export async function exportPluginDiagnostics(
  name: string
): Promise<PluginDiagnosticsBundle | null> {
  return await windowInvoke(PLUGIN_EXPORT_DIAGNOSTICS, { name });
}

export async function togglePluginSkill(
  skillName: string,
  enabled: boolean
): Promise<void> {
  await windowInvoke(PLUGIN_TOGGLE_SKILL, { skillName, enabled });
}

export async function togglePluginMcpServer(
  serverId: number,
  enabled: boolean
): Promise<void> {
  await windowInvoke(PLUGIN_TOGGLE_MCP_SERVER, { serverId, enabled });
}

export async function togglePluginMcpTool(
  serverId: number,
  toolName: string,
  enabled: boolean
): Promise<void> {
  await windowInvoke(PLUGIN_TOGGLE_MCP_TOOL, { serverId, toolName, enabled });
}

export async function testPluginMcpConnection(
  serverId: number
): Promise<boolean | null> {
  return await windowInvoke(PLUGIN_TEST_MCP_CONNECTION, { serverId });
}

export async function discoverPluginMcpTools(
  serverId: number
): Promise<unknown> {
  return await windowInvoke(PLUGIN_DISCOVER_MCP_TOOLS, { serverId });
}
