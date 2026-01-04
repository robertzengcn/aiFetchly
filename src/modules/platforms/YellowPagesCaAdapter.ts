import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { SearchResult } from '@/modules/interface/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/modules/interface/IDataExtractor';

/**
 * YellowPages.ca Platform Adapter
 * 
 * Specialized adapter for scraping business data from YellowPages.ca
 * Implements custom logic for handling YellowPages.ca specific features
 * Note: While similar to YellowPages.com, the Canadian version may have
 * different selectors, structure, and regional features
 */
export class YellowPagesCaAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Custom search implementation for YellowPages.ca
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]> {
        const searchUrl = this.buildSearchUrl(keywords, location, 1);
        console.log(`Searching YellowPages.ca: ${searchUrl}`);
        return [];
    }

    /**
     * Custom business data extraction for YellowPages.ca
     */
    async extractBusinessData(page: Page): Promise<BusinessData> {
        console.log('Extracting business data from YellowPages.ca');

        // Wait for results to load - YellowPages.ca may have different selectors
        await page.waitForSelector('div#main-content div.search-results.organic div.result, .listing-item, .business-listing', { timeout: 10000 });

        // Extract all business listings
        const businesses = await page.evaluate(() => {
            const results: any[] = [];
            
            // Try multiple possible selectors for YellowPages.ca
            const businessElements = document.querySelectorAll(
                'div#main-content div.search-results.organic div.result, .listing-item, .business-listing, .result-item'
            );

            businessElements.forEach((element) => {
                const business: any = {};

                // Extract business name - try multiple selectors
                const nameElement = element.querySelector('a.business-name, .business-name, .listing-name, h3 a, .name a');
                business.name = nameElement?.textContent?.trim() || null;
                business.url = nameElement?.getAttribute('href') || null;

                // Extract phone number - YellowPages.ca may have different phone selectors
                const phoneElement = element.querySelector('div.phones, .phone, .phone-number, .contact-phone');
                business.phone = phoneElement?.textContent?.trim() || null;

                // Extract address - Canadian addresses may have different format
                const addressElement = element.querySelector('div.adr, .address, .location, .business-address');
                if (addressElement) {
                    const addressText = addressElement.textContent?.trim() || '';
                    business.address = this.parseCanadianAddress(addressText);
                } else {
                    business.address = null;
                }

                // Extract categories
                const categoriesElement = element.querySelector('div.categories, .category, .business-category');
                business.categories = categoriesElement?.textContent?.trim().split('\n').map(cat => cat.trim()).filter(cat => cat) || [];

                // Extract rating - may have different rating system
                const ratingElement = element.querySelector('div.result-rating, .rating, .business-rating');
                if (ratingElement) {
                    const ratingClasses = Array.from(ratingElement.classList);
                    business.rating = this.parseCanadianRating(ratingClasses);
                } else {
                    business.rating = null;
                }

                // Extract review count
                const reviewElement = element.querySelector('span.count, .review-count, .reviews-count');
                business.reviewCount = reviewElement?.textContent?.trim().replace(/[()]/g, '') || null;

                // Extract years in business - may not be available on Canadian version
                const yearsElement = element.querySelector('div.badges div.years-with-yp > div.count strong, .years-in-business');
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
     * Custom pagination handling for YellowPages.ca
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        const currentPage = await this.getCurrentPage(page);
        
        if (currentPage >= maxPages) {
            console.log(`Reached maximum pages (${maxPages})`);
            return;
        }

        // Check if next page button exists and is clickable - may have different selectors
        const nextButton = await page.$('a.next, .pagination .next, .next-page, .pagination-next');
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
        await page.waitForSelector('div.result, .listing-item, .business-listing', { timeout: 10000 });
        
        console.log(`Navigated to page ${currentPage + 1}`);
    }

    /**
     * Extract detailed business information from individual business page
     */
    async extractDetailedBusinessInfo(page: Page, businessUrl: string): Promise<any> {
        if (!businessUrl) return {};

        try {
            // Navigate to business detail page - YellowPages.ca domain
            const fullUrl = businessUrl.startsWith('http') ? businessUrl : `https://www.yellowpages.ca${businessUrl}`;
            await page.goto(fullUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });

            // Extract additional details
            const details = await page.evaluate(() => {
                const result: any = {};

                // Extract website - may have different selectors
                const websiteElement = document.querySelector('p.website a, .website-link, .business-website a');
                result.websiteUrl = websiteElement?.getAttribute('href') || null;

                // Extract email - may have different selectors
                const emailElement = document.querySelector('a.email-business, .email-link, .contact-email');
                result.email = emailElement?.getAttribute('href')?.replace('mailto:', '') || null;

                // Extract business hours - may have different structure
                const hoursElements = document.querySelectorAll('table.hours-table tr, .business-hours tr, .hours-table tr');
                const businessHours: any = {};
                hoursElements.forEach(row => {
                    const dayElement = row.querySelector('td.day, .day');
                    const timeElement = row.querySelector('td.time, .time, .hours');
                    if (dayElement && timeElement) {
                        businessHours[dayElement.textContent?.trim() || ''] = timeElement.textContent?.trim() || '';
                    }
                });
                result.businessHours = Object.keys(businessHours).length > 0 ? businessHours : null;

                // Extract description - may have different selectors
                const descElement = document.querySelector('div.business-description, .description, .business-info');
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
     * Parse Canadian address string into structured format
     * Canadian addresses may have different format than US addresses
     */
    private parseCanadianAddress(addressText: string): Address | null {
        if (!addressText) return null;

        // Canadian addresses typically format as:
        // "123 Main St, City, Province PostalCode"
        // or "123 Main St, City, ON L1A 1A1"
        const parts = addressText.split(',').map(part => part.trim());
        
        if (parts.length < 2) return null;

        const street = parts[0];
        const lastPart = parts[parts.length - 1];
        
        // Canadian postal codes are in format A1A 1A1
        const postalCodeMatch = lastPart.match(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/);
        const zip = postalCodeMatch ? postalCodeMatch[0] : '';
        
        // Extract province (2-letter code like ON, BC, QC)
        const provinceMatch = lastPart.match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/);
        const state = provinceMatch ? provinceMatch[0] : '';
        
        // City is everything between street and province/postal code
        const city = parts.slice(1, -1).join(', ').trim() || 
                    (lastPart.replace(postalCodeMatch?.[0] || '', '').replace(provinceMatch?.[0] || '', '').trim());

        return {
            street,
            city,
            state,
            zip,
            country: 'Canada'
        };
    }

    /**
     * Parse rating from CSS classes - may be different from US version
     */
    private parseCanadianRating(ratingClasses: string[]): Rating | null {
        const ratingMap: { [key: string]: number } = {
            'one': 1,
            'one-half': 1.5,
            'two': 2,
            'two-half': 2.5,
            'three': 3,
            'three-half': 3.5,
            'four': 4,
            'four-half': 4.5,
            'five': 5,
            // Canadian-specific rating classes if any
            'rating-1': 1,
            'rating-2': 2,
            'rating-3': 3,
            'rating-4': 4,
            'rating-5': 5
        };

        for (const className of ratingClasses) {
            if (ratingMap[className]) {
                return {
                    score: ratingMap[className],
                    max_score: 5,
                    review_count: 0,
                    rating_text: 'YellowPages.ca'
                };
            }
        }

        return null;
    }

    /**
     * Get current page number - may have different pagination structure
     */
    private async getCurrentPage(page: Page): Promise<number> {
        try {
            return await page.evaluate(() => {
                const currentPageElement = document.querySelector('.pagination .current, .current-page, .page-current');
                return currentPageElement ? parseInt(currentPageElement.textContent || '1') : 1;
            });
        } catch {
            return 1;
        }
    }

    /**
     * Check if there's a next page - may have different selectors
     */
    private async hasNextPage(page: Page): Promise<boolean> {
        try {
            return await page.evaluate(() => {
                const nextButton = document.querySelector('a.next, .pagination .next, .next-page');
                return nextButton ? !nextButton.classList.contains('disabled') : false;
            });
        } catch {
            return false;
        }
    }

    /**
     * Apply cookies for YellowPages.ca
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        if (!cookies || !Array.isArray(cookies)) {
            console.log('No cookies to apply for YellowPages.ca');
            return;
        }

        try {
            // Set cookies for yellowpages.ca domain
            const yellowPagesCookies = cookies.filter(cookie => 
                cookie.domain && cookie.domain.includes('yellowpages.ca')
            );

            if (yellowPagesCookies.length > 0) {
                await page.setCookie(...yellowPagesCookies);
                console.log(`Applied ${yellowPagesCookies.length} cookies for YellowPages.ca`);
            }
        } catch (error) {
            console.error('Error applying cookies for YellowPages.ca:', error);
        }
    }

    /**
     * Handle YellowPages.ca specific features like cookie banners
     * Canadian sites may have different privacy/GDPR requirements
     */
    async handleSiteSpecificFeatures(page: Page): Promise<void> {
        try {
            // Wait for page to load
            await page.waitForSelector('body', { timeout: 10000 });

            // Handle cookie consent banner if present - Canadian privacy laws
            const cookieBanner = await page.$('.cookie-banner, .gdpr-banner, #cookieConsentBanner, .privacy-notice');
            if (cookieBanner) {
                const acceptButton = await page.$('.cookie-banner .accept, .gdpr-banner .accept, #cookieConsentBanner .accept, .privacy-notice .accept');
                if (acceptButton) {
                    await acceptButton.click();
                    console.log('Accepted cookie banner on YellowPages.ca');
                }
            }

            // Handle any popup modals
            const popup = await page.$('.modal, .popup, .overlay');
            if (popup) {
                const closeButton = await page.$('.modal .close, .popup .close, .overlay .close');
                if (closeButton) {
                    await closeButton.click();
                    console.log('Closed popup on YellowPages.ca');
                }
            }

            // Handle language selection if present (English/French)
            const languageSelector = await page.$('.language-selector, .lang-switch, .language-toggle');
            if (languageSelector) {
                const englishOption = await page.$('.language-selector .en, .lang-switch .en, .language-toggle .en');
                if (englishOption) {
                    await englishOption.click();
                    console.log('Selected English language on YellowPages.ca');
                }
            }

        } catch (error) {
            console.log('No site-specific features to handle on YellowPages.ca');
        }
    }

    /**
     * Build search URL specific to YellowPages.ca
     */
    buildSearchUrl(keywords: string[], location: string, pageNum: number = 1): string {
        const searchTerms = keywords.join(' ');
        const baseUrl = this._config.base_url;
        
        // YellowPages.ca specific search pattern
        if (this._config.settings?.searchUrlPattern) {
            return this._config.settings.searchUrlPattern
                .replace('{keywords}', encodeURIComponent(searchTerms))
                .replace('{location}', encodeURIComponent(location))
                .replace('{page}', pageNum.toString());
        }

        // Default YellowPages.ca search pattern
        return `${baseUrl}/search?q=${encodeURIComponent(searchTerms)}&location=${encodeURIComponent(location)}&page=${pageNum}`;
    }
} 