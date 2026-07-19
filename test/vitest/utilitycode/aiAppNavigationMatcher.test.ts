/**
 * Tests for AIAppNavigationMatcher.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §9, §17.2
 */
import { describe, it, expect } from "vitest";
import { AIAppNavigationMatcher } from "@/service/AIAppNavigationMatcher";
import { AIAppNavigationCatalogService } from "@/service/AIAppNavigationCatalogService";
import { aiNavigationRouteManifest } from "@/config/aiNavigationRouteManifest";
import type { AiNavigationCatalogEntry } from "@/entityTypes/aiAppNavigationTypes";

const catalogService = new AIAppNavigationCatalogService();
const realCatalog = catalogService.buildCatalog(aiNavigationRouteManifest);

/** Build a minimal catalog entry for controlled matcher tests. */
function makeEntry(
  overrides: Partial<AiNavigationCatalogEntry> & { routeName: string }
): AiNavigationCatalogEntry {
  return {
    path: `/${overrides.routeName.toLowerCase()}`,
    fullPath: `/${overrides.routeName.toLowerCase()}`,
    label: overrides.routeName,
    aliases: [],
    visible: true,
    requiresParams: false,
    explicitlyIncluded: true,
    explicitlyExcluded: false,
    source: "router",
    ...overrides,
  };
}

describe("AIAppNavigationMatcher", () => {
  const matcher = new AIAppNavigationMatcher();

  describe("successful navigation", () => {
    it("resolves 'open email service' to Email_Marketing_Service_LIST", () => {
      const result = matcher.match("open email service", realCatalog);
      expect(result.success).toBe(true);
      expect(result).toMatchObject({
        success: true,
        action: "navigate",
        routeName: "Email_Marketing_Service_LIST",
      });
    });

    it("resolves 'open email edit page' to Email_Marketing_Service_LIST", () => {
      const result = matcher.match("open email edit page", realCatalog);
      expect(result.success).toBe(true);
      expect(result).toMatchObject({
        routeName: "Email_Marketing_Service_LIST",
      });
    });

    it("resolves 'check email reply log' to AI_Auto_Reply_Audit_List", () => {
      const result = matcher.match("check email reply log", realCatalog);
      expect(result.success).toBe(true);
      expect(result).toMatchObject({
        routeName: "AI_Auto_Reply_Audit_List",
      });
    });

    it("returns a confidence at or above the auto-navigate threshold", () => {
      const result = matcher.match("open email service", realCatalog);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });
  });

  describe("ambiguous match", () => {
    it("returns clarification candidates for 'open email page'", () => {
      const result = matcher.match("open email page", realCatalog);
      expect(result.success).toBe(false);
      expect(result).toMatchObject({ needsClarification: true });
      if (!result.success && "needsClarification" in result) {
        expect(result.candidates.length).toBeGreaterThan(1);
        const names = result.candidates.map((c) => c.routeName);
        expect(names).toContain("Email_Marketing_Service_LIST");
      }
    });

    it("returns clarification when two entries score equally", () => {
      const catalog = [
        makeEntry({
          routeName: "AlphaA",
          aliases: ["alpha beta"],
          label: "Alpha Beta",
        }),
        makeEntry({
          routeName: "AlphaB",
          aliases: ["alpha beta"],
          label: "Alpha Beta",
        }),
      ];
      const result = matcher.match("alpha beta", catalog);
      expect(result).toMatchObject({ needsClarification: true });
      if (!result.success && "needsClarification" in result) {
        expect(result.candidates).toHaveLength(2);
      }
    });

    it("limits candidates to maxCandidates", () => {
      const catalog = Array.from({ length: 8 }, (_, i) =>
        makeEntry({
          routeName: `EmailThing${i}`,
          aliases: ["email thing"],
          label: "Email Thing",
        })
      );
      const result = matcher.match("email thing", catalog);
      if (!result.success && "needsClarification" in result) {
        expect(result.candidates.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("not found", () => {
    it("returns notFound for a low-confidence unrelated query", () => {
      const result = matcher.match("xyzzy qwerty zzz", realCatalog);
      expect(result.success).toBe(false);
      expect(result).toMatchObject({ notFound: true });
    });
  });

  describe("scoring precedence", () => {
    it("an exact alias match beats a label-only match", () => {
      const withAlias = makeEntry({
        routeName: "WithAlias",
        aliases: ["email service"],
        label: "Email Service",
      });
      const labelOnly = makeEntry({
        routeName: "LabelOnly",
        aliases: [],
        label: "Email Service",
      });
      const result = matcher.match("email service", [
        withAlias,
        labelOnly,
      ]);
      expect(result).toMatchObject({ routeName: "WithAlias" });
    });
  });

  describe("custom thresholds", () => {
    it("respects a higher autoNavigateThreshold to force clarification", () => {
      // 'open email service' normally auto-navigates; raise the bar so it
      // cannot clear it and must clarify (or not-found) instead.
      const result = matcher.match("open email service", realCatalog, {
        autoNavigateThreshold: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });
});
