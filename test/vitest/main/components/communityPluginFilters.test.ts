import { describe, expect, it } from "vitest";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";
import {
  buildCommunityTagFacets,
  communityEntryFacetValues,
  communityPluginSearchDocument,
  filterCommunityPlugins,
  matchesCommunityAvailability,
  normalizeCommunityFilterValue,
  visibleCommunityTagFacets,
} from "@/views/utils/communityPluginFilters";

/**
 * Minimal entry factory. Only slug/name/displayName are set by default so
 * tests can opt INTO category/tags explicitly — otherwise inherited defaults
 * would contaminate facet counts and search documents.
 */
function entry(
  overrides: Partial<PluginCommunityEntry> = {}
): PluginCommunityEntry {
  return {
    slug: "pdf-tools",
    name: "pdf-tools",
    displayName: "PDF Tools",
    description: "Extract, transform, and process PDF documents.",
    owner: "AiFetchly",
    access: { status: "allowed", installMode: "direct" },
    installed: false,
    ...overrides,
  };
}

describe("communityPluginFilters", () => {
  it("normalizer trims and lowercases the input", () => {
    expect(normalizeCommunityFilterValue("  SEO  ")).toBe("seo");
    expect(normalizeCommunityFilterValue("Email\nMarketing")).toBe(
      "email\nmarketing"
    );
    expect(normalizeCommunityFilterValue("")).toBe("");
  });

  it("search document contains every searchable field", () => {
    const doc = communityPluginSearchDocument(
      entry({ category: "Productivity", tags: ["PDF", "Documents"] })
    );
    expect(doc).toContain("pdf tools");
    expect(doc).toContain("pdf-tools");
    expect(doc).toContain("extract, transform, and process pdf documents.");
    expect(doc).toContain("aifetchly");
    expect(doc).toContain("productivity");
    expect(doc).toContain("pdf");
    expect(doc).toContain("documents");
  });

  it("empty optional values do not produce errors or blanks", () => {
    const e = entry({ owner: undefined, category: undefined, tags: undefined });
    const doc = communityPluginSearchDocument(e);
    // No stray separators surface as undefined/null.
    expect(doc).not.toContain("undefined");
    expect(doc).not.toContain("null");
    expect(doc).toContain("pdf tools");
  });

  it("counts category and duplicate tag at most once per plugin", () => {
    const e = entry({
      category: "Marketing",
      tags: ["SEO", "seo", "Marketing"],
    });
    const values = communityEntryFacetValues(e);
    const keys = values.map((v) => v.key);
    expect(keys).toEqual(expect.arrayContaining(["marketing", "seo"]));
    // "marketing" appears once even though it's both category and a tag.
    expect(keys.filter((k) => k === "marketing")).toHaveLength(1);
    expect(keys.filter((k) => k === "seo")).toHaveLength(1);
    expect(values).toHaveLength(2);
  });

  it("facets sort by count descending then label alphabetically", () => {
    const entries: PluginCommunityEntry[] = [
      entry({ slug: "a", category: "Marketing" }),
      entry({ slug: "b", category: "Marketing", tags: ["SEO"] }),
      entry({ slug: "c", category: "Marketing", tags: ["SEO"] }),
      entry({ slug: "d", category: "AI" }),
    ];
    const facets = buildCommunityTagFacets(entries);
    // Marketing=3, SEO=2, AI=1 — count desc.
    expect(facets.map((f) => f.label)).toEqual(["Marketing", "SEO", "AI"]);
  });

  it("labels preserve the first catalog spelling encountered", () => {
    const entries: PluginCommunityEntry[] = [
      entry({ slug: "a", tags: ["seo"] }),
      entry({ slug: "b", tags: ["SEO"] }),
      entry({ slug: "c", tags: ["Seo"] }),
    ];
    const facets = buildCommunityTagFacets(entries);
    expect(facets[0].label).toBe("seo");
    expect(facets[0].count).toBe(3);
  });

  it("search matches name, display name, description, owner, category, and tags", () => {
    const e = entry({ category: "Productivity", tags: ["Documents"] });
    const matches = (q: string) =>
      filterCommunityPlugins([e], {
        search: q,
        selectedTagKey: null,
        availability: "all",
      }).length === 1;
    expect(matches("PDF Tools")).toBe(true); // displayName
    expect(matches("pdf-tools")).toBe(true); // name
    expect(matches("process PDF")).toBe(true); // description
    expect(matches("aifetchly")).toBe(true); // owner
    expect(matches("productivity")).toBe(true); // category
    expect(matches("documents")).toBe(true); // tag
    expect(matches("nonexistent")).toBe(false);
  });

  it("search is case-insensitive and trims input", () => {
    const e = entry();
    expect(
      filterCommunityPlugins([e], {
        search: "   pDf ToOlS   ",
        selectedTagKey: null,
        availability: "all",
      })
    ).toHaveLength(1);
  });

  it("tag filtering uses exact normalized facet identity", () => {
    const entries: PluginCommunityEntry[] = [
      entry({ slug: "a", tags: ["SEO", "Marketing"] }),
      entry({ slug: "b", tags: ["PDF"] }),
    ];
    expect(
      filterCommunityPlugins(entries, {
        search: "",
        selectedTagKey: "seo",
        availability: "all",
      })
    ).toHaveLength(1);
    expect(
      filterCommunityPlugins(entries, {
        search: "",
        selectedTagKey: "marketing",
        availability: "all",
      })
    ).toHaveLength(1);
    expect(
      filterCommunityPlugins(entries, {
        search: "",
        selectedTagKey: "nonexistent",
        availability: "all",
      })
    ).toHaveLength(0);
  });

  it("Available uses ctaFor(entry) === 'install'", () => {
    const allowed = entry({ slug: "a" }); // allowed + direct + not installed → install
    const ticket = entry({
      slug: "b",
      access: { status: "allowed", installMode: "ticket" },
    }); // preview
    const sub = entry({
      slug: "c",
      access: { status: "subscription_required", installMode: "ticket" },
    }); // upgrade
    expect(matchesCommunityAvailability(allowed, "available")).toBe(true);
    expect(matchesCommunityAvailability(ticket, "available")).toBe(false);
    expect(matchesCommunityAvailability(sub, "available")).toBe(false);
  });

  it("Installed uses entry.installed", () => {
    const installed = entry({ slug: "a", installed: true });
    const notInstalled = entry({ slug: "b", installed: false });
    expect(matchesCommunityAvailability(installed, "installed")).toBe(true);
    expect(matchesCommunityAvailability(notInstalled, "installed")).toBe(false);
    // All matches everything.
    expect(matchesCommunityAvailability(installed, "all")).toBe(true);
    expect(matchesCommunityAvailability(notInstalled, "all")).toBe(true);
  });

  it("combines search, tag, and availability with logical AND", () => {
    const entries: PluginCommunityEntry[] = [
      entry({
        slug: "a",
        name: "seo-assistant",
        displayName: "SEO Assistant",
        description: "Generate and analyze SEO content for campaigns.",
        tags: ["SEO"],
      }),
      entry({
        slug: "b",
        name: "pdf-tools",
        displayName: "PDF Tools",
        description: "Extract, transform, and process PDF documents.",
        tags: ["PDF"],
      }),
    ];
    // "SEO" matches both the display name of A and the tag of A; B has no SEO.
    expect(
      filterCommunityPlugins(entries, {
        search: "seo",
        selectedTagKey: "seo",
        availability: "available",
      })
    ).toHaveLength(1);
    // tag SEO alone → 1
    expect(
      filterCommunityPlugins(entries, {
        search: "",
        selectedTagKey: "seo",
        availability: "all",
      })
    ).toHaveLength(1);
    // search "pdf" + tag "seo" → 0 (AND)
    expect(
      filterCommunityPlugins(entries, {
        search: "pdf",
        selectedTagKey: "seo",
        availability: "all",
      })
    ).toHaveLength(0);
  });

  it("preserves input order and does not mutate the input array", () => {
    const a = entry({ slug: "a" });
    const b = entry({ slug: "b" });
    const input = [a, b];
    const out = filterCommunityPlugins(input, {
      search: "",
      selectedTagKey: null,
      availability: "all",
    });
    expect(out).toEqual([a, b]);
    expect(input).toBe(input); // same reference returned shape, array identity intact
    expect(input).toEqual([a, b]); // untouched
  });

  it("keeps the selected overflow facet visible even when beyond the primary limit", () => {
    const facets = buildCommunityTagFacets(
      Array.from({ length: 15 }, (_, i) =>
        entry({ slug: `e${i}`, tags: [`Tag${i}`] })
      )
    );
    // default limit 10 — primary is the first 10 facets.
    const primary = visibleCommunityTagFacets(facets, null);
    expect(primary).toHaveLength(10);
    // Select a facet beyond the primary set (index 12). It must remain
    // visible: the helper swaps the last primary slot for the selected
    // facet so the row stays concise while the selection never disappears.
    const selectedKey = facets[12].key;
    expect(primary.some((f) => f.key === selectedKey)).toBe(false);
    const withSelected = visibleCommunityTagFacets(facets, selectedKey);
    expect(withSelected).toHaveLength(10);
    expect(withSelected.some((f) => f.key === selectedKey)).toBe(true);
    // selected facet is the last entry
    expect(withSelected[withSelected.length - 1].key).toBe(selectedKey);
  });
});
