import type {
  PluginMarketplaceError,
  PluginMarketplaceSource,
  PluginMarketplaceSourceKind,
} from "@/entityTypes/pluginMarketplaceTypes";

export interface PluginMarketplaceFetchRequest {
  readonly source: PluginMarketplaceSource;
  readonly onProgress?: (msg: string, pct?: number) => void;
}

export interface FetchedPluginMarketplace {
  /** Absolute path to the marketplace root (repo root or cache dir). */
  readonly marketplaceRoot: string;
  /** Absolute path to the located marketplace.json. */
  readonly manifestPath: string;
  /** Raw manifest JSON string. */
  readonly manifestJson: string;
  /** Caller MUST invoke after persist/rollback, even on failure. */
  readonly cleanup: () => Promise<void>;
}

export type PluginMarketplaceFetchResult =
  | { success: true; marketplace: FetchedPluginMarketplace }
  | { success: false; errors: readonly PluginMarketplaceError[] };

export interface PluginMarketplaceFetcher {
  readonly kind: PluginMarketplaceSourceKind;
  fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult>;
}

export function mktErr(
  code: PluginMarketplaceError["code"],
  message: string,
  extras: Partial<PluginMarketplaceError> = {}
): PluginMarketplaceError {
  return { code, message, recoverable: false, ...extras };
}
