import type { PluginSourceKind } from "@/entityTypes/pluginTypes";

// ---------------------------------------------------------------------------
// Marketplace source (PRD §8.1)
// ---------------------------------------------------------------------------

export type PluginMarketplaceSourceKind =
  | "github"
  | "git"
  | "local-folder"
  | "local-file"
  | "url"
  | "aifetch-hub";

export interface PluginMarketplaceSource {
  readonly kind: PluginMarketplaceSourceKind;
  readonly uri: string;
  readonly ref?: string;
}

// ---------------------------------------------------------------------------
// Manifest (PRD §8.2, tech design §5.2)
// ---------------------------------------------------------------------------

export interface PluginMarketplaceOwner {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
}

export interface PluginMarketplaceMetadata {
  readonly pluginRoot?: string;
  readonly description?: string;
  readonly version?: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Plugin entry + entry sources (PRD §8.3, tech design §5.3)
// ---------------------------------------------------------------------------

export interface PluginMarketplaceGithubSource {
  readonly source: "github";
  readonly repo: string;
  readonly ref?: string;
  readonly sha?: string;
}
export interface PluginMarketplaceGitUrlSource {
  readonly source: "url";
  readonly url: string;
  readonly ref?: string;
  readonly sha?: string;
}
export interface PluginMarketplaceGitSubdirSource {
  readonly source: "git-subdir";
  readonly url: string;
  readonly path: string;
  readonly ref?: string;
  readonly sha?: string;
}
export interface PluginMarketplaceNpmSource {
  readonly source: "npm";
  readonly package: string;
  readonly version?: string;
  readonly registry?: string;
}

export type PluginMarketplaceEntrySource =
  | string
  | PluginMarketplaceGithubSource
  | PluginMarketplaceGitUrlSource
  | PluginMarketplaceGitSubdirSource
  | PluginMarketplaceNpmSource;

export interface PluginMarketplaceEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly version?: string;
  readonly author?: string | PluginMarketplaceOwner;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source: PluginMarketplaceEntrySource;
  readonly defaultEnabled?: boolean;
  readonly strict?: boolean;
  readonly relevance?: unknown;
  readonly skills?: unknown;
  readonly commands?: unknown;
  readonly agents?: unknown;
  readonly hooks?: unknown;
  readonly mcpServers?: unknown;
  readonly lspServers?: unknown;
  readonly outputStyles?: unknown;
  readonly experimental?: unknown;
}

export interface PluginMarketplaceManifest {
  readonly name: string;
  readonly owner: PluginMarketplaceOwner;
  readonly description?: string;
  readonly version?: string;
  readonly metadata?: PluginMarketplaceMetadata;
  readonly plugins: readonly PluginMarketplaceEntry[];
  readonly renames?: Record<string, string | null>;
  readonly allowCrossMarketplaceDependenciesOn?: readonly string[];
}

// ---------------------------------------------------------------------------
// Health + errors (tech design §4.1, §6)
// ---------------------------------------------------------------------------

export type PluginMarketplaceHealth =
  | "healthy"
  | "disabled"
  | "invalid"
  | "fetch_failed"
  | "missing_files";

export type PluginMarketplaceErrorCode =
  | "marketplace-source-invalid"
  | "marketplace-fetch-failed"
  | "marketplace-manifest-not-found"
  | "marketplace-manifest-invalid-json"
  | "marketplace-schema-invalid"
  | "marketplace-name-conflict"
  | "marketplace-plugin-entry-invalid"
  | "marketplace-plugin-source-unsupported"
  | "marketplace-plugin-source-outside-root"
  | "marketplace-cache-missing"
  | "marketplace-remove-failed"
  | "unknown";

export interface PluginMarketplaceError {
  readonly code: PluginMarketplaceErrorCode;
  readonly marketplaceName?: string;
  readonly pluginName?: string;
  readonly path?: string;
  readonly message: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// DTOs (tech design §5.4)
// ---------------------------------------------------------------------------

export interface PluginMarketplaceSummary {
  readonly id: number;
  readonly name: string;
  readonly displayName?: string;
  readonly ownerName: string;
  readonly description?: string;
  readonly version?: string;
  readonly sourceKind: PluginMarketplaceSourceKind;
  readonly sourceUri: string;
  readonly sourceRef?: string;
  readonly pluginCount: number;
  readonly enabled: boolean;
  readonly autoUpdate: boolean;
  readonly health: PluginMarketplaceHealth;
  readonly lastFetchedAt?: string;
  readonly updatedAt?: string;
}

export interface PluginMarketplaceDetail extends PluginMarketplaceSummary {
  readonly ownerEmail?: string;
  readonly ownerUrl?: string;
  readonly manifest: PluginMarketplaceManifest;
  readonly errors: readonly PluginMarketplaceError[];
  readonly installPath?: string;
  readonly sourceMeta: Record<string, unknown>;
}

export interface PluginMarketplaceCapabilitySummary {
  readonly hasSkills: boolean;
  readonly hasCommands: boolean;
  readonly hasAgents: boolean;
  readonly hasHooks: boolean;
  readonly hasMcpServers: boolean;
  readonly hasLspServers: boolean;
  readonly hasOutputStyles: boolean;
  readonly hasMonitors: boolean;
}

export type PluginMarketplacePluginStatus =
  | "not_installed"
  | "installed"
  | "different_version"
  | "unsupported"
  | "error";

export interface PluginMarketplacePluginSummary {
  readonly pluginId: string; // `${entry.name}@${marketplace.name}`
  readonly name: string;
  readonly displayName?: string;
  readonly marketplaceName: string;
  readonly marketplaceDisplayName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly sourceKind: string;
  readonly capabilitySummary: PluginMarketplaceCapabilitySummary;
  readonly installed: boolean;
  readonly installedVersion?: string;
  readonly status: PluginMarketplacePluginStatus;
  readonly errors: readonly PluginMarketplaceError[];
}

export interface PluginMarketplacePluginDetail
  extends PluginMarketplacePluginSummary {
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly entry: PluginMarketplaceEntry;
  readonly resolvedSourceKind?: PluginSourceKind;
  readonly resolvedSourceUri?: string;
  readonly resolvedSourceRef?: string;
  readonly pinnedToCommit: boolean;
}

// ---------------------------------------------------------------------------
// Request types (tech design §11, §13)
// ---------------------------------------------------------------------------

export interface AddPluginMarketplaceRequest {
  readonly source: string;
  readonly ref?: string;
  readonly overwrite?: boolean;
}

export interface InstallMarketplacePluginRequest {
  readonly pluginId: string; // `name@marketplace`
  readonly overwrite?: boolean;
  readonly enableAfterInstall?: boolean;
  readonly npmAuthToken?: string;
}

export interface PluginMarketplacePluginFilter {
  readonly search?: string;
  readonly marketplaceName?: string;
  readonly category?: string;
  readonly installed?: boolean;
  readonly hasSkills?: boolean;
  readonly hasMcpServers?: boolean;
  readonly hasHooks?: boolean;
}

/** Provenance stored on the installed plugin row under sourceMetaJson.marketplace. */
export interface MarketplaceInstallMeta {
  readonly marketplaceName: string;
  readonly marketplaceSource: PluginMarketplaceSource;
  readonly marketplaceVersion?: string;
  readonly entryName: string;
  readonly entryVersion?: string;
  readonly entrySource: PluginMarketplaceEntrySource;
  readonly resolvedSourceKind: PluginSourceKind;
  readonly resolvedSourceUri?: string;
  readonly resolvedSourceRef?: string;
  readonly resolvedAt: string;
}
