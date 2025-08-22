import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { SearchResult } from '@/interfaces/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/interfaces/IDataExtractor';

/**
 * YellowPages.com Platform Adapter
 * 
 * Specialized adapter for scraping business data from YellowPages.com
 * Implements custom logic for handling YellowPages.com specific features
 */
export class YellowPagesComAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Custom search implementation for YellowPages.com
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]> {
        const searchUrl = this.buildSearchUrl(keywords, location, 1);
        console.log(`Searching YellowPages.com: ${searchUrl}`);
        return [];
    }

    /**
     * Custom business data extraction for YellowPages.com
     */
    async extractBusinessData(page: Page): Promise<BusinessData> {
        console.log('Extracting business data from YellowPages.com');

        // Wait for results to load
        await page.waitForSelector('div#main-content div.search-results.organic div.result', { timeout: 10000 });

        // Extract all business listings
        const businesses = await page.evaluate(() => {
            const results: any[] = [];
            const businessElements = document.querySelectorAll('div#main-content div.search-results.organic div.result');

            businessElements.forEach((element) => {
                const business: any = {};

                // Extract business name
                const nameElement = element.querySelector('a.business-name');
                business.name = nameElement?.textContent?.trim() || null;
                business.url = nameElement?.getAttribute('href') || null;

                // Extract phone number
                const phoneElement = element.querySelector('div.phones');
                business.phone = phoneElement?.textContent?.trim() || null;

                // Extract address
                const addressElement = element.querySelector('div.adr');
                if (addressElement) {
                    const addressText = addressElement.textContent?.trim() || '';
                    business.address = this.parseAddress(addressText);
                } else {
                    business.address = null;
                }

                // Extract categories
                const categoriesElement = element.querySelector('div.categories');
                business.categories = categoriesElement?.textContent?.trim().split('\n').map(cat => cat.trim()).filter(cat => cat) || [];

                // Extract rating
                const ratingElement = element.querySelector('div.result-rating');
                if (ratingElement) {
                    const ratingClasses = Array.from(ratingElement.classList);
                    business.rating = this.parseRating(ratingClasses);
                } else {
                    business.rating = null;
                }

                // Extract review count
                const reviewElement = element.querySelector('span.count');
                business.reviewCount = reviewElement?.textContent?.trim().replace(/[()]/g, '') || null;

                // Extract years in business
                const yearsElement = element.querySelector('div.badges div.years-with-yp > div.count strong');
                business.yearsInBusiness = yearsElement?.textContent?.trim() || null;

                // Extract website URL (requires visiting business page)
                business.websiteUrl = null;
                business.email = null;

                results.push(business);
            });

            return results;
        });

        // Return the first business data (or create a default structure)
        if (businesses.length > 0) {
            const firstBusiness = businesses[0];
            return {
                business_name: firstBusiness.name || '',
                email: firstBusiness.email,
                phone: firstBusiness.phone,
                website: firstBusiness.websiteUrl,
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
     * Custom pagination handling for YellowPages.com
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        const currentPage = await this.getCurrentPage(page);
        
        if (currentPage >= maxPages) {
            console.log(`Reached maximum pages (${maxPages})`);
            return;
        }

        // Check if next page button exists and is clickable
        const nextButton = await page.$('a.next');
        if (!nextButton) {
            console.log('No next page button found');
            return;
        }

        // Click next page button
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            nextButton.click()
        ]);

        // Wait for new results to load
        await page.waitForSelector('div.result', { timeout: 10000 });
        
        console.log(`Navigated to page ${currentPage + 1}`);
    }

    /**
     * Extract detailed business information from individual business page
     */
    async extractDetailedBusinessInfo(page: Page, businessUrl: string): Promise<any> {
        if (!businessUrl) return {};

        try {
            // Navigate to business detail page
            await page.goto(`https://www.yellowpages.com${businessUrl}`, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });

            // Extract additional details
            const details = await page.evaluate(() => {
                const result: any = {};

                // Extract website
                const websiteElement = document.querySelector('p.website a');
                result.websiteUrl = websiteElement?.getAttribute('href') || null;

                // Extract email
                const emailElement = document.querySelector('a.email-business');
                result.email = emailElement?.getAttribute('href')?.replace('mailto:', '') || null;

                // Extract business hours
                const hoursElements = document.querySelectorAll('table.hours-table tr');
                const businessHours: any = {};
                hoursElements.forEach(row => {
                    const dayElement = row.querySelector('td.day');
                    const timeElement = row.querySelector('td.time');
                    if (dayElement && timeElement) {
                        businessHours[dayElement.textContent?.trim() || ''] = timeElement.textContent?.trim() || '';
                    }
                });
                result.businessHours = Object.keys(businessHours).length > 0 ? businessHours : null;

                // Extract description
                const descElement = document.querySelector('div.business-description');
                result.description = descElement?.textContent?.trim() || null;

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

        // YellowPages.com typically formats addresses as:
        // "123 Main St, City, ST 12345"
        const parts = addressText.split(',').map(part => part.trim());
        
        if (parts.length < 2) return null;

        const street = parts[0];
        const cityStateParts = parts[parts.length - 1].split(' ');
        const zip = cityStateParts.pop() || '';
        const state = cityStateParts.pop() || '';
        const city = parts.slice(1, -1).join(', ').trim() || cityStateParts.join(' ');

        return {
            street,
            city,
            state,
            zip,
            country: 'USA'
        };
    }

    /**
     * Parse rating from CSS classes
     */
    private parseRating(ratingClasses: string[]): Rating | null {
        const ratingMap: { [key: string]: number } = {
            'one': 1,
            'one-half': 1.5,
            'two': 2,
            'two-half': 2.5,
            'three': 3,
            'three-half': 3.5,
            'four': 4,
            'four-half': 4.5,
            'five': 5
        };

        for (const className of ratingClasses) {
            if (ratingMap[className]) {
                return {
                    score: ratingMap[className],
                    max_score: 5,
                    review_count: 0,
                    rating_text: 'YellowPages.com'
                };
            }
        }

        return null;
    }

    /**
     * Get current page number
     */
    private async getCurrentPage(page: Page): Promise<number> {
        try {
            return await page.evaluate(() => {
                const currentPageElement = document.querySelector('.pagination .current');
                return currentPageElement ? parseInt(currentPageElement.textContent || '1') : 1;
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
                const nextButton = document.querySelector('a.next');
                return nextButton ? !nextButton.classList.contains('disabled') : false;
            });
        } catch {
            return false;
        }
    }

    /**
     * Apply cookies for YellowPages.com
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        if (!cookies || !Array.isArray(cookies)) {
            console.log('No cookies to apply for YellowPages.com');
            return;
        }

        try {
            // Set cookies for yellowpages.com domain
            const yellowPagesCookies = cookies.filter(cookie => 
                cookie.domain && cookie.domain.includes('yellowpages.com')
            );

            if (yellowPagesCookies.length > 0) {
                await page.setCookie(...yellowPagesCookies);
                console.log(`Applied ${yellowPagesCookies.length} cookies for YellowPages.com`);
            }
        } catch (error) {
            console.error('Error applying cookies for YellowPages.com:', error);
        }
    }

    /**
     * Handle YellowPages.com specific features like cookie banners
     */
    async handleSiteSpecificFeatures(page: Page): Promise<void> {
        try {
            // Wait for page to load
            await page.waitForSelector('body', { timeout: 10000 });

            // Handle cookie consent banner if present
            const cookieBanner = await page.$('.cookie-banner, .gdpr-banner, #cookieConsentBanner');
            if (cookieBanner) {
                const acceptButton = await page.$('.cookie-banner .accept, .gdpr-banner .accept, #cookieConsentBanner .accept');
                if (acceptButton) {
                    await acceptButton.click();
                    console.log('Accepted cookie banner on YellowPages.com');
                }
            }

            // Handle any popup modals
            const popup = await page.$('.modal, .popup, .overlay');
            if (popup) {
                const closeButton = await page.$('.modal .close, .popup .close, .overlay .close');
                if (closeButton) {
                    await closeButton.click();
                    console.log('Closed popup on YellowPages.com');
                }
            }

        } catch (error) {
            console.log('No site-specific features to handle on YellowPages.com');
        }
    }
}