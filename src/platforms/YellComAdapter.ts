import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { SearchResult } from '@/interfaces/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/interfaces/IDataExtractor';

/**
 * Yell.com Platform Adapter
 * 
 * Specialized adapter for scraping business data from Yell.com (UK)
 * Implements custom logic for handling Yell.com specific features
 */
export class YellComAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Custom search implementation for Yell.com
     */
    async searchBusinesses(keywords: string[], location: string): Promise<SearchResult[]> {
        const searchUrl = this.buildSearchUrl(keywords, location, 1);
        console.log(`Searching Yell.com: ${searchUrl}`);
        return [];
    }

    /**
     * Custom business data extraction for Yell.com
     */
    async extractBusinessData(page: Page): Promise<BusinessData> {
        console.log('Extracting business data from Yell.com');

        // Wait for results to load
        await page.waitForSelector('div.businessCapsule', { timeout: 10000 });

        // Extract all business listings
        const businesses = await page.evaluate(() => {
            const results: any[] = [];
            const businessElements = document.querySelectorAll('div.businessCapsule');

            businessElements.forEach((element) => {
                const business: any = {};

                // Extract business name
                const nameElement = element.querySelector('h2.businessCapsule--name');
                business.name = nameElement?.textContent?.trim() || null;
                business.url = nameElement?.closest('a')?.getAttribute('href') || null;

                // Extract phone number
                const phoneElement = element.querySelector('span.business--telephoneNumber');
                business.phone = phoneElement?.textContent?.trim() || null;

                // Extract address
                const addressElement = element.querySelector('span.business--address');
                if (addressElement) {
                    const addressText = addressElement.textContent?.trim() || '';
                    business.address = this.parseAddress(addressText);
                } else {
                    business.address = null;
                }

                // Extract categories
                const categoriesElement = element.querySelector('span.business--category');
                business.categories = categoriesElement?.textContent?.trim().split(',').map(cat => cat.trim()).filter(cat => cat) || [];

                // Extract rating
                const ratingElement = element.querySelector('div.business--rating');
                if (ratingElement) {
                    const ratingText = ratingElement.textContent?.trim() || '';
                    business.rating = this.parseRating(ratingText);
                } else {
                    business.rating = null;
                }

                // Extract review count
                const reviewElement = element.querySelector('span.business--reviewCount');
                business.reviewCount = reviewElement?.textContent?.trim().replace(/[()]/g, '') || null;

                // Extract website URL
                const websiteElement = element.querySelector('a.business--website');
                business.websiteUrl = websiteElement?.getAttribute('href') || null;

                // Extract email
                const emailElement = element.querySelector('a.business--email');
                business.email = emailElement?.getAttribute('href')?.replace('mailto:', '') || null;

                // Extract business hours
                const hoursElement = element.querySelector('div.business--hours');
                business.businessHours = hoursElement?.textContent?.trim() || null;

                // Extract description
                const descriptionElement = element.querySelector('div.business--description');
                business.description = descriptionElement?.textContent?.trim() || null;

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
                business_hours: firstBusiness.businessHours,
                description: firstBusiness.description,
                social_media: undefined
            };
        }

        // Return default structure if no businesses found
        return {
            business_name: '',
            email: undefined,
            phone: undefined,
            website: undefined,
            address: undefined,
            categories: [],
            rating: undefined,
            business_hours: undefined,
            description: undefined,
            social_media: undefined,
            year_established: undefined,
            raw_data: {}
        };
    }

    /**
     * Handle pagination for Yell.com
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        console.log('Handling pagination for Yell.com');

        const currentPage = await this.getCurrentPage(page);
        if (currentPage >= maxPages) {
            console.log(`Reached maximum page limit: ${maxPages}`);
            return;
        }

        const hasNext = await this.hasNextPage(page);
        if (hasNext) {
            const nextButton = await page.$('a.pagination--next');
            if (nextButton) {
                await nextButton.click();
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
                console.log(`Navigated to page ${currentPage + 1}`);
            }
        }
    }

    /**
     * Extract detailed business information from individual business page
     */
    async extractDetailedBusinessInfo(page: Page, businessUrl: string): Promise<any> {
        console.log(`Extracting detailed business info from: ${businessUrl}`);

        try {
            await page.goto(businessUrl, { waitUntil: 'networkidle2' });
            await page.waitForSelector('div.business-details', { timeout: 10000 });

            const detailedInfo = await page.evaluate(() => {
                const info: any = {};

                // Extract detailed business information
                const nameElement = document.querySelector('h1.business-title');
                info.name = nameElement?.textContent?.trim() || '';

                const phoneElement = document.querySelector('span.business-phone');
                info.phone = phoneElement?.textContent?.trim() || '';

                const emailElement = document.querySelector('a.business-email');
                info.email = emailElement?.getAttribute('href')?.replace('mailto:', '') || '';

                const websiteElement = document.querySelector('a.business-website');
                info.website = websiteElement?.getAttribute('href') || '';

                const addressElement = document.querySelector('div.business-address');
                info.address = addressElement?.textContent?.trim() || '';

                const descriptionElement = document.querySelector('div.business-description');
                info.description = descriptionElement?.textContent?.trim() || '';

                const hoursElement = document.querySelector('div.business-hours');
                info.businessHours = hoursElement?.textContent?.trim() || '';

                const ratingElement = document.querySelector('div.business-rating');
                info.rating = ratingElement?.textContent?.trim() || '';

                const reviewElement = document.querySelector('span.business-review-count');
                info.reviewCount = reviewElement?.textContent?.trim() || '';

                return info;
            });

            return detailedInfo;
        } catch (error) {
            console.error('Error extracting detailed business info:', error);
            return {};
        }
    }

    /**
     * Parse address text into structured format
     */
    private parseAddress(addressText: string): Address | null {
        if (!addressText) return null;

        // Simple address parsing for UK format
        const parts = addressText.split(',').map(part => part.trim());
        
        return {
            street: parts[0] || '',
            city: parts[1] || '',
            state: parts[2] || '',
            zip: parts[3] || '',
            country: 'UK',
            formatted: addressText
        };
    }

    /**
     * Parse rating from text
     */
    private parseRating(ratingText: string): Rating | null {
        if (!ratingText) return null;

        // Extract numeric rating from text like "4.5 stars" or "4.5/5"
        const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
        if (ratingMatch) {
            const score = parseFloat(ratingMatch[1]);
            return {
                score: score,
                max_score: 5,
                review_count: 0
            };
        }

        return null;
    }

    /**
     * Get current page number
     */
    private async getCurrentPage(page: Page): Promise<number> {
        try {
            const currentPageElement = await page.$('.pagination--current');
            if (currentPageElement) {
                const text = await page.evaluate(el => el.textContent, currentPageElement);
                return parseInt(text || '1', 10);
            }
        } catch (error) {
            console.error('Error getting current page:', error);
        }
        return 1;
    }

    /**
     * Check if there's a next page
     */
    private async hasNextPage(page: Page): Promise<boolean> {
        try {
            const nextButton = await page.$('a.pagination--next');
            return nextButton !== null;
        } catch (error) {
            console.error('Error checking for next page:', error);
            return false;
        }
    }

    /**
     * Apply cookies to the page
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        console.log('Applying cookies to Yell.com');
        
        if (cookies && Array.isArray(cookies)) {
            await page.setCookie(...cookies);
        }
    }

    /**
     * Handle site-specific features for Yell.com
     */
    async handleSiteSpecificFeatures(page: Page): Promise<void> {
        console.log('Handling Yell.com specific features');

        // Handle cookie consent if present
        try {
            const cookieButton = await page.$('button[data-testid="cookie-accept"]');
            if (cookieButton) {
                await cookieButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.log('No cookie consent dialog found or already handled');
        }

        // Handle location popup if present
        try {
            const locationButton = await page.$('button[data-testid="location-accept"]');
            if (locationButton) {
                await locationButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.log('No location popup found or already handled');
        }
    }
}
