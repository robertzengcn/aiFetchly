import { describe, expect, test, vi } from "vitest";

import {
  HUB_MARKETPLACE_NAME,
  MARKETING_PLANS_URL,
  PLUGIN_HUB_CATALOG_PATH,
  PLUGIN_HUB_PROD_URL,
  assertFirstPartyHubUrl,
  normalizePluginHubUrlString,
  resolvePluginHubBase,
} from "@/config/pluginHubUrl";

describe("normalizePluginHubUrlString", () => {
  test("trims whitespace and strips BOM", () => {
    expect(normalizePluginHubUrlString("  https://hub.example.com  ")).toBe(
      "https://hub.example.com"
    );
    expect(normalizePluginHubUrlString("﻿https://hub.example.com")).toBe(
      "https://hub.example.com"
    );
  });

  test("strips a single pair of surrounding quotes", () => {
    expect(normalizePluginHubUrlString('"https://hub.example.com"')).toBe(
      "https://hub.example.com"
    );
    expect(normalizePluginHubUrlString("'https://hub.example.com'")).toBe(
      "https://hub.example.com"
    );
  });
});

describe("resolvePluginHubBase", () => {
  test("falls back to the production URL when env is unset", () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "");
    expect(resolvePluginHubBase().value).toBe(PLUGIN_HUB_PROD_URL);
    vi.unstubAllEnvs();
  });

  test("uses the env-configured URL for local dev against docker-compose", () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "http://localhost:8080");
    expect(resolvePluginHubBase().value).toBe("http://localhost:8080");
    vi.unstubAllEnvs();
  });

  test("normalizes quotes and whitespace from .env quirks", () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", ' "http://localhost:8080" ');
    expect(resolvePluginHubBase().value).toBe("http://localhost:8080");
    vi.unstubAllEnvs();
  });

  test("falls back to production URL when the value is not a valid URL", () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "not-a-url");
    expect(resolvePluginHubBase().value).toBe(PLUGIN_HUB_PROD_URL);
    vi.unstubAllEnvs();
  });
});

describe("assertFirstPartyHubUrl", () => {
  test("accepts a URL whose origin matches the configured hub base", () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "https://plugins.example.com");
    expect(() =>
      assertFirstPartyHubUrl(
        "https://plugins.example.com/api/v1/plugins/catalog"
      )
    ).not.toThrow();
    vi.unstubAllEnvs();
  });

  test("rejects a URL on a different origin (token-exfil guard)", () => {
    vi.stubEnv("VITE_PLUGIN_HUB_URL", "https://plugins.example.com");
    expect(() =>
      assertFirstPartyHubUrl("https://attacker.example.com/catalog")
    ).toThrow(/first-party/i);
    vi.unstubAllEnvs();
  });

  test("rejects an invalid URL", () => {
    expect(() => assertFirstPartyHubUrl("not-a-url")).toThrow();
  });
});

describe("constants", () => {
  test("hub marketplace name is slug-safe for the marketplaces table", () => {
    expect(HUB_MARKETPLACE_NAME).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });

  test("catalog path and plans URL are stable first-party constants", () => {
    expect(PLUGIN_HUB_CATALOG_PATH).toBe("/api/v1/plugins/catalog");
    expect(MARKETING_PLANS_URL).toMatch(/^https:\/\//);
  });
});
