/**
 * Test for Yelp.com Platform Adapter
 * This test verifies that the YelpComAdapter works correctly
 */

import { PlatformAdapterFactory } from "@/modules/PlatformAdapterFactory";
// import { YelpComAdapter } from '@/modules/platforms/YelpComAdapter';
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";

export class YelpAdapterTest {
  private factory: PlatformAdapterFactory;

  constructor() {
    this.factory = new PlatformAdapterFactory();
  }

  /**
   * Test platform configuration loading
   */
  async testPlatformConfiguration(): Promise<void> {
    console.log("🧪 Testing Yelp platform configuration loading...");

    try {
      const platformRegistry = this.factory.getPlatformRegistry();
      const config = platformRegistry.getPlatformConfig("yelp-com");

      if (!config) {
        throw new Error("Yelp.com configuration not found");
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
    console.log("🧪 Testing Yelp adapter factory creation...");

    try {
      const adapter = await this.factory.createAdapterById("yelp-com");

      // if (!(adapter instanceof YelpComAdapter)) {
      //     throw new Error('Created adapter is not an instance of YelpComAdapter');
      // }

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
        if (
          typeof (adapter as unknown as Record<string, unknown>)[method] !== "function"
        ) {
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
    console.log("🧪 Testing Yelp adapter configuration methods...");

    try {
      const adapter = await this.factory.createAdapterById("yelp-com");

      // Test selectors
      const selectors = adapter.getSelectors();
      console.log("✅ Selectors retrieved:", {
        businessList: selectors.businessList,
        businessName: selectors.businessName,
        phone: selectors.phone,
        rating: selectors.rating,
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
    console.log("🧪 Testing Yelp URL building...");

    try {
      const adapter = await this.factory.createAdapterById("yelp-com");

      const searchUrl = adapter.buildSearchUrl(
        ["restaurant", "pizza"],
        "New York, NY",
        1
      );
      console.log("✅ Search URL built:", searchUrl);

      if (!searchUrl.includes("yelp.com")) {
        throw new Error("Search URL does not contain yelp.com domain");
      }

      if (!searchUrl.includes("restaurant")) {
        throw new Error("Search URL does not contain keywords");
      }

      if (!searchUrl.includes("New York")) {
        throw new Error("Search URL does not contain location");
      }

      // Test pagination URL
      const page2Url = adapter.buildSearchUrl(
        ["restaurant"],
        "Los Angeles, CA",
        2
      );
      console.log("✅ Page 2 URL built:", page2Url);

      if (!page2Url.includes("start=10")) {
        throw new Error("Page 2 URL does not contain correct offset");
      }
    } catch (error) {
      console.error("❌ URL building test failed:", error);
      throw error;
    }
  }

  /**
   * Test Yelp-specific features
   */
  async testYelpSpecificFeatures(): Promise<void> {
    console.log("🧪 Testing Yelp-specific features...");

    try {
      const adapter = await this.factory.createAdapterById("yelp-com");

      // Test search URL pattern
      const config = (adapter as any).config;
      const expectedPattern =
        "https://www.yelp.com/search?find_desc={keywords}&find_loc={location}&start={offset}";

      if (config.settings?.searchUrlPattern !== expectedPattern) {
        console.warn("⚠️ Search URL pattern may have changed");
      } else {
        console.log("✅ Search URL pattern is correct");
      }

      // Test pagination settings
      const paginationOffset = config.settings?.paginationOffset;
      if (paginationOffset !== 10) {
        console.warn("⚠️ Pagination offset may be incorrect");
      } else {
        console.log("✅ Pagination offset is correct (10 results per page)");
      }

      // Test selectors for Yelp-specific elements
      const selectors = adapter.getSelectors();
      const requiredSelectors = [
        "businessList",
        "businessName",
        "rating",
        "reviewCount",
        "categories",
        "priceRange",
      ];

      for (const selector of requiredSelectors) {
        if (!selectors[selector]) {
          throw new Error(`Missing required selector: ${selector}`);
        }
      }

      console.log("✅ All Yelp-specific selectors are present");
    } catch (error) {
      console.error("❌ Yelp-specific features test failed:", error);
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

      // Verify Yelp is included in statistics
      const yelpIncluded =
        stats.byCountry["USA"] > 0 &&
        factoryStats.availablePlatforms.includes("yelp-com");

      if (!yelpIncluded) {
        throw new Error("Yelp.com not properly included in statistics");
      }

      console.log("✅ Yelp.com is properly included in platform statistics");
    } catch (error) {
      console.error("❌ Platform statistics test failed:", error);
      throw error;
    }
  }

  /**
   * Run all Yelp adapter tests
   */
  async runAllTests(): Promise<void> {
    console.log("🚀 Starting Yelp Adapter Tests...\n");

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

      // Test 5: Yelp-specific Features
      await this.testYelpSpecificFeatures();
      console.log("");

      // Test 6: Platform Statistics
      await this.testPlatformStatistics();
      console.log("");

      console.log("🎉 All Yelp adapter tests completed successfully!");
    } catch (error) {
      console.error("💥 Yelp adapter tests failed:", error);
      throw error;
    }
  }
}

// Export for use in other test files
export default YelpAdapterTest;
