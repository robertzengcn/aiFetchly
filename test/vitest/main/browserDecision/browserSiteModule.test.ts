import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * PRD §6.9 / S-FR-01..06: site registry seeding, match-by-URL, guardrailed
 * upsert, and ID ranges (S-AC-01).
 */

const tmpDir = path.join(
  os.tmpdir(),
  `browser-site-test-${process.pid}-${Date.now()}`
);

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
    setValue(): void {}
  },
}));

import { SqliteDb } from "@/config/SqliteDb";
import { BrowserSiteModule } from "@/modules/BrowserSiteModule";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

beforeAll(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
});

beforeEach(() => {
  resetDbSingleton();
});

describe("BrowserSiteModule (S-FR-01..06)", () => {
  it("seeds builtin sites with the existing platform IDs", async () => {
    const module = new BrowserSiteModule();
    const inserted = await module.seedFromPlatformLists();
    expect(inserted).toBeGreaterThan(0);
    const sites = await module.listSites();
    const youtube = sites.find((site) => site.siteId === 2);
    expect(youtube?.registrableDomain).toBe("youtube.com");
    expect(youtube?.allowedDomainSuffixes).toContain("google.com");
    // Seeded sites are verified builtin rows.
    expect(youtube?.source).toBe("builtin");
    expect(youtube?.status).toBe("verified");
  });

  it("seeding is idempotent", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    const second = await module.seedFromPlatformLists();
    expect(second).toBe(0);
  });

  it("matches a live URL by registrable domain and hostname suffix", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    const match = await module.matchByUrl("https://www.youtube.com/watch?v=x");
    expect(match?.siteId).toBe(2);
    // A lookalike host under an allowed suffix matches; a foreign one does not.
    const foreign = await module.matchByUrl("https://not-youtube.com/");
    expect(foreign).toBeNull();
  });

  it("upsert creates a new site from the 100000 ID range with its own domain only", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    const result = await module.upsertSite({
      name: "Example Market",
      url: "https://www.example-market.test/",
      source: "ai",
    });
    expect(result.created).toBe(true);
    expect(result.siteId).toBeGreaterThanOrEqual(100000);
    expect(result.registrableDomain).toBe("example-market.test");
    const match = await module.matchByUrl("https://login.example-market.test/auth");
    expect(match?.siteId).toBe(result.siteId);
    // Seeded IDs are untouched (S-AC-01).
    expect(await module.getSite(2)).not.toBeNull();
  });

  it("upsert dedupes by registrable domain", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    const first = await module.upsertSite({
      name: "Example",
      url: "https://example.test/",
    });
    const second = await module.upsertSite({
      name: "Example (again)",
      url: "https://www.example.test/shop",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.siteId).toBe(first.siteId);
  });

  it("rejects non-HTTPS URLs and invalid URLs", async () => {
    const module = new BrowserSiteModule();
    await expect(
      module.upsertSite({ name: "Insecure", url: "http://example.test/" })
    ).rejects.toThrow("https_required");
    await expect(
      module.upsertSite({ name: "Bad", url: "not a url" })
    ).rejects.toThrow();
  });

  it("S-FR-03: distinct rejection reasons for IP literals and public suffixes", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    // An address literal is never a registrable domain.
    await expect(
      module.upsertSite({ name: "IP", url: "https://93.184.216.34/" })
    ).rejects.toThrow("ip_address_not_allowed");
    // A bare public suffix / single label cannot anchor a site.
    await expect(
      module.upsertSite({ name: "PS", url: "https://localhost/" })
    ).rejects.toThrow("public_suffix_not_allowed");
  });

  it("proposes additional domains only from visited list, applies on confirmation", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    const site = await module.upsertSite({
      name: "SSO Site",
      url: "https://sso-site.test/",
    });
    // accounts.google.com resolves to the SEEDED google site (registrable
    // domain identity), so use a genuinely separate SSO domain here.
    const proposal = await module.proposeAdditionalDomains({
      siteId: site.siteId,
      visitedDomains: ["auth.partner-sso.test", "sso-site.test"],
    });
    expect(proposal?.proposedDomains).toEqual(["auth.partner-sso.test"]);
    expect(proposal?.token).toMatch(/^dom_/);
    // B03: the apply is token-gated.
    await module.applyAdditionalDomains({
      siteId: site.siteId,
      domains: proposal?.proposedDomains ?? [],
      token: proposal?.token ?? "",
    });
    const match = await module.matchByUrl("https://auth.partner-sso.test/oauth");
    expect(match?.siteId).toBe(site.siteId);
  });

  it("B03: rejects an apply without, with a foreign, or with an over-broad token", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    const site = await module.upsertSite({
      name: "SSO Gated",
      url: "https://sso-gated.test/",
    });
    const proposal = await module.proposeAdditionalDomains({
      siteId: site.siteId,
      visitedDomains: ["auth.gated-sso.test"],
    });
    expect(proposal).not.toBeNull();
    // No token at all → rejected.
    expect(
      await module.applyAdditionalDomains({
        siteId: site.siteId,
        domains: proposal!.proposedDomains,
        token: "",
      })
    ).toBe(false);
    // A token minted for ANOTHER site → rejected.
    const otherSite = await module.upsertSite({
      name: "Other Site",
      url: "https://other-gated.test/",
    });
    expect(
      await module.applyAdditionalDomains({
        siteId: otherSite.siteId,
        domains: proposal!.proposedDomains,
        token: proposal!.token,
      })
    ).toBe(false);
    // A domain the proposal did not include → rejected (subset rule).
    expect(
      await module.applyAdditionalDomains({
        siteId: site.siteId,
        domains: ["auth.gated-sso.test", "evil.gated-sso.test"],
        token: proposal!.token,
      })
    ).toBe(false);
    // The token is still unconsumed after the failures; the legitimate
    // apply succeeds and the token is single-use afterwards.
    expect(
      await module.applyAdditionalDomains({
        siteId: site.siteId,
        domains: proposal!.proposedDomains,
        token: proposal!.token,
      })
    ).toBe(true);
    expect(
      await module.applyAdditionalDomains({
        siteId: site.siteId,
        domains: proposal!.proposedDomains,
        token: proposal!.token,
      })
    ).toBe(false);
  });

  it("saves and returns the learned login recipe", async () => {
    const module = new BrowserSiteModule();
    await module.seedFromPlatformLists();
    const site = await module.upsertSite({
      name: "Recipe Site",
      url: "https://recipe.test/",
    });
    await module.saveLoginRecipe(site.siteId, {
      steps: [{ usernameField: "email", passwordField: "pass", submitVia: "form" }],
      formAction: "/login",
      version: 1,
    });
    const match = await module.getSite(site.siteId);
    expect(match?.loginRecipe).toContain("email");
    await module.markVerified(site.siteId);
    expect((await module.getSite(site.siteId))?.status).toBe("verified");
  });
});
