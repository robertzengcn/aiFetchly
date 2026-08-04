import type { PluginMarketplaceSourceKind } from "@/entityTypes/pluginMarketplaceTypes";
import type { PluginMarketplaceFetcher } from "./marketplaceFetcherTypes";
import { GitMarketplaceFetcher } from "./GitMarketplaceFetcher";
import { GitHubMarketplaceFetcher } from "./GitHubMarketplaceFetcher";
import { LocalMarketplaceFetcher } from "./LocalMarketplaceFetcher";
import { UrlMarketplaceFetcher } from "./UrlMarketplaceFetcher";

export class PluginMarketplaceFetcherRegistry {
  private readonly fetchers = new Map<
    PluginMarketplaceSourceKind,
    PluginMarketplaceFetcher
  >();

  /**
   * Register a fetcher. By default it is keyed by its own `kind`; pass an
   * explicit `kind` to register the same fetcher instance under an alias
   * (e.g. LocalMarketplaceFetcher handles both `local-folder` and `local-file`).
   */
  register(
    fetcher: PluginMarketplaceFetcher,
    kind: PluginMarketplaceSourceKind = fetcher.kind
  ): void {
    this.fetchers.set(kind, fetcher);
  }

  get(kind: PluginMarketplaceSourceKind): PluginMarketplaceFetcher {
    const f = this.fetchers.get(kind);
    if (!f) {
      throw new Error(
        `No fetcher registered for marketplace source kind "${kind}"`
      );
    }
    return f;
  }
}

export function createDefaultMarketplaceFetcherRegistry(): PluginMarketplaceFetcherRegistry {
  const reg = new PluginMarketplaceFetcherRegistry();
  const git = new GitMarketplaceFetcher();
  reg.register(git);
  reg.register(new GitHubMarketplaceFetcher(git));
  const local = new LocalMarketplaceFetcher();
  reg.register(local); // local-folder
  reg.register(local, "local-file"); // local-file reuses the same fetcher
  reg.register(new UrlMarketplaceFetcher());
  return reg;
}
