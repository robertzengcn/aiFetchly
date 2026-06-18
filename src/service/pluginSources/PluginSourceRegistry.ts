import type { PluginSourceKind } from "@/entityTypes/pluginTypes";
import type { PluginSourceFetcher } from "./pluginSourceTypes";

/**
 * Lookup table mapping source kind → fetcher. Tests can register stubs.
 * Source of truth: Spec §4.3.
 */
export class PluginSourceRegistry {
  private readonly fetchers = new Map<PluginSourceKind, PluginSourceFetcher>();

  register(fetcher: PluginSourceFetcher): void {
    this.fetchers.set(fetcher.kind, fetcher);
  }

  get(kind: PluginSourceKind): PluginSourceFetcher {
    const f = this.fetchers.get(kind);
    if (!f) {
      throw new Error(`No fetcher registered for source kind "${kind}"`);
    }
    return f;
  }

  has(kind: PluginSourceKind): boolean {
    return this.fetchers.has(kind);
  }
}
