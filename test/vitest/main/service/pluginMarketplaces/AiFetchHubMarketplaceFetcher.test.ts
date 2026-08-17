import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

import {
  AiFetchHubMarketplaceFetcher,
  type HubCatalogClient,
} from "@/service/pluginMarketplaces/AiFetchHubMarketplaceFetcher";

const HUB_ENTRY_GITHUB = {
  slug: "pdf-tools",
  displayName: "PDF Tools",
  description: "Convert and merge PDFs",
  owner: "AiFetchly",
  category: "productivity",
  tags: ["pdf", "files"],
  version: "1.2.0",
  access: { status: "allowed", installMode: "direct" },
  source: { source: "github", repo: "aifetchly/pdf-tools", ref: "v1.2.0" },
};

const HUB_ENTRY_TICKET = {
  slug: "pro-seo-suite",
  displayName: "Pro SEO Suite",
  description: "Paid SEO automation",
  access: { status: "subscription_required", installMode: "ticket" },
};

const HUB_ENTRY_GENERIC_SOURCE = {
  slug: "web-scraper",
  displayName: "Web Scraper",
  access: { status: "allowed", installMode: "direct" },
  source: { kind: "url", uri: "https://git.example.com/web-scraper.git" },
};

describe("AiFetchHubMarketplaceFetcher", () => {
  let getClient: () => HubCatalogClient;
  let getFirstParty: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "https://plugins.example.com");
    getFirstParty = vi.fn();
    getClient = () => ({ getFirstParty });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeFetcher(): AiFetchHubMarketplaceFetcher {
    return new AiFetchHubMarketplaceFetcher(getClient);
  }

  test("fetches the configured hub catalog and synthesizes a manifest", async () => {
    getFirstParty.mockResolvedValueOnce({
      plugins: [HUB_ENTRY_GITHUB, HUB_ENTRY_TICKET],
    });

    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "https://ignored.example.com" },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(getFirstParty).toHaveBeenCalledTimes(1);
    const [url, options] = getFirstParty.mock.calls[0] as [
      string,
      RequestInit?
    ];
    expect(url).toBe("https://plugins.example.com/api/v1/plugins/catalog");
    expect(options?.signal).toBeInstanceOf(AbortSignal);

    const manifest = JSON.parse(result.marketplace.manifestJson);
    expect(manifest.name).toBe("aifetch-plugin-hub");
    expect(manifest.owner.name).toBe("AiFetchly Plugin Hub");
    expect(manifest.plugins).toHaveLength(2);

    const direct = manifest.plugins[0];
    expect(direct.name).toBe("pdf-tools");
    expect(direct.slug).toBe("pdf-tools");
    expect(direct.displayName).toBe("PDF Tools");
    expect(direct.access).toEqual({
      status: "allowed",
      installMode: "direct",
    });
    expect(direct.source).toEqual({
      source: "github",
      repo: "aifetchly/pdf-tools",
      ref: "v1.2.0",
    });

    const locked = manifest.plugins[1];
    expect(locked.access.status).toBe("subscription_required");
    expect(locked.source).toBeUndefined();

    // In-memory manifest: no cache dir lifecycle for the hub kind.
    await expect(result.marketplace.cleanup()).resolves.toBeUndefined();
  });

  test("normalizes generic {kind,uri} hub source descriptors", async () => {
    getFirstParty.mockResolvedValueOnce({
      plugins: [HUB_ENTRY_GENERIC_SOURCE],
    });
    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "" },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    const manifest = JSON.parse(result.marketplace.manifestJson);
    expect(manifest.plugins[0].source).toEqual({
      source: "url",
      url: "https://git.example.com/web-scraper.git",
    });
  });

  test("rejects a non-https hub base that is not localhost (hardening)", async () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "http://hub.insecure.example.com");
    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "" },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.errors[0].code).toBe("marketplace-source-invalid");
    expect(getFirstParty).not.toHaveBeenCalled();
  });

  test("allows http localhost for dev against the hub docker-compose", async () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "http://localhost:8080");
    getFirstParty.mockResolvedValueOnce({ plugins: [] });
    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "" },
    });
    expect(result.success).toBe(true);
    expect(getFirstParty.mock.calls[0][0]).toBe(
      "http://localhost:8080/api/v1/plugins/catalog"
    );
  });

  test("returns marketplace-fetch-failed for an invalid hub payload", async () => {
    getFirstParty.mockResolvedValueOnce({
      plugins: [{ slug: "no-access-field" }],
    });
    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "" },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.errors[0].code).toBe("marketplace-fetch-failed");
  });

  test("wraps client errors as marketplace-fetch-failed", async () => {
    getFirstParty.mockRejectedValueOnce(new Error("HTTP 503"));
    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "" },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.errors[0].code).toBe("marketplace-fetch-failed");
    expect(result.errors[0].message).toContain("HTTP 503");
  });

  test("marketplace-shaped sources are rebuilt from validated fields only", async () => {
    // Undeclared passthrough keys must be dropped, not smuggled into the
    // install pipeline (registry/sha reach CLI args downstream).
    getFirstParty.mockResolvedValueOnce({
      plugins: [
        {
          slug: "gh",
          displayName: "GH",
          access: { status: "allowed", installMode: "direct" },
          source: {
            source: "github",
            repo: "aifetchly/gh",
            ref: "v1",
            sneaky: "drop-me",
          },
        },
      ],
    });
    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "" },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    const manifest = JSON.parse(result.marketplace.manifestJson);
    expect(manifest.plugins[0].source).toEqual({
      source: "github",
      repo: "aifetchly/gh",
      ref: "v1",
    });
  });

  test("emits homepage/repository/license detail fields when the hub provides them", async () => {
    getFirstParty.mockResolvedValueOnce({
      plugins: [
        {
          slug: "rich",
          displayName: "Rich",
          access: { status: "allowed", installMode: "direct" },
          source: { source: "npm", package: "rich-pkg" },
          homepage: "https://example.com",
          repository: "https://github.com/aifetchly/rich",
          license: "MIT",
        },
      ],
    });
    const result = await makeFetcher().fetch({
      source: { kind: "aifetch-hub", uri: "" },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    const manifest = JSON.parse(result.marketplace.manifestJson);
    expect(manifest.plugins[0].homepage).toBe("https://example.com");
    expect(manifest.plugins[0].repository).toBe(
      "https://github.com/aifetchly/rich"
    );
    expect(manifest.plugins[0].license).toBe("MIT");
  });
});
