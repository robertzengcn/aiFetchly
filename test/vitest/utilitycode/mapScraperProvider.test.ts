import { describe, expect, test } from "vitest";
import {
  getMapScraperProviderMeta,
  normalizeMapScraperProvider,
} from "@/views/pages/map-scraper/mapScraperProvider";

describe("map scraper provider helpers", () => {
  test("normalizes supported route provider values", () => {
    expect(normalizeMapScraperProvider("google")).toBe("google");
    expect(normalizeMapScraperProvider("yandex")).toBe("yandex");
  });

  test("defaults unsupported provider values to google", () => {
    expect(normalizeMapScraperProvider(undefined)).toBe("google");
    expect(normalizeMapScraperProvider("bing")).toBe("google");
  });

  test("returns stable display metadata for each provider", () => {
    expect(getMapScraperProviderMeta("google").label).toBe("Channel Alpha (Global)");
    expect(getMapScraperProviderMeta("yandex").label).toBe("Channel Beta (CIS Region)");
    expect(getMapScraperProviderMeta("google").accountWhere).toBe("Google");
    expect(getMapScraperProviderMeta("yandex").accountWhere).toBe("Yandex");
  });
});
