import type {
  PluginMarketplaceEntry,
  PluginMarketplaceEntrySource,
} from "@/entityTypes/pluginMarketplaceTypes";

/**
 * Community Plugins types (Community Plugin Page PRD §7.5 / tech design §8).
 *
 * The desktop is a thin consumer of the AiFetchly Plugin Hub catalog: the Hub
 * derives the viewer's segment server-side (it introspects the forwarded
 * marketing JWT) and returns per-row `access` decisions. The desktop never
 * classifies free-vs-paid itself and never re-derives tier.
 */

/** Per-row viewer access decision, made entirely by the Hub. */
export type PluginCommunityAccessStatus =
  | "allowed"
  | "login_required"
  | "subscription_required"
  | "forbidden"
  | "unavailable";

/** Install channel for the row (hub tech design §9.3). */
export type PluginCommunityInstallMode = "direct" | "ticket";

export interface PluginCommunityAccess {
  readonly status: PluginCommunityAccessStatus;
  readonly installMode: PluginCommunityInstallMode;
}

/** Row shape returned to the renderer by PLUGIN_COMMUNITY_LIST/DETAIL. */
export interface PluginCommunityEntry {
  /** Hub slug — canonical identifier used for detail/install. */
  readonly slug: string;
  /** Marketplace canonical name (identical to slug in synthesized manifests). */
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly owner?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly access: PluginCommunityAccess;
  /** Populated by cross-referencing installed plugins (service layer). */
  readonly installed: boolean;
}

/** Stage 1 detail = the list row; reserved for extra fields in later stages. */
export interface PluginCommunityDetail extends PluginCommunityEntry {
  readonly version?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
}

export interface PluginCommunityFilter {
  readonly forceRefresh?: boolean;
  readonly category?: string;
  readonly search?: string;
}

/**
 * Plugin entry as stored inside the built-in hub marketplace's cached
 * manifest: a marketplace-shaped entry (so `resolveMarketplaceEntrySource`
 * can install `direct` entries through the existing pipeline) carrying the
 * hub-only `slug`/`access`/`owner` fields as passthrough extras. `source`
 * is optional: locked (`ticket`) rows deliberately carry none.
 */
export interface HubManifestPluginEntry
  extends Omit<PluginMarketplaceEntry, "source"> {
  readonly source?: PluginMarketplaceEntrySource;
  readonly slug: string;
  readonly access: PluginCommunityAccess;
  readonly owner?: string;
}
