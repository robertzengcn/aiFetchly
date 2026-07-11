import type { PluginMarketplaceSourceKind } from "@/entityTypes/pluginMarketplaceTypes";
import type { PluginMarketplaceFetcher } from "./marketplaceFetcherTypes";
import { GitMarketplaceFetcher } from "./GitMarketplaceFetcher";
import { GitHubMarketplaceFetcher } from "./GitHubMarketplaceFetcher";
import { LocalMarketplaceFetcher } from "./LocalMarketplaceFetcher";
import { UrlMarketplaceFetcher } from "./UrlMarketplaceFetcher";

export class PluginMarketplaceFetcherRegistry {
  private readonly fetchers = new Map<PluginMarketplaceSourceKind, PluginMarketplaceFetcher>();

  register(fetcher: PluginMarketplaceFetcher): void {
    this.fetchers.set(fetcher.kind, fetcher);
  }

  get(kind: PluginMarketplaceSourceKind): PluginMarketplaceFetcher {
    const f = this.fetchers.get(kind);
    if (!f) {
      throw new Error(`No fetcher registered for marketplace source kind "${kind}"`);
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
  reg.register(local);
  reg.register(local); // local-file reuses LocalMarketplaceFetcher
  reg.register(new UrlMarketplaceFetcher());
  return reg;
}
