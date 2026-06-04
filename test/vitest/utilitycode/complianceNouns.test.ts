import { describe, expect, test } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

interface ComplianceMessages {
  route: Record<string, string>;
  mapScraper: Record<string, string>;
}

const locales: Record<string, ComplianceMessages> = { en, zh, es, fr, de, ja };

describe("compliance-facing product nouns", () => {
  test("uses PRD module names for primary navigation in every locale", () => {
    const expectedRouteValues: Record<string, string> = {
      search_scraper: "Market Insight Explorer",
      email_extraction: "Contact Profile Insights",
      email_extraction_form: "Contact Profile Insights",
      yellow_pages: "Directory Assistant",
      google_maps_scraper: "Local Business Finder",
      yandex_maps_scraper: "Local Business Finder",
      map_scraper: "Local Business Finder",
      email_marketing: "Outreach Campaign",
    };

    for (const messages of Object.values(locales)) {
      for (const [key, value] of Object.entries(expectedRouteValues)) {
        expect(messages.route[key]).toBe(value);
      }
    }
  });

  test("uses neutral local business channel and export wording", () => {
    for (const messages of Object.values(locales)) {
      expect(messages.mapScraper.title).toBe("Local Business Finder");
      expect(messages.mapScraper.provider_google).toBe("Channel Alpha (Global)");
      expect(messages.mapScraper.provider_yandex).toBe("Channel Beta (CIS Region)");
      expect(messages.mapScraper.export_csv).toBe("Export To Routing Sheet");
    }
  });
});
