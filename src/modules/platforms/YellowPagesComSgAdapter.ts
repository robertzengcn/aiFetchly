import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { SearchResult } from '@/modules/interface/IBasePlatformAdapter';
import { BusinessData, Address, Rating } from '@/modules/interface/IDataExtractor';

/**
 * YellowPages.com.sg Platform Adapter
 *
 * Specialized adapter for scraping business data from YellowPages.com.sg
 * Handles WordPress-based dynamic content loading and custom selectors
 */
export class YellowPagesComSgAdapter extends BasePlatformAdapter {

  constructor(config: PlatformConfig) {
    super(config);
  }

  /**
   * Custom search implementation for YellowPages.com.sg
   */
  async searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]> {
    const searchUrl = this.buildSearchUrl(keywords, location, 1);
    console.log(`Searching YellowPages.com.sg: ${searchUrl}`);
    return [];
  }

  /**
   * Custom business data extraction for YellowPages.com.sg
   */
  async extractBusinessData(page: Page): Promise<BusinessData> {
    console.log('Extracting business data from YellowPages.com.sg');

    // Wait for dynamic content to load
    await this.waitForContent(page);

    // Extract all business listings using comma-separated selectors
    const selectors = this.config.selectors;

    // Get business list elements
    const businessListSelectors = (selectors.businessList as string).split(',').map(s => s.trim());
    let businessElements: any[] = [];

    for (const selector of businessListSelectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          businessElements = elements;
          console.log(`Found ${elements.length} business items using selector: ${selector}`);
          break;
        }
      } catch (error) {
        // Selector didn't match, try next one
        continue;
      }
    }

    if (businessElements.length === 0) {
      console.log('No business listings found');
      return {
        business_name: '',
        raw_data: { businesses: [], totalCount: 0 }
      };
    }

    // Extract data from each business element
    const businesses = await this.extractFromElements(page, businessElements, selectors);

    // Return the first business data
    if (businesses.length > 0) {
      const firstBusiness = businesses[0];
      return {
        business_name: firstBusiness.name || '',
        email: firstBusiness.email,
        phone: firstBusiness.phone,
        website: firstBusiness.website,
        address: firstBusiness.address,
        categories: firstBusiness.categories,
        rating: firstBusiness.rating,
        raw_data: { businesses, totalCount: businesses.length }
      };
    } else {
      return {
        business_name: '',
        raw_data: { businesses: [], totalCount: 0 }
      };
    }
  }

  /**
   * Wait for dynamic content to load on YellowPages.com.sg
   */
  private async waitForContent(page: Page): Promise<void> {
    try {
      // Wait for any of the possible business list selectors
      const businessListSelectors = (this.config.selectors.businessList as string).split(',').map(s => s.trim());

      await Promise.race([
        ...businessListSelectors.map(selector =>
          page.waitForSelector(selector, { timeout: 10000 })
        ),
        // Fallback: wait for a reasonable time for dynamic content
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);

      console.log('Content loaded or timeout reached');
    } catch (error) {
      console.log('Waiting for content timed out, proceeding with extraction');
    }
  }

  /**
   * Extract business data from DOM elements
   */
  private async extractFromElements(
    page: Page,
    elements: any[],
    selectors: any
  ): Promise<any[]> {
    const results: any[] = [];

    for (const element of elements) {
      try {
        const business = await element.evaluate((el: Element, sel: any) => {
          const getText = (selectorList: string): string | null => {
            const selectors = selectorList.split(',').map(s => s.trim());
            for (const selector of selectors) {
              const elem = el.querySelector(selector);
              if (elem && elem.textContent) {
                return elem.textContent.trim();
              }
            }
            return null;
          };

          const getHref = (selectorList: string): string | null => {
            const selectors = selectorList.split(',').map(s => s.trim());
            for (const selector of selectors) {
              const elem = el.querySelector(selector) as HTMLAnchorElement;
              if (elem && elem.href) {
                return elem.href;
              }
            }
            return null;
          };

          return {
            name: getText(sel.businessName),
            phone: getText(sel.phone),
            email: getText(sel.email),
            website: getHref(sel.website),
            address: getText(sel.address),
            categories: getText(sel.categories)?.split(',').map(c => c.trim()) || [],
          };
        }, selectors);

        if (business.name) {
          // Parse address if present
          business.address = business.address ? this.parseAddress(business.address) : null;
          results.push(business);
        }
      } catch (error) {
        console.error('Error extracting business data:', error);
      }
    }

    return results;
  }

  /**
   * Custom pagination handling for YellowPages.com.sg
   */
  async handlePagination(page: Page, maxPages: number): Promise<void> {
    const currentPage = await this.getCurrentPage(page);

    if (currentPage >= maxPages) {
      console.log(`Reached maximum pages (${maxPages})`);
      return;
    }

    // Try different next button selectors
    const nextButtonSelectors = [
      '.pagination .next',
      '.next-page',
      'a.next',
      '.pagination-next'
    ];

    for (const selector of nextButtonSelectors) {
      try {
        const nextButton = await page.$(selector);
        if (nextButton) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            nextButton.click()
          ]);

          // Wait for new results to load
          await this.waitForContent(page);

          console.log(`Navigated to page ${currentPage + 1}`);
          return;
        }
      } catch (error) {
        // Try next selector
        continue;
      }
    }

    console.log('No next page button found');
  }

  /**
   * Extract detailed business information from individual business page
   */
  async extractDetailedBusinessInfo(page: Page, businessUrl: string): Promise<any> {
    if (!businessUrl) return {};

    try {
      await page.goto(businessUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      const details = await page.evaluate(() => {
        const result: any = {};

        // Extract website
        const websiteSelectors = ['.website a', '.business-website a', 'a.website-link'];
        for (const selector of websiteSelectors) {
          const elem = document.querySelector(selector) as HTMLAnchorElement;
          if (elem && elem.href) {
            result.websiteUrl = elem.href;
            break;
          }
        }

        // Extract email
        const emailSelectors = ['.email', '.business-email', 'a.email-address'];
        for (const selector of emailSelectors) {
          const elem = document.querySelector(selector);
          if (elem && elem.textContent) {
            result.email = elem.textContent.replace('mailto:', '').trim();
            break;
          }
        }

        // Extract business hours
        const hoursElements = document.querySelectorAll('.business-hours, .opening-hours li, .hours li');
        const businessHours: any = {};
        hoursElements.forEach(row => {
          const text = row.textContent?.trim() || '';
          // Parse typical format: "Monday: 9:00 AM - 5:00 PM"
          const match = text.match(/^([^:]+):\s*(.+)$/);
          if (match) {
            businessHours[match[1].trim()] = match[2].trim();
          }
        });
        result.businessHours = Object.keys(businessHours).length > 0 ? businessHours : null;

        // Extract description
        const descSelectors = ['.business-description', '.description', '.company-description'];
        for (const selector of descSelectors) {
          const elem = document.querySelector(selector);
          if (elem && elem.textContent) {
            result.description = elem.textContent.trim();
            break;
          }
        }

        return result;
      });

      return details;
    } catch (error) {
      console.error(`Error extracting detailed info from ${businessUrl}:`, error);
      return {};
    }
  }

  /**
   * Parse address string into structured format
   */
  private parseAddress(addressText: string): Address | null {
    if (!addressText) return null;

    // Singapore addresses typically use postal codes like "123456"
    const postalCodeMatch = addressText.match(/\b(\d{6})\b/);
    const postalCode = postalCodeMatch ? postalCodeMatch[1] : '';

    // Remove postal code from address for cleaner display
    const addressWithoutPostal = postalCode
      ? addressText.replace(postalCode, '').trim().replace(/\s*,\s*$/, '')
      : addressText;

    // Split by comma for different parts
    const parts = addressWithoutPostal.split(',').map(part => part.trim());

    return {
      street: parts[0] || '',
      city: parts[1] || 'Singapore',
      state: '', // Singapore doesn't use states
      zip: postalCode,
      country: 'Singapore'
    };
  }

  /**
   * Get current page number
   */
  private async getCurrentPage(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        const selectors = ['.pagination .current', '.page-item.active', '.current-page'];
        for (const selector of selectors) {
          const elem = document.querySelector(selector);
          if (elem && elem.textContent) {
            return parseInt(elem.textContent) || 1;
          }
        }
        return 1;
      });
    } catch {
      return 1;
    }
  }

  /**
   * Check if there's a next page
   */
  private async hasNextPage(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const selectors = ['.pagination .next', '.next-page', 'a.next'];
        for (const selector of selectors) {
          const elem = document.querySelector(selector) as HTMLAnchorElement;
          if (elem && !elem.classList.contains('disabled')) {
            return true;
          }
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Apply cookies for YellowPages.com.sg
   */
  async applyCookies(page: Page, cookies: any): Promise<void> {
    if (!cookies || !Array.isArray(cookies)) {
      console.log('No cookies to apply for YellowPages.com.sg');
      return;
    }

    try {
      const yellowPagesCookies = cookies.filter(cookie =>
        cookie.domain && cookie.domain.includes('yellowpages.com.sg')
      );

      if (yellowPagesCookies.length > 0) {
        await page.setCookie(...yellowPagesCookies);
        console.log(`Applied ${yellowPagesCookies.length} cookies for YellowPages.com.sg`);
      }
    } catch (error) {
      console.error('Error applying cookies for YellowPages.com.sg:', error);
    }
  }

  /**
   * Handle YellowPages.com.sg specific features like cookie banners
   */
  async handleSiteSpecificFeatures(page: Page): Promise<void> {
    try {
      await page.waitForSelector('body', { timeout: 10000 });

      // Handle cookie consent banner
      const cookieBannerSelectors = [
        '.cookie-banner',
        '.gdpr-banner',
        '#cookieConsentBanner',
        '.cookie-notice',
        '.consent-banner'
      ];

      for (const selector of cookieBannerSelectors) {
        const banner = await page.$(selector);
        if (banner) {
          const acceptButtonSelectors = [
            '.accept',
            '.accept-cookies',
            '.agree',
            '.consent-accept',
            'button[aria-label="Accept"]'
          ];

          for (const btnSelector of acceptButtonSelectors) {
            const button = await banner.$(btnSelector);
            if (button) {
              await button.click();
              console.log(`Accepted cookie banner using selector: ${btnSelector}`);
              return;
            }
          }
        }
      }

      // Handle popups/modals
      const popupSelectors = ['.modal', '.popup', '.overlay', '.dialog'];
      for (const selector of popupSelectors) {
        const popup = await page.$(selector);
        if (popup) {
          const closeButtonSelectors = [
            '.close',
            '.close-button',
            'button[aria-label="Close"]',
            '.modal-close'
          ];

          for (const btnSelector of closeButtonSelectors) {
            const button = await popup.$(btnSelector);
            if (button) {
              await button.click();
              console.log(`Closed popup using selector: ${btnSelector}`);
              return;
            }
          }
        }
      }

    } catch (error) {
      console.log('No site-specific features to handle on YellowPages.com.sg');
    }
  }
}
