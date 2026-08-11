/**
 * Test for YellowPages.com Platform Adapter
 * This test verifies that the YellowPagesComAdapter works correctly
 */

import { PlatformAdapterFactory } from "@/modules/PlatformAdapterFactory";
import { YellowPagesComAdapter } from "@/modules/platforms/YellowPagesComAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";
import {
  isSameRegistrableHost,
  ALLOWED_HOSTS,
} from "@/modules/lib/urlHostAllowlist";

export class YellowPagesAdapterTest {
  private factory: PlatformAdapterFactory;

  constructor() {
    this.factory = new PlatformAdapterFactory();
  }

  /**
   * Test platform configuration loading
   */
  async testPlatformConfiguration(): Promise<void> {
    console.log("🧪 Testing platform configuration loading...");

    try {
      const platformRegistry = this.factory.getPlatformRegistry();
      const config = platformRegistry.getPlatformConfig("yellowpages-com");

      if (!config) {
        throw new Error("YellowPages.com configuration not found");
      }

      console.log("✅ Platform configuration loaded:", {
        id: config.id,
        name: config.name,
        base_url: config.base_url,
        type: config.type,
        is_active: config.is_active,
      });

      // Validate configuration
      const validation = platformRegistry.validatePlatformConfig(config);
      if (!validation.isValid) {
        throw new Error(
          `Configuration validation failed: ${validation.errors.join(", ")}`
        );
      }

      console.log(
        "✅ Platform configuration is valid (score: " + validation.score + ")"
      );
    } catch (error) {
      console.error("❌ Platform configuration test failed:", error);
      throw error;
    }
  }

  /**
   * Test adapter factory creation
   */
  async testAdapterFactory(): Promise<void> {
    console.log("🧪 Testing adapter factory creation...");

    try {
      const adapter = await this.factory.createAdapterById("yellowpages-com");

      if (!(adapter instanceof YellowPagesComAdapter)) {
        throw new Error(
          "Created adapter is not an instance of YellowPagesComAdapter"
        );
      }

      console.log("✅ Adapter created successfully:", {
        platformName: adapter.platformName,
        baseUrl: adapter.baseUrl,
        version: adapter.version,
      });

      // Test adapter methods exist
      const requiredMethods = [
        "searchBusinesses",
        "extractBusinessData",
        "handlePagination",
        "applyCookies",
      ];
      for (const method of requiredMethods) {
        if (typeof adapter[method] !== "function") {
          throw new Error(`Required method missing: ${method}`);
        }
      }

      console.log("✅ All required methods are present");

      // Test configuration validation
      const validation = adapter.validateConfig();
      if (!validation.isValid) {
        throw new Error(
          `Adapter configuration invalid: ${validation.errors.join(", ")}`
        );
      }

      console.log("✅ Adapter configuration is valid");
    } catch (error) {
      console.error("❌ Adapter factory test failed:", error);
      throw error;
    }
  }

  /**
   * Test adapter configuration methods
   */
  async testAdapterConfiguration(): Promise<void> {
    console.log("🧪 Testing adapter configuration methods...");

    try {
      const adapter = await this.factory.createAdapterById("yellowpages-com");

      // Test selectors
      const selectors = adapter.getSelectors();
      console.log("✅ Selectors retrieved:", {
        businessList: selectors.businessList,
        businessName: selectors.businessName,
        phone: selectors.phone,
      });

      // Test rate limiting config
      const rateLimiting = adapter.getRateLimitingConfig();
      console.log("✅ Rate limiting config:", {
        requestsPerHour: rateLimiting.requestsPerHour,
        delayBetweenRequests: rateLimiting.delayBetweenRequests,
      });

      // Test authentication config
      const authConfig = adapter.getAuthenticationConfig();
      console.log("✅ Authentication config:", {
        requiresAuthentication: authConfig.requiresAuthentication,
        supportsCookies: authConfig.supportsCookies,
        supportsProxy: authConfig.supportsProxy,
      });

      // Test supported features
      const features = adapter.getSupportedFeatures();
      console.log("✅ Supported features:", features);
    } catch (error) {
      console.error("❌ Adapter configuration test failed:", error);
      throw error;
    }
  }

  /**
   * Test URL building
   */
  async testUrlBuilding(): Promise<void> {
    console.log("🧪 Testing URL building...");

    try {
      const adapter = await this.factory.createAdapterById("yellowpages-com");

      const searchUrl = adapter.buildSearchUrl(
        ["restaurant", "pizza"],
        "New York, NY",
        1
      );
      console.log("✅ Search URL built:", searchUrl);

      const parsedUrl = new URL(searchUrl);
      if (
        !isSameRegistrableHost(parsedUrl.hostname, ALLOWED_HOSTS.yellowpages)
      ) {
        throw new Error(
          "Search URL is not on the yellowpages.com registrable domain"
        );
      }

      if (!searchUrl.includes("restaurant") || !searchUrl.includes("pizza")) {
        throw new Error("Search URL does not contain keywords");
      }

      if (!searchUrl.includes("New York")) {
        throw new Error("Search URL does not contain location");
      }
    } catch (error) {
      console.error("❌ URL building test failed:", error);
      throw error;
    }
  }

  /**
   * Test platform statistics
   */
  async testPlatformStatistics(): Promise<void> {
    console.log("🧪 Testing platform statistics...");

    try {
      const platformRegistry = this.factory.getPlatformRegistry();
      const stats = platformRegistry.getPlatformStatistics();

      console.log("✅ Platform statistics:", {
        total: stats.total,
        active: stats.active,
        byType: stats.byType,
        byCountry: stats.byCountry,
      });

      const factoryStats = this.factory.getFactoryStatistics();
      console.log("✅ Factory statistics:", {
        availablePlatforms: factoryStats.availablePlatforms,
        cachedAdapters: factoryStats.cachedAdapters,
        platformsByType: factoryStats.platformsByType,
      });
    } catch (error) {
      console.error("❌ Platform statistics test failed:", error);
      throw error;
    }
  }

  /**
   * Run all adapter tests
   */
  async runAllTests(): Promise<void> {
    console.log("🚀 Starting YellowPages Adapter Tests...\n");

    try {
      // Test 1: Platform Configuration
      await this.testPlatformConfiguration();
      console.log("");

      // Test 2: Adapter Factory
      await this.testAdapterFactory();
      console.log("");

      // Test 3: Adapter Configuration
      await this.testAdapterConfiguration();
      console.log("");

      // Test 4: URL Building
      await this.testUrlBuilding();
      console.log("");

      // Test 5: Platform Statistics
      await this.testPlatformStatistics();
      console.log("");

      console.log("🎉 All YellowPages adapter tests completed successfully!");
    } catch (error) {
      console.error("💥 YellowPages adapter tests failed:", error);
      throw error;
    }
  }
}

// Export for use in other test files
export default YellowPagesAdapterTest;
