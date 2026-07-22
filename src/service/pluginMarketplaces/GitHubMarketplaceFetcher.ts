import type {
  PluginMarketplaceFetchResult,
  PluginMarketplaceFetcher,
  PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";
import { GitMarketplaceFetcher } from "./GitMarketplaceFetcher";

/**
 * GitHub shorthand owner/repo -> https://github.com/owner/repo.git -> git fetch.
 * Relies on the user's git credential helper / SSH agent for private repos.
 */
export class GitHubMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "github" as const;

  constructor(private readonly git: GitMarketplaceFetcher = new GitMarketplaceFetcher()) {}

  async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const repo = req.source.uri.trim();
    // Convert owner/repo to a cloneable URL.
    const uri = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9_.-]+$/i.test(repo)
      ? `https://github.com/${repo}.git`
      : repo;
    return this.git.fetch({
      ...req,
      source: { ...req.source, kind: "git", uri },
    });
  }
}
