/**
 * Tests for findPlatformByReference — tolerant Yellow Pages platform lookup.
 *
 * The AI chat tool `search_yellow_pages` receives free-form platform strings
 * from the model. These tests pin the normalization guarantees that keep a
 * URL-ish or differently-cased reference (e.g. "yellowpages.com") from
 * failing with "Platform ... not found": case-insensitivity and
 * dash/dot/whitespace/underscore equivalence.
 */
import { describe, it, expect } from "vitest";
import { findPlatformByReference } from "@/modules/platforms/platformMatcher";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";
import { platforms } from "@/config/platforms";

/** Minimal configs exercising the id/name/display_name matching surfaces. */
const fixtures: PlatformConfig[] = [
  {
    id: "yellowpages-com",
    name: "YellowPages.com",
    display_name: "YellowPages.com",
    base_url: "https://www.yellowpages.com",
    country: "USA",
    language: "en",
    is_active: true,
    version: "1.0.0",
    rate_limit: 100,
    delay_between_requests: 2000,
    max_concurrent_requests: 1,
    type: "configuration",
  },
  {
    id: "yellowpages-com-sg",
    name: "YellowPages.com.sg",
    display_name: "Yellow Pages Singapore",
    base_url: "https://www.yellowpages.com.sg",
    country: "Singapore",
    language: "en",
    is_active: true,
    version: "1.0.0",
    rate_limit: 100,
    delay_between_requests: 2000,
    max_concurrent_requests: 1,
    type: "configuration",
  },
  {
    id: "gelbeseiten-de",
    name: "GelbeSeiten.de",
    display_name: "GelbeSeiten.de",
    base_url: "https://www.gelbeseiten.de",
    country: "Germany",
    language: "de",
    is_active: true,
    version: "1.0.0",
    rate_limit: 100,
    delay_between_requests: 2000,
    max_concurrent_requests: 1,
    type: "configuration",
  },
];

describe("findPlatformByReference", () => {
  describe("exact matches", () => {
    it("matches by id", () => {
      expect(findPlatformByReference(fixtures, "yellowpages-com")?.id).toBe(
        "yellowpages-com"
      );
    });

    it("matches by name", () => {
      expect(findPlatformByReference(fixtures, "YellowPages.com")?.id).toBe(
        "yellowpages-com"
      );
    });

    it("matches by display_name", () => {
      expect(
        findPlatformByReference(fixtures, "Yellow Pages Singapore")?.id
      ).toBe("yellowpages-com-sg");
    });
  });

  describe("case-insensitivity", () => {
    it.each([
      "yellowpages.com",
      "YELLOWPAGES.COM",
      "YellowPages.com",
      "Yellowpages.Com",
    ])("resolves %s to yellowpages-com", (ref) => {
      expect(findPlatformByReference(fixtures, ref)?.id).toBe(
        "yellowpages-com"
      );
    });
  });

  describe("separator normalization (- . _ whitespace)", () => {
    it.each([
      "yellowpages-com",
      "yellowpages.com",
      "yellowpages com",
      "yellowpages_com",
      " yellowpages.com ",
    ])("resolves %s to yellowpages-com", (ref) => {
      expect(findPlatformByReference(fixtures, ref)?.id).toBe(
        "yellowpages-com"
      );
    });

    it("normalizes the multi-segment Singapore id", () => {
      expect(findPlatformByReference(fixtures, "yellowpages.com.sg")?.id).toBe(
        "yellowpages-com-sg"
      );
    });

    it("normalizes display names with spaces", () => {
      expect(
        findPlatformByReference(fixtures, "yellow pages singapore")?.id
      ).toBe("yellowpages-com-sg");
    });
  });

  describe("no cross-matches between similar platforms", () => {
    it("does not match the SG platform when the US id is supplied", () => {
      expect(findPlatformByReference(fixtures, "yellowpages-com")?.id).toBe(
        "yellowpages-com"
      );
    });

    it("does not match the US platform when the SG id is supplied", () => {
      expect(findPlatformByReference(fixtures, "yellowpages-com-sg")?.id).toBe(
        "yellowpages-com-sg"
      );
    });
  });

  describe("unknown or empty references", () => {
    it("returns undefined for an unknown platform", () => {
      expect(
        findPlatformByReference(fixtures, "notaplatform.com")
      ).toBeUndefined();
    });

    it("returns undefined for an empty string", () => {
      expect(findPlatformByReference(fixtures, "")).toBeUndefined();
    });

    it("returns undefined for a whitespace-only string", () => {
      expect(findPlatformByReference(fixtures, "   ")).toBeUndefined();
    });
  });

  describe("against the real platform registry", () => {
    it("resolves every real platform by id, name and display_name", () => {
      for (const p of platforms) {
        expect(findPlatformByReference(platforms, p.id)?.id).toBe(p.id);
        expect(findPlatformByReference(platforms, p.name)?.id).toBe(p.id);
        expect(findPlatformByReference(platforms, p.display_name)?.id).toBe(
          p.id
        );
      }
    });

    it("resolves the URL form of every real platform name", () => {
      // e.g. name "GelbeSeiten.de" lowercased, or id with dots — every
      // platform must tolerate the URL-ish variant the model tends to send.
      for (const p of platforms) {
        const urlForm = p.id.replace(/-/g, ".");
        expect(findPlatformByReference(platforms, urlForm)?.id).toBe(p.id);
      }
    });

    it("resolves each real platform uniquely (normalized keys never cross platforms)", () => {
      // Within one platform, id/name/display_name often normalize to the same
      // key (e.g. "YellowPages.com" ≡ "yellowpages-com") — that's fine. What
      // must never happen is one platform's field normalizing to another
      // platform's key, which would make lookup ambiguous.
      const owner = new Map<string, string>();
      for (const p of platforms) {
        for (const field of [p.id, p.name, p.display_name]) {
          const key = field
            .trim()
            .toLowerCase()
            .replace(/[-.\s_]+/g, "-");
          const existing = owner.get(key);
          if (existing === undefined) {
            owner.set(key, p.id);
          } else {
            expect(existing).toBe(p.id);
          }
        }
      }
    });
  });
});
