import { describe, test, expect } from "vitest";
import { Platform_itownpage_jp } from "@/config/platforms/itownpage-jp";
import { Platform_usonar_yellowpage_jp } from "@/config/platforms/usonar-yellowpage-jp";

/**
 * URL validation tests for Japanese yellow pages platform configurations.
 * Ensures that platform URLs are properly formatted and consistent.
 */
describe("Japanese Platform URL Validation", () => {
  describe("URL Format", () => {
    test("iTownPage base URL should be valid", () => {
      const url = new URL(Platform_itownpage_jp.base_url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("itp.ne.jp");
    });

    test("uSonar Yellow Page base URL should be valid", () => {
      const url = new URL(Platform_usonar_yellowpage_jp.base_url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("yellowpage.usonar.co.jp");
    });
  });

  describe("URL Consistency", () => {
    test("search URL pattern should match base URL domain", () => {
      const itownpageBaseUrl = new URL(Platform_itownpage_jp.base_url);
      const itownpageSearchUrl = new URL(
        Platform_itownpage_jp.settings!.searchUrlPattern.replace(
          /\{.*?\}/g,
          "test"
        )
      );
      expect(itownpageSearchUrl.hostname).toBe(itownpageBaseUrl.hostname);

      const usonarBaseUrl = new URL(Platform_usonar_yellowpage_jp.base_url);
      const usonarSearchUrl = new URL(
        Platform_usonar_yellowpage_jp.settings!.searchUrlPattern.replace(
          /\{.*?\}/g,
          "test"
        )
      );
      expect(usonarSearchUrl.hostname).toBe(usonarBaseUrl.hostname);
    });

    test("result URL pattern should match base URL domain", () => {
      const itownpageBaseUrl = new URL(Platform_itownpage_jp.base_url);
      const itownpageResultUrl = new URL(
        Platform_itownpage_jp.settings!.resultUrlPattern.replace(
          "{path}",
          "/test"
        )
      );
      expect(itownpageResultUrl.hostname).toBe(itownpageBaseUrl.hostname);

      const usonarBaseUrl = new URL(Platform_usonar_yellowpage_jp.base_url);
      const usonarResultUrl = new URL(
        Platform_usonar_yellowpage_jp.settings!.resultUrlPattern.replace(
          "{path}",
          "/test"
        )
      );
      expect(usonarResultUrl.hostname).toBe(usonarBaseUrl.hostname);
    });
  });

  describe("URL Pattern Placeholders", () => {
    test("search URL patterns should contain required placeholders", () => {
      expect(Platform_itownpage_jp.settings!.searchUrlPattern).toContain(
        "{keywords}"
      );
      expect(Platform_itownpage_jp.settings!.searchUrlPattern).toContain(
        "{location}"
      );
      expect(Platform_itownpage_jp.settings!.searchUrlPattern).toContain(
        "{page}"
      );

      expect(
        Platform_usonar_yellowpage_jp.settings!.searchUrlPattern
      ).toContain("{keywords}");
      expect(
        Platform_usonar_yellowpage_jp.settings!.searchUrlPattern
      ).toContain("{location}");
      expect(
        Platform_usonar_yellowpage_jp.settings!.searchUrlPattern
      ).toContain("{page}");
    });

    test("result URL patterns should contain path placeholder", () => {
      expect(Platform_itownpage_jp.settings!.resultUrlPattern).toContain(
        "{path}"
      );
      expect(
        Platform_usonar_yellowpage_jp.settings!.resultUrlPattern
      ).toContain("{path}");
    });
  });

  describe("Security - HTTPS Only", () => {
    test("all platform URLs should use HTTPS", () => {
      const platforms = [Platform_itownpage_jp, Platform_usonar_yellowpage_jp];

      platforms.forEach((platform) => {
        expect(platform.base_url).toMatch(/^https:\/\//);
        expect(platform.settings!.searchUrlPattern).toMatch(/^https:\/\//);
        expect(platform.settings!.resultUrlPattern).toMatch(/^https:\/\//);
      });
    });
  });

  describe("Japanese Domain Validation", () => {
    test("platforms should use Japanese country code TLD or .jp domains", () => {
      // iTownPage uses .ne.jp (Japanese network domain)
      expect(Platform_itownpage_jp.base_url).toContain(".jp");

      // uSonar uses .co.jp (Japanese company domain)
      expect(Platform_usonar_yellowpage_jp.base_url).toContain(".jp");
    });
  });

  describe("Documentation URLs", () => {
    test("documentation URLs should be valid", () => {
      expect(() => new URL(Platform_itownpage_jp.documentation!)).not.toThrow();
      expect(
        () => new URL(Platform_usonar_yellowpage_jp.documentation!)
      ).not.toThrow();
    });
  });
});
