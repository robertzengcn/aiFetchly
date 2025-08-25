import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { SearchResult } from '@/interfaces/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/interfaces/IDataExtractor';

/**
 * 11880.com Platform Adapter
 * 
 * Specialized adapter for scraping business data from 11880.com
 * Implements custom logic for handling 11880.com specific features
 */
export class Adapter11880 extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Handle page load events and initial setup for 11880.com
     */
    async onPageLoad(page: Page): Promise<void> {
        console.log('Handling page load for 11880.com');
        
        // Handle cookie consent if present
        try {
            const cookieButton = await page.$('#cmpwelcomebtnyes > a');
            if (cookieButton) {
                console.log('Found cookie button on 11880.com');
                await cookieButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('Accepted cookies on 11880.com');
            }
        } catch (error) {
            console.log('No cookie consent dialog found or already handled');
        }

        // Handle location popup if present
        // try {
        //     const locationButton = await page.$('button[data-testid="location-accept"], .location-accept, #location-accept');
        //     if (locationButton) {
        //         await locationButton.click();
        //         await new Promise(resolve => setTimeout(resolve, 1000));
        //         console.log('Accepted location on 11880.com');
        //     }
        // } catch (error) {
        //     console.log('No location popup found or already handled');
        // }

        // Wait for page to fully load
        await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
            console.log('Page load timeout reached, continuing...');
        });
    }

    /**
     * Custom business data extraction for 11880.com
     */
    // async extractBusinessData(page: Page): Promise<BusinessData> {
    //     console.log('Extracting business data from 11880.com');

    //     // Wait for results to load
    //     await page.waitForSelector('div.business-result, .business-listing, .search-result', { timeout: 10000 });

    //     // Extract all business listings
    //     const businesses = await page.evaluate(() => {
    //         const results: any[] = [];
    //         const businessElements = document.querySelectorAll('div.business-result, .business-listing, .search-result');

    //         businessElements.forEach((element) => {
    //             const business: any = {};

    //             // Extract business name
    //             const nameElement = element.querySelector('h3.business-name, .business-title, .company-name');
    //             business.name = nameElement?.textContent?.trim() || null;
    //             business.url = nameElement?.closest('a')?.getAttribute('href') || null;

    //             // Extract phone number
    //             const phoneElement = element.querySelector('span.business-phone, .phone, .telephone');
    //             business.phone = phoneElement?.textContent?.trim() || null;

    //             // Extract address
    //             const addressElement = element.querySelector('span.business-address, .address, .location');
    //             if (addressElement) {
    //                 const addressText = addressElement.textContent?.trim() || '';
    //                 business.address = addressText;
    //             } else {
    //                 business.address = null;
    //             }

    //             // Extract categories
    //             const categoriesElement = element.querySelector('span.business-category, .category, .business-type');
    //             business.categories = categoriesElement?.textContent?.trim().split(',').map(cat => cat.trim()).filter(cat => cat) || [];

    //             // Extract rating
    //             const ratingElement = element.querySelector('div.business-rating, .rating, .stars');
    //             if (ratingElement) {
    //                 const ratingText = ratingElement.textContent?.trim() || '';
    //                 business.rating = ratingText;
    //             } else {
    //                 business.rating = null;
    //             }

    //             // Extract review count
    //             const reviewElement = element.querySelector('span.business-review-count, .review-count, .reviews');
    //             business.reviewCount = reviewElement?.textContent?.trim().replace(/[()]/g, '') || null;

    //             // Extract website URL
    //             const websiteElement = element.querySelector('a.business-website, .website, .web');
    //             business.websiteUrl = websiteElement?.getAttribute('href') || null;

    //             // Extract email
    //             const emailElement = element.querySelector('a.business-email, .email, .mail');
    //             business.email = emailElement?.getAttribute('href')?.replace('mailto:', '') || null;

    //             // Extract business hours
    //             const hoursElement = element.querySelector('div.business-hours, .hours, .opening-hours');
    //             business.businessHours = hoursElement?.textContent?.trim() || null;

    //             // Extract description
    //             const descriptionElement = element.querySelector('div.business-description, .description, .summary');
    //             business.description = descriptionElement?.textContent?.trim() || null;

    //             results.push(business);
    //         });

    //         return results;
    //     });

    //     // Return the first business data (or create a default structure)
    //     if (businesses.length > 0) {
    //         const firstBusiness = businesses[0];
    //         return {
    //             business_name: firstBusiness.name || '',
    //             email: firstBusiness.email,
    //             phone: firstBusiness.phone,
    //             website: firstBusiness.websiteUrl,
    //             address: firstBusiness.address ? this.parseAddress(firstBusiness.address) || undefined : undefined,
    //             categories: firstBusiness.categories,
    //             rating: firstBusiness.rating ? this.parseRating(firstBusiness.rating) || undefined : undefined,
    //             business_hours: firstBusiness.businessHours,
    //             description: firstBusiness.description,
    //             social_media: undefined,
    //             year_established: undefined,
    //             raw_data: {}
    //         };
    //     }

    //     // Return default structure if no businesses found
    //     return {
    //         business_name: '',
    //         email: undefined,
    //         phone: undefined,
    //         website: undefined,
    //         address: undefined,
    //         categories: [],
    //         rating: undefined,
    //         business_hours: undefined,
    //         description: undefined,
    //         social_media: undefined,
    //         year_established: undefined,
    //         raw_data: {}
    //     };
    // }

    /**
     * Handle pagination for 11880.com
     */
    // async handlePagination(page: Page, maxPages: number): Promise<void> {
    //     console.log('Handling pagination for 11880.com');

    //     const currentPage = await this.getCurrentPage(page);
    //     if (currentPage >= maxPages) {
    //         console.log(`Reached maximum page limit: ${maxPages}`);
    //         return;
    //     }

    //     const hasNext = await this.hasNextPage(page);
    //     if (hasNext) {
    //         const nextButton = await page.$('a.pagination-next, .next-page, .pagination .next');
    //         if (nextButton) {
    //             await nextButton.click();
    //             await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
    //             console.log(`Navigated to page ${currentPage + 1}`);
    //         }
    //     }
    // }

    /**
     * Apply cookies to the page
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        console.log('Applying cookies to 11880.com');
        
        if (cookies && Array.isArray(cookies)) {
            await page.setCookie(...cookies);
        }
    }

    /**
     * Parse address text into structured format
     */
    // private parseAddress(addressText: string): Address | null {
    //     if (!addressText) return null;

    //     // Simple address parsing
    //     const parts = addressText.split(',').map(part => part.trim());
        
    //     return {
    //         street: parts[0] || '',
    //         city: parts[1] || '',
    //         state: parts[2] || '',
    //         zip: parts[3] || '',
    //         country: 'Unknown',
    //         formatted: addressText
    //     };
    // }

    // /**
    //  * Parse rating from text
    //  */
    // private parseRating(ratingText: string): Rating | null {
    //     if (!ratingText) return null;

    //     // Extract numeric rating from text like "4.5 stars" or "4.5/5"
    //     const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
    //     if (ratingMatch) {
    //         const score = parseFloat(ratingMatch[1]);
    //         return {
    //             score: score,
    //             max_score: 5,
    //             review_count: 0
    //         };
    //     }

    //     return null;
    // }

    // /**
    //  * Get current page number
    //  */
    // private async getCurrentPage(page: Page): Promise<number> {
    //     try {
    //         const currentPageElement = await page.$('.pagination-current, .current-page, .page-number');
    //         if (currentPageElement) {
    //             const text = await page.evaluate(el => el.textContent, currentPageElement);
    //             return parseInt(text || '1', 10);
    //         }
    //     } catch (error) {
    //         console.error('Error getting current page:', error);
    //     }
    //     return 1;
    // }

    // /**
    //  * Check if there's a next page
    //  */
    // private async hasNextPage(page: Page): Promise<boolean> {
    //     try {
    //         const nextButton = await page.$('a.pagination-next, .next-page, .pagination .next');
    //         return nextButton !== null;
    //     } catch (error) {
    //         console.error('Error checking for next page:', error);
    //         return false;
    //     }
    // }

    // /**
    //  * Handle site-specific features for 11880.com
    //  */
    // async handleSiteSpecificFeatures(page: Page): Promise<void> {
    //     console.log('Handling 11880.com specific features');

    //     // Handle any additional site-specific features here
    //     // This method can be extended based on specific requirements for 11880.com
    // }
}
