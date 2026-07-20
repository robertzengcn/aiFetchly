import { windowInvoke } from "@/views/utils/apirequest";
import {
  PLUGIN_MARKETPLACE_LIST,
  PLUGIN_MARKETPLACE_GET,
  PLUGIN_MARKETPLACE_ADD,
  PLUGIN_MARKETPLACE_REFRESH,
  PLUGIN_MARKETPLACE_REMOVE,
  PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
  PLUGIN_MARKETPLACE_GET_PLUGIN,
  PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
} from "@/config/channellist";

/**
 * Renderer API client for the Plugin Marketplace System.
 * Source of truth: Marketplace PRD §11.1.
 */

export type PluginMarketplaceHealth =
  | "healthy" | "disabled" | "invalid" | "fetch_failed" | "missing_files";

export interface PluginMarketplaceSummary {
  id: number;
  name: string;
  displayName?: string;
  ownerName: string;
  description?: string;
  version?: string;
  sourceKind: string;
  sourceUri: string;
  sourceRef?: string;
  pluginCount: number;
  enabled: boolean;
  autoUpdate: boolean;
  health: PluginMarketplaceHealth;
  lastFetchedAt?: string;
  updatedAt?: string;
}

export interface PluginMarketplacePluginSummary {
  pluginId: string;
  name: string;
  displayName?: string;
  marketplaceName: string;
  marketplaceDisplayName?: string;
  version?: string;
  description?: string;
  author?: string;
  category?: string;
  tags: string[];
  sourceKind: string;
  capabilitySummary: {
    hasSkills: boolean; hasCommands: boolean; hasAgents: boolean;
    hasHooks: boolean; hasMcpServers: boolean; hasLspServers: boolean;
    hasOutputStyles: boolean; hasMonitors: boolean;
  };
  installed: boolean;
  installedVersion?: string;
  status: "not_installed" | "installed" | "different_version" | "unsupported" | "error";
  errors: Array<{ code: string; message: string; recoverable: boolean }>;
}

export interface PluginMarketplacePluginDetail extends PluginMarketplacePluginSummary {
  homepage?: string;
  repository?: string;
  license?: string;
  resolvedSourceKind?: string;
  resolvedSourceUri?: string;
  resolvedSourceRef?: string;
  pinnedToCommit: boolean;
}

export interface AddPluginMarketplaceRequest {
  source: string;
  ref?: string;
  overwrite?: boolean;
}

export interface InstallMarketplacePluginRequest {
  pluginId: string;
  overwrite?: boolean;
  enableAfterInstall?: boolean;
  npmAuthToken?: string;
}

export interface PluginMarketplacePluginFilter {
  search?: string;
  marketplaceName?: string;
  category?: string;
  installed?: boolean;
  hasSkills?: boolean;
  hasMcpServers?: boolean;
  hasHooks?: boolean;
}

export async function listPluginMarketplaces(): Promise<PluginMarketplaceSummary[] | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_LIST);
}
export async function getPluginMarketplace(name: string): Promise<unknown> {
  return await windowInvoke(PLUGIN_MARKETPLACE_GET, { name });
}
export async function addPluginMarketplace(
  req: AddPluginMarketplaceRequest
): Promise<PluginMarketplaceSummary | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_ADD, req);
}
export async function refreshPluginMarketplace(name: string): Promise<PluginMarketplaceSummary | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_REFRESH, { name });
}
export async function removePluginMarketplace(name: string): Promise<void> {
  await windowInvoke(PLUGIN_MARKETPLACE_REMOVE, { name });
}
export async function listMarketplacePlugins(
  filter: PluginMarketplacePluginFilter = {}
): Promise<PluginMarketplacePluginSummary[] | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS, filter);
}
export async function getMarketplacePlugin(pluginId: string): Promise<PluginMarketplacePluginDetail | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_GET_PLUGIN, { pluginId });
}
export async function installMarketplacePlugin(
  req: InstallMarketplacePluginRequest
): Promise<unknown> {
  return await windowInvoke(PLUGIN_MARKETPLACE_INSTALL_PLUGIN, req);
}
