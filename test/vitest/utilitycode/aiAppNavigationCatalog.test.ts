/**
 * Tests for AIAppNavigationCatalogService.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §8, §17.1
 */
import { describe, it, expect } from "vitest";
import { AIAppNavigationCatalogService } from "@/service/AIAppNavigationCatalogService";
import type { AiNavigationRouteManifestEntry } from "@/config/aiNavigationRouteManifest";
import { aiNavigationRouteManifest } from "@/config/aiNavigationRouteManifest";

describe("AIAppNavigationCatalogService", () => {
  const service = new AIAppNavigationCatalogService();

  const safeEntry: AiNavigationRouteManifestEntry = {
    routeName: "Email_Marketing_Service_LIST",
    path: "/emailmarketing/emailservice/list",
    titleKey: "route.email_service",
    visible: true,
    aiNavigable: true,
    aiAliases: ["email service", "email edit"],
    aiDescription: "Manage email sending service accounts",
  };

  describe("buildCatalog - inclusion", () => {
    it("includes a parameter-free safe route", () => {
      const catalog = service.buildCatalog([safeEntry]);
      expect(catalog).toHaveLength(1);
      const entry = catalog[0];
      expect(entry.routeName).toBe("Email_Marketing_Service_LIST");
      expect(entry.requiresParams).toBe(false);
      expect(entry.explicitlyIncluded).toBe(true);
      expect(entry.explicitlyExcluded).toBe(false);
      expect(entry.visible).toBe(true);
      expect(entry.source).toBe("router");
    });

    it("includes a default-safe route without explicit aiNavigable when param-free and visible", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "CampaignList",
        path: "/campaign/list",
        titleKey: "route.campaign_list",
        visible: true,
      };
      const catalog = service.buildCatalog([entry]);
      expect(catalog).toHaveLength(1);
      expect(catalog[0].explicitlyIncluded).toBe(false);
      expect(catalog[0].explicitlyExcluded).toBe(false);
    });
  });

  describe("buildCatalog - exclusion", () => {
    it("excludes a route with aiNavigable === false", () => {
      const entry: AiNavigationRouteManifestEntry = {
        ...safeEntry,
        routeName: "login",
        path: "/login",
        aiNavigable: false,
      };
      expect(service.buildCatalog([entry])).toHaveLength(0);
    });

    it("excludes a login route by name/path even without explicit flag", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "login",
        path: "/login",
        visible: true,
      };
      expect(service.buildCatalog([entry])).toHaveLength(0);
    });

    it("excludes an auth callback route", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "auth_callback",
        path: "/auth/callback",
        visible: false,
      };
      expect(service.buildCatalog([entry])).toHaveLength(0);
    });

    it("excludes a required-param route", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "EditCampaign",
        path: "/campaign/edit/:id(\\d+)",
        titleKey: "route.edit_campaign",
        visible: false,
        aiNavigable: true,
      };
      const catalog = service.buildCatalog([entry]);
      expect(catalog).toHaveLength(0);
    });

    it("excludes a route with no name", () => {
      const entry = {
        path: "/some/path",
        visible: true,
      } as unknown as AiNavigationRouteManifestEntry;
      expect(service.buildCatalog([entry])).toHaveLength(0);
    });
  });

  describe("buildCatalog - normalization", () => {
    it("normalizes a relative path to a full path with leading slash", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "FooList",
        path: "foo/list",
        visible: true,
      };
      const catalog = service.buildCatalog([entry]);
      expect(catalog[0].fullPath).toBe("/foo/list");
    });

    it("strips a trailing slash from the full path", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "BarList",
        path: "/bar/list/",
        visible: true,
      };
      const catalog = service.buildCatalog([entry]);
      expect(catalog[0].fullPath).toBe("/bar/list");
    });

    it("preserves the authored path field", () => {
      const catalog = service.buildCatalog([safeEntry]);
      expect(catalog[0].path).toBe("/emailmarketing/emailservice/list");
    });
  });

  describe("buildCatalog - label generation", () => {
    it("generates a readable label from the title key", () => {
      const catalog = service.buildCatalog([safeEntry]);
      expect(catalog[0].label).toBe("Email Service");
    });

    it("falls back to the route name when no title key is present", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "SocialAccount",
        path: "/socialaccount/list",
        visible: true,
      };
      const catalog = service.buildCatalog([entry]);
      expect(catalog[0].label).toBe("Social Account");
    });

    it("generates a multi-word label from a snake_case route name", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "Email_Marketing_Service_LIST",
        path: "/emailmarketing/emailservice/list",
        visible: true,
      };
      const catalog = service.buildCatalog([entry]);
      expect(catalog[0].label).toBe("Email Marketing Service List");
    });
  });

  describe("buildCatalog - aliases and description", () => {
    it("preserves aliases and description", () => {
      const catalog = service.buildCatalog([safeEntry]);
      expect(catalog[0].aliases).toEqual(["email service", "email edit"]);
      expect(catalog[0].description).toBe("Manage email sending service accounts");
    });

    it("defaults aliases to an empty array when absent", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "PlainList",
        path: "/plain/list",
        visible: true,
      };
      const catalog = service.buildCatalog([entry]);
      expect(catalog[0].aliases).toEqual([]);
    });
  });

  describe("isAiNavigableEntry", () => {
    it("returns true for a safe parameter-free route", () => {
      expect(service.isAiNavigableEntry(safeEntry)).toBe(true);
    });

    it("returns false for an explicitly excluded route", () => {
      expect(
        service.isAiNavigableEntry({ ...safeEntry, aiNavigable: false })
      ).toBe(false);
    });

    it("returns false for a required-param route", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "EditCampaign",
        path: "/campaign/edit/:id",
        aiNavigable: true,
      };
      expect(service.isAiNavigableEntry(entry)).toBe(false);
    });

    it("returns false for a login route", () => {
      const entry: AiNavigationRouteManifestEntry = {
        routeName: "login",
        path: "/login",
        aiNavigable: true,
      };
      expect(service.isAiNavigableEntry(entry)).toBe(false);
    });
  });

  describe("real manifest", () => {
    it("includes the email service route", () => {
      const catalog = service.buildCatalog(aiNavigationRouteManifest);
      const emailService = catalog.find(
        (e) => e.routeName === "Email_Marketing_Service_LIST"
      );
      expect(emailService).toBeDefined();
      expect(emailService?.label).toBe("Email Service");
    });

    it("includes the AI auto-reply audit route", () => {
      const catalog = service.buildCatalog(aiNavigationRouteManifest);
      const audit = catalog.find(
        (e) => e.routeName === "AI_Auto_Reply_Audit_List"
      );
      expect(audit).toBeDefined();
    });

    it("labels the account management route as tool accounts", () => {
      const catalog = service.buildCatalog(aiNavigationRouteManifest);
      const toolAccounts = catalog.find((e) => e.routeName === "SocialAccount");
      expect(toolAccounts).toBeDefined();
      expect(toolAccounts?.label).toBe("Tool Account List");
      expect(toolAccounts?.aliases).toContain("tool account");
      expect(toolAccounts?.description).toBe("Manage tool platform accounts");
    });

    it("excludes nothing unexpected from the curated manifest", () => {
      const catalog = service.buildCatalog(aiNavigationRouteManifest);
      // Every entry in the curated manifest is safe and param-free, so all
      // should survive the catalog filters.
      expect(catalog).toHaveLength(aiNavigationRouteManifest.length);
    });
  });
});
