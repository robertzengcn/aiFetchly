import { describe, it, expect } from "vitest";
import { validateMarketplaceManifest } from "@/service/pluginMarketplaces/pluginMarketplaceValidation";

const VALID = {
  name: "team-tools",
  owner: { name: "Team" },
  plugins: [
    {
      name: "lead-research",
      version: "1.0.0",
      source: "./plugins/lead-research",
    },
  ],
};

describe("validateMarketplaceManifest", () => {
  it("accepts a valid manifest and preserves unknown fields", () => {
    const r = validateMarketplaceManifest(JSON.stringify({ ...VALID, extra: 1 }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.manifest.plugins[0].name).toBe("lead-research");
      expect((r.manifest as { extra?: number }).extra).toBe(1);
    }
  });

  it("rejects invalid JSON", () => {
    const r = validateMarketplaceManifest("{not json");
    expect(r.success).toBe(false);
  });

  it("rejects bad marketplace name", () => {
    const r = validateMarketplaceManifest(JSON.stringify({ ...VALID, name: "Bad Name" }));
    expect(r.success).toBe(false);
  });

  it("rejects duplicate plugin entry names", () => {
    const dup = {
      ...VALID,
      plugins: [
        { name: "dup", source: "./a" },
        { name: "dup", source: "./b" },
      ],
    };
    const r = validateMarketplaceManifest(JSON.stringify(dup));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === "marketplace-plugin-entry-invalid")).toBe(true);
  });

  it("rejects relative source not starting with ./", () => {
    const bad = { ...VALID, plugins: [{ name: "p", source: "plugins/x" }] };
    const r = validateMarketplaceManifest(JSON.stringify(bad));
    expect(r.success).toBe(false);
  });

  it("accepts github entry source with sha", () => {
    const m = {
      ...VALID,
      plugins: [
        { name: "p", source: { source: "github", repo: "o/r", sha: "a".repeat(40) } },
      ],
    };
    const r = validateMarketplaceManifest(JSON.stringify(m));
    expect(r.success).toBe(true);
  });
});
