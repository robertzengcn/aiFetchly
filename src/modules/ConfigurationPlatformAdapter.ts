import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { SearchResult } from '@/modules/interface/IBasePlatformAdapter';
import { BusinessData } from '@/modules/interface/IDataExtractor';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';

/**
 * Configuration Platform Adapter
 * 
 * This adapter is used for configuration-only platforms that don't need custom logic.
 * It uses the default implementations from BasePlatformAdapter and relies entirely
 * on the platform configuration for selectors and behavior.
 */
export class ConfigurationPlatformAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Search for businesses using default implementation
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]> {
        console.log(`Searching ${this.platformName} with keywords: ${keywords.join(', ')} in ${location}`);
        
        // For configuration-only platforms, we return empty results
        // The actual search is handled by the scraping engine
        return [];
    }

    /**
     * Extract business data using configuration selectors
     */
    async extractBusinessData(page: Page): Promise<BusinessData> {
        console.log(`Extracting business data from ${this.platformName} using configuration selectors`);
        
        // Use the default implementation from BasePlatformAdapter
        return await this.defaultExtractBusinessData(page);
    }

    /**
     * Handle pagination using configuration selectors
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        console.log(`Handling pagination for ${this.platformName} (max pages: ${maxPages})`);
        
        // Use the default implementation from BasePlatformAdapter
        await this.defaultHandlePagination(page, maxPages);
    }

    /**
     * Apply cookies using default implementation
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        console.log(`Applying cookies for ${this.platformName}`);
        
        // Use the default implementation from BasePlatformAdapter
        await this.defaultApplyCookies(page, cookies);
    }

    /**
     * Navigate to search page
     */
    async navigateToSearch(page: Page, keywords: string[], location: string): Promise<void> {
        const searchUrl = this.buildSearchUrl(keywords, location);
        
        console.log(`Navigating to search page: ${searchUrl}`);
        
        await page.goto(searchUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Wait for search results to load
        const selectors = this.getSelectors();
        if (selectors.businessList) {
            await page.waitForSelector(selectors.businessList, { timeout: 10000 });
        }
    }

    /**
     * Get current page number from pagination
     */
    async getCurrentPage(page: Page): Promise<number> {
        const selectors = this.getSelectors();
        
        if (!selectors.pagination || typeof selectors.pagination !== 'object' || !('currentPage' in selectors.pagination)) {
            return 1;
        }

        try {
            return await page.evaluate((selector) => {
                const currentPageElement = document.querySelector(selector);
                return currentPageElement ? parseInt(currentPageElement.textContent || '1') : 1;
            }, selectors.pagination.currentPage!);
        } catch {
            return 1;
        }
    }

    /**
     * Check if there are more pages available
     */
    async hasNextPage(page: Page): Promise<boolean> {
        const selectors = this.getSelectors();
        
        if (!selectors.pagination || typeof selectors.pagination !== 'object' || !('nextButton' in selectors.pagination)) {
            return false;
        }

        try {
            return await page.evaluate((selector) => {
                const nextButton = document.querySelector(selector);
                return nextButton ? !nextButton.classList.contains('disabled') : false;
            }, selectors.pagination.nextButton!);
        } catch {
            return false;
        }
    }

    /**
     * Get total number of results (if available)
     */
    async getTotalResults(page: Page): Promise<number | null> {
        const selectors = this.getSelectors();
        
        // Look for total results selector in configuration
        if (!selectors.pagination || typeof selectors.pagination !== 'object' || !('maxPages' in selectors.pagination)) {
            return null;
        }

        try {
            return await page.evaluate((selector) => {
                const totalElement = document.querySelector(selector);
                if (!totalElement) return null;
                
                const text = totalElement.textContent || '';
                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1]) : null;
            }, selectors.pagination.maxPages!);
        } catch {
            return null;
        }
    }

    /**
     * Handle site-specific features (cookie banners, popups, etc.)
     */
    async handleSiteSpecificFeatures(page: Page): Promise<void> {
        try {
            // Wait for page to load
            await page.waitForSelector('body', { timeout: 10000 });

            // Handle common cookie consent patterns
            const cookieSelectors = [
                '.cookie-banner .accept',
                '.gdpr-banner .accept',
                '#cookieConsentBanner .accept',
                '[data-testid="cookie-accept"]',
                '.cookie-consent .accept'
            ];

            for (const selector of cookieSelectors) {
                try {
                    const button = await page.$(selector);
                    if (button) {
                        await button.click();
                        console.log(`Accepted cookies using selector: ${selector}`);
                        break;
                    }
                } catch {
                    // Continue to next selector
                }
            }

            // Handle common popup/modal patterns
            const popupSelectors = [
                '.modal .close',
                '.popup .close',
                '.overlay .close',
                '[data-testid="modal-close"]',
                '.dialog .close'
            ];

            for (const selector of popupSelectors) {
                try {
                    const button = await page.$(selector);
                    if (button) {
                        await button.click();
                        console.log(`Closed popup using selector: ${selector}`);
                        break;
                    }
                } catch {
                    // Continue to next selector
                }
            }

        } catch (error) {
            console.log(`No site-specific features to handle for ${this.platformName}`);
        }
    }

    /**
     * Wait for search results to load
     */
    async waitForResults(page: Page, timeout: number = 10000): Promise<void> {
        const selectors = this.getSelectors();
        
        if (selectors.businessList) {
            await page.waitForSelector(selectors.businessList, { timeout });
        }
    }

    /**
     * Scroll page to load lazy-loaded content
     */
    async scrollToLoadContent(page: Page): Promise<void> {
        try {
            await page.evaluate(() => {
                return new Promise<void>((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });
            
            console.log(`Scrolled page to load lazy content for ${this.platformName}`);
        } catch (error) {
            console.log(`No lazy content to load for ${this.platformName}`);
        }
    }
}