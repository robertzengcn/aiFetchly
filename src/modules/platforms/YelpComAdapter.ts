import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { SearchResult } from '@/interfaces/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/interfaces/IDataExtractor';

/**
 * Yelp.com Platform Adapter
 * 
 * Specialized adapter for scraping business data from Yelp.com
 * Implements custom logic for handling Yelp.com specific features
 */
export class YelpComAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Custom search implementation for Yelp.com
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]> {
        const searchUrl = this.buildSearchUrl(keywords, location, 1);
        console.log(`Searching Yelp.com: ${searchUrl}`);
        return [];
    }

    /**
     * Custom business data extraction for Yelp.com
     */
    async extractBusinessData(page: Page): Promise<BusinessData> {
        console.log('Extracting business data from Yelp.com');

        // Wait for results to load
        await page.waitForSelector('[data-testid="serp-ia-card"]', { timeout: 10000 });

        // Extract all business listings
        const businesses = await page.evaluate(() => {
            const results: any[] = [];
            const businessElements = document.querySelectorAll('[data-testid="serp-ia-card"]');

            businessElements.forEach((element) => {
                const business: any = {};

                // Extract business name
                const nameElement = element.querySelector('h3 a');
                business.name = nameElement?.textContent?.trim() || null;
                business.url = nameElement?.getAttribute('href') || null;

                // Extract phone number (may not be visible on search results)
                const phoneElement = element.querySelector('p[class*="css-1p9ibgf"]');
                business.phone = phoneElement?.textContent?.trim() || null;

                // Extract address (may not be fully visible on search results)
                const addressElements = element.querySelectorAll('address p');
                if (addressElements.length > 0) {
                    const addressParts: string[] = [];
                    addressElements.forEach(addr => {
                        const text = addr.textContent?.trim();
                        if (text) addressParts.push(text);
                    });
                    business.address = addressParts.join(', ');
                } else {
                    business.address = null;
                }

                // Extract categories/tags
                const categoryElements = element.querySelectorAll('[class*="priceCategory"] button');
                business.categories = Array.from(categoryElements).map(cat => cat.textContent?.trim()).filter(cat => cat) || [];

                // Extract rating
                const ratingElement = element.querySelector('[class^="five-stars"]');
                if (ratingElement) {
                    const ariaLabel = ratingElement.getAttribute('aria-label');
                    if (ariaLabel) {
                        const ratingMatch = ariaLabel.match(/(\d+\.?\d*)\s*star/i);
                        business.rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
                    }
                } else {
                    business.rating = null;
                }

                // Extract review count
                const reviewElement = element.querySelector('span[class*="css-1fdy0l5"]');
                if (reviewElement) {
                    const reviewText = reviewElement.textContent?.trim() || '';
                    const reviewMatch = reviewText.match(/(\d+)/);
                    business.reviewCount = reviewMatch ? parseInt(reviewMatch[1]) : 0;
                } else {
                    business.reviewCount = 0;
                }

                // Extract business image
                const imageElement = element.querySelector('[data-lcp-target-id="SCROLLABLE_PHOTO_BOX"] img');
                business.image = imageElement?.getAttribute('src') || null;

                // Extract price range
                const priceElement = element.querySelector('[class^="priceRange"]');
                business.priceRange = priceElement?.textContent?.trim() || null;

                // Extract services/amenities
                const serviceElements = element.querySelectorAll('[data-testid="services-actions-component"] p[class*="tagText"]');
                business.services = Array.from(serviceElements).map(service => service.textContent?.trim()).filter(service => service) || [];

                // Extract website URL (usually requires visiting business page)
                business.websiteUrl = null;
                business.email = null;

                results.push(business);
            });

            return results;
        });

        // Return the first business data (or create a default structure)
        if (businesses.length > 0) {
            const firstBusiness = businesses[0];
            
            // Parse the address if available
            let parsedAddress: Address | undefined;
            if (firstBusiness.address) {
                parsedAddress = this.parseAddress(firstBusiness.address) || undefined;
            }

            // Create rating object if available
            let ratingObj: Rating | undefined;
            if (firstBusiness.rating !== null) {
                ratingObj = {
                    score: firstBusiness.rating,
                    max_score: 5,
                    review_count: firstBusiness.reviewCount || 0,
                    rating_text: 'Yelp.com'
                };
            }

            return {
                business_name: firstBusiness.name || '',
                email: firstBusiness.email,
                phone: firstBusiness.phone,
                website: firstBusiness.websiteUrl,
                address: parsedAddress,
                categories: firstBusiness.categories,
                rating: ratingObj,
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
     * Custom pagination handling for Yelp.com
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        const currentPage = await this.getCurrentPage(page);
        
        if (currentPage >= maxPages) {
            console.log(`Reached maximum pages (${maxPages})`);
            return;
        }

        // Check if next page button exists and is clickable
        const nextButtons = await page.$$('[class^="pagination-links"] a');
        let nextButton: any = null;

        // Find the "Next" button (usually the last one or has specific text)
        for (const button of nextButtons) {
            const href = await button.evaluate(el => el.getAttribute('href'));
            const text = await button.evaluate(el => el.textContent);
            
            // Look for next page indicators
            if (href && (href.includes('start=') || text?.toLowerCase().includes('next'))) {
                const currentStart = this.extractStartFromUrl(page.url());
                const buttonStart = this.extractStartFromUrl(href);
                
                // If this button leads to a higher start value, it's likely the next button
                if (buttonStart > currentStart) {
                    nextButton = button;
                    break;
                }
            }
        }

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
        await page.waitForSelector('[data-testid="serp-ia-card"]', { timeout: 10000 });
        
        console.log(`Navigated to page ${currentPage + 1}`);
    }

    /**
     * Extract detailed business information from individual business page
     */
    async extractDetailedBusinessInfo(page: Page, businessUrl: string): Promise<any> {
        if (!businessUrl) return {};

        try {
            // Navigate to business detail page
            const fullUrl = businessUrl.startsWith('http') ? businessUrl : `https://www.yelp.com${businessUrl}`;
            await page.goto(fullUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });

            // Extract additional details
            const details = await page.evaluate(() => {
                const result: any = {};

                // Extract website
                const websiteElement = document.querySelector('a[href*="biz_redir"]');
                if (websiteElement) {
                    const href = websiteElement.getAttribute('href');
                    if (href) {
                        // Decode the Yelp redirect URL to get the actual website
                        try {
                            const urlParams = new URLSearchParams(href.split('?')[1]);
                            result.websiteUrl = urlParams.get('url') || href;
                        } catch {
                            result.websiteUrl = href;
                        }
                    }
                } else {
                    result.websiteUrl = null;
                }

                // Extract email (usually not visible on Yelp)
                const emailElement = document.querySelector('a[href^="mailto:"]');
                result.email = emailElement?.getAttribute('href')?.replace('mailto:', '') || null;

                // Extract phone number
                const phoneElement = document.querySelector('p[class*="css-1p9ibgf"]');
                result.phone = phoneElement?.textContent?.trim() || null;

                // Extract business hours
                const hoursElements = document.querySelectorAll('table[class*="hours"] tr, .hours-table tr');
                const businessHours: any = {};
                hoursElements.forEach(row => {
                    const dayElement = row.querySelector('th, td:first-child');
                    const timeElement = row.querySelector('td:last-child');
                    if (dayElement && timeElement) {
                        const day = dayElement.textContent?.trim();
                        const time = timeElement.textContent?.trim();
                        if (day && time) {
                            businessHours[day] = time;
                        }
                    }
                });
                result.businessHours = Object.keys(businessHours).length > 0 ? businessHours : null;

                // Extract description/about
                const descElement = document.querySelector('[data-testid="business-description"], .business-description');
                result.description = descElement?.textContent?.trim() || null;

                // Extract full address
                const addressElements = document.querySelectorAll('address p');
                if (addressElements.length > 0) {
                    const addressParts: string[] = [];
                    addressElements.forEach(addr => {
                        const text = addr.textContent?.trim();
                        if (text) addressParts.push(text);
                    });
                    result.fullAddress = addressParts.join(', ');
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

        // Yelp.com typically formats addresses as:
        // "123 Main St, City, ST 12345" or variations
        const parts = addressText.split(',').map(part => part.trim());
        
        if (parts.length < 2) return null;

        const street = parts[0];
        
        // Handle different address formats
        let city = '';
        let state = '';
        let zip = '';
        
        if (parts.length >= 3) {
            city = parts[1];
            const lastPart = parts[parts.length - 1];
            const stateZipMatch = lastPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
            if (stateZipMatch) {
                state = stateZipMatch[1];
                zip = stateZipMatch[2];
            } else {
                // If no state/zip pattern found, treat last part as city continuation
                city = parts.slice(1).join(', ');
            }
        } else {
            city = parts[1];
        }

        return {
            street,
            city,
            state,
            zip,
            country: 'USA'
        };
    }

    /**
     * Get current page number from URL
     */
    private async getCurrentPage(page: Page): Promise<number> {
        try {
            const url = page.url();
            const startParam = this.extractStartFromUrl(url);
            // Yelp uses 10 results per page, so page = (start / 10) + 1
            return Math.floor(startParam / 10) + 1;
        } catch {
            return 1;
        }
    }

    /**
     * Extract start parameter from Yelp URL
     */
    private extractStartFromUrl(url: string): number {
        try {
            const urlObj = new URL(url);
            const start = urlObj.searchParams.get('start');
            return start ? parseInt(start) : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Check if there's a next page
     */
    private async hasNextPage(page: Page): Promise<boolean> {
        try {
            return await page.evaluate(() => {
                const nextButtons = document.querySelectorAll('[class^="pagination-links"] a');
                for (const button of nextButtons) {
                    const text = button.textContent?.toLowerCase();
                    const href = button.getAttribute('href');
                    if ((text?.includes('next') || href?.includes('start=')) && !button.classList.contains('disabled')) {
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
     * Apply cookies for Yelp.com
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        if (!cookies || !Array.isArray(cookies)) {
            console.log('No cookies to apply for Yelp.com');
            return;
        }

        try {
            // Set cookies for yelp.com domain
            const yelpCookies = cookies.filter(cookie => 
                cookie.domain && (cookie.domain.includes('yelp.com') || cookie.domain.includes('.yelp.com'))
            );

            if (yelpCookies.length > 0) {
                await page.setCookie(...yelpCookies);
                console.log(`Applied ${yelpCookies.length} cookies for Yelp.com`);
            }
        } catch (error) {
            console.error('Error applying cookies for Yelp.com:', error);
        }
    }

    /**
     * Handle Yelp.com specific features like cookie banners, location prompts
     */
    async handleSiteSpecificFeatures(page: Page): Promise<void> {
        try {
            // Wait for page to load
            await page.waitForSelector('body', { timeout: 10000 });

            // Handle location permission prompt
            const locationPrompt = await page.$('[data-testid="location-prompt"], .location-prompt');
            if (locationPrompt) {
                const dismissButton = await page.$('[data-testid="location-prompt"] button, .location-prompt .dismiss');
                if (dismissButton) {
                    await dismissButton.click();
                    console.log('Dismissed location prompt on Yelp.com');
                }
            }

            // Handle cookie consent banner if present
            const cookieBanner = await page.$('.cookie-banner, .gdpr-banner, [data-testid="cookie-banner"]');
            if (cookieBanner) {
                const acceptButton = await page.$('.cookie-banner .accept, .gdpr-banner .accept, [data-testid="cookie-banner"] .accept');
                if (acceptButton) {
                    await acceptButton.click();
                    console.log('Accepted cookie banner on Yelp.com');
                }
            }

            // Handle any popup modals or overlays
            const popup = await page.$('.modal, .popup, .overlay, [data-testid="modal"]');
            if (popup) {
                const closeButton = await page.$('.modal .close, .popup .close, .overlay .close, [data-testid="modal"] .close');
                if (closeButton) {
                    await closeButton.click();
                    console.log('Closed popup on Yelp.com');
                }
            }

        } catch (error) {
            console.log('No site-specific features to handle on Yelp.com or error occurred:', error);
        }
    }
}