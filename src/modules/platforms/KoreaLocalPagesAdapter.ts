import { Page } from "puppeteer";
import { BasePlatformAdapter } from "@/modules/BasePlatformAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";
import { BusinessData } from "@/modules/interface/IDataExtractor";

/**
 * KoreaLocalPages Platform Adapter
 *
 * Platform: https://korealocalpages.com
 *
 * Specialized adapter for scraping business data from KoreaLocalPages.com
 * Extends BasePlatformAdapter with platform-specific functionality
 */
export class KoreaLocalPagesAdapter extends BasePlatformAdapter {
  constructor(config: PlatformConfig) {
    super(config);
  }

  /**
   * Custom business data extraction for KoreaLocalPages
   * Extracts business listings from div.results-content > div.summary-list
   */
  async extractBusinessData(page: Page): Promise<BusinessData> {
    const selectors = this.getSelectors();

    // Wait for results to load
    await page.waitForSelector(selectors.businessList, { timeout: 10000 });

    // Extract all business listings
    const businesses = await page.evaluate((sels) => {
      const results: any[] = [];

      // Get business list container
      const businessListContainer = document.querySelector(sels.businessList);
      if (!businessListContainer) {
        return results;
      }

      // Get all business items
      const businessItem = sels.businessItem || "div.summary-list";
      const businessElements =
        businessListContainer.querySelectorAll(businessItem);

      businessElements.forEach((element) => {
        const business: any = {};

        // Extract business name
        const nameElement = element.querySelector(sels.businessName);
        business.name = nameElement?.textContent?.trim() || null;

        // Extract detail page link
        const detailPageLink = sels.detailPageLink || "a[href^='/']";
        const linkElement = element.querySelector(detailPageLink);
        business.url = linkElement?.getAttribute("href") || null;

        // Extract phone number
        const phone = sels.phone || ".phone";
        const phoneElement = element.querySelector(phone);
        business.phone = phoneElement?.textContent?.trim() || null;

        // Extract website URL
        const website = sels.website || "a[href^='http']";
        const websiteElement = element.querySelector(website);
        business.websiteUrl =
          websiteElement?.getAttribute("href") ||
          websiteElement?.textContent?.trim() ||
          null;

        // Extract address
        const address = sels.address || ".address";
        const addressElement = element.querySelector(address);
        business.address = addressElement?.textContent?.trim() || null;

        // Extract categories
        const categories = sels.categories || ".category";
        const categoriesElement = element.querySelector(categories);
        if (categoriesElement) {
          const categoriesText = categoriesElement.textContent?.trim() || "";
          business.categories = categoriesText
            .split(",")
            .map((cat) => cat.trim())
            .filter((cat) => cat);
        } else {
          business.categories = [];
        }

        results.push(business);
      });

      return results;
    }, selectors);

    // Return the first business data (or create a default structure)
    if (businesses.length > 0) {
      const firstBusiness = businesses[0];
      return {
        business_name: firstBusiness.name || "",
        email: firstBusiness.email,
        phone: firstBusiness.phone,
        website: firstBusiness.websiteUrl,
        address: firstBusiness.address,
        categories: firstBusiness.categories,
        rating: firstBusiness.rating,
        raw_data: { businesses, totalCount: businesses.length },
      };
    } else {
      return {
        business_name: "",
        raw_data: { businesses: [], totalCount: 0 },
      };
    }
  }

  /**
   * Handle pagination for KoreaLocalPages
   */
  async handlePagination(page: Page, maxPages: number): Promise<void> {
    const selectors = this.getSelectors();

    // Check if pagination is configured and is an object with nextButton property
    if (!selectors.pagination || typeof selectors.pagination !== "object") {
      console.log("No pagination selector configured for KoreaLocalPages");
      return;
    }

    // Type guard to check if pagination has nextButton property
    const pagination = selectors.pagination;
    if (!("nextButton" in pagination) || !pagination.nextButton) {
      console.log("No nextButton selector configured for KoreaLocalPages");
      return;
    }

    const nextButton = await page.$(pagination.nextButton);
    if (!nextButton) {
      console.log("No next page button found on KoreaLocalPages");
      return;
    }

    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
        nextButton.click(),
      ]);

      // Wait for new results to load
      await page.waitForSelector(selectors.businessList, { timeout: 10000 });
      console.log("Navigated to next page on KoreaLocalPages");
    } catch (error) {
      console.error("Error handling pagination on KoreaLocalPages:", error);
    }
  }

  /**
   * Extract detailed business information from individual business page
   */
  async extractDetailedBusinessInfo(
    page: Page,
    businessUrl: string
  ): Promise<any> {
    if (!businessUrl) return {};

    try {
      // Navigate to business detail page
      await page.goto(
        businessUrl.startsWith("http")
          ? businessUrl
          : `${this.baseUrl}${businessUrl}`,
        {
          waitUntil: "networkidle2",
          timeout: 30000,
        }
      );

      // Extract additional details
      const details = await page.evaluate(() => {
        const result: any = {};

        // Extract email
        const emailElement = document.querySelector('a[href^="mailto:"]');
        result.email =
          emailElement?.getAttribute("href")?.replace("mailto:", "") || null;

        // Extract description
        const descElement = document.querySelector(
          '.description, .business-description, [class*="description"]'
        );
        result.description = descElement?.textContent?.trim() || null;

        // Extract business hours if available
        const hoursElements = document.querySelectorAll(
          '.hours, .business-hours, [class*="hours"]'
        );
        if (hoursElements.length > 0) {
          result.businessHours = Array.from(hoursElements)
            .map((el) => el.textContent?.trim())
            .filter(Boolean);
        }

        return result;
      });

      return details;
    } catch (error) {
      console.error(
        `Error extracting detailed info from ${businessUrl}:`,
        error
      );
      return {};
    }
  }

  /**
   * Handle KoreaLocalPages specific features like cookie banners
   */
  async handleSiteSpecificFeatures(page: Page): Promise<void> {
    try {
      // Wait for page to load
      await page.waitForSelector("body", { timeout: 10000 });

      // Handle cookie consent banner if present
      const cookieBannerSelectors = [
        ".cookie-banner",
        ".gdpr-banner",
        "#cookieConsentBanner",
        ".consent-banner",
      ];
      for (const selector of cookieBannerSelectors) {
        const cookieBanner = await page.$(selector);
        if (cookieBanner) {
          const acceptButton = await page.$(
            `${selector} .accept, ${selector} button[type="submit"], ${selector} .agree`
          );
          if (acceptButton) {
            await acceptButton.click();
            console.log("Accepted cookie banner on KoreaLocalPages");
            break;
          }
        }
      }

      // Handle any popup modals
      const popupSelectors = [
        ".modal",
        ".popup",
        ".overlay",
        '[role="dialog"]',
      ];
      for (const selector of popupSelectors) {
        const popup = await page.$(selector);
        if (popup) {
          const closeButton = await page.$(
            `${selector} .close, ${selector} .close-btn, ${selector} button[aria-label="close"]`
          );
          if (closeButton) {
            await closeButton.click();
            console.log("Closed popup on KoreaLocalPages");
            break;
          }
        }
      }
    } catch (error) {
      console.log("No site-specific features to handle on KoreaLocalPages");
    }
  }
}
