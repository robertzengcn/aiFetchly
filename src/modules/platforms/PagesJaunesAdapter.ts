import { Page, ElementHandle } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { SearchResult } from '@/interfaces/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/interfaces/IDataExtractor';

/**
 * PagesJaunes.fr Platform Adapter
 * 
 * Specialized adapter for scraping business data from pagesjaunes.fr
 * Implements custom logic for handling French Yellow Pages specific features
 * Note: This platform requires location to be provided for searches
 */
export class PagesJaunesAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Extract phone number by clicking reveal button for PagesJaunes.fr
     * This method handles the special case where phone numbers are hidden behind a click interaction
     */
    async extractPhoneNumberWithReveal(page: Page, businessElement: any): Promise<string | undefined> {
        try {
            console.log('🔍 Attempting to extract phone number with reveal method for PagesJaunes.fr');

            // Look for the phone reveal button within the business element
            const phoneRevealSelectors = [
                'a[title="Afficher le N°"]',
                'a.fantomas[data-pjhistofantomas]',
                'a[data-pjtoggleclass*="show-numero"]',
                'a.btn_primary.pj-lb[href="#"]',
                'a[data-pjstats*="TELEPHONE"]',
                '.phone-reveal-btn',
                '.show-phone-btn'
            ];

            let phoneRevealButton: ElementHandle | null = null;
            let usedSelector = '';

            // Try to find the phone reveal button within the business element
            for (const selector of phoneRevealSelectors) {
                try {
                    phoneRevealButton = await businessElement.$(selector);
                    if (phoneRevealButton) {
                        usedSelector = selector;
                        console.log(`📞 Found phone reveal button with selector: ${selector}`);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }

            if (!phoneRevealButton) {
                console.log('📞 No phone reveal button found, trying direct phone extraction');
                return await this.extractDirectPhoneNumber(businessElement);
            }

            // Check if button is clickable
            const isClickable = await phoneRevealButton.evaluate((el: Element) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const htmlEl = el as HTMLElement;
                return rect.width > 0 && 
                       rect.height > 0 && 
                       style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       htmlEl.offsetParent !== null;
            });

            if (!isClickable) {
                console.log('📞 Phone reveal button is not clickable, trying direct extraction');
                return await this.extractDirectPhoneNumber(businessElement);
            }

            // Scroll the button into view before clicking
            await phoneRevealButton.evaluate((el: Element) => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });

            // Wait a moment for scroll to complete
            await this.sleep(500);

            console.log('📞 Clicking phone reveal button...');
            
            // Click the phone reveal button
            await phoneRevealButton.click();

            // Wait for the phone number to appear (PagesJaunes typically takes 2-5 seconds)
            console.log('⏳ Waiting for phone number to be revealed...');
            await this.sleep(3000);

            // Try to extract the revealed phone number
            const revealedPhoneSelectors = [
                'span.nb-phone',
                '.phone-number-revealed',
                '.revealed-phone',
                '.numero-telephone',
                '.telephone-numero',
                'span[class*="phone"]',
                'span[class*="numero"]',
                'span[class*="telephone"]'
            ];

            let phoneNumber: string | undefined = undefined;

            // First try within the business element
            for (const selector of revealedPhoneSelectors) {
                try {
                    const phoneElement = await businessElement.$(selector);
                    if (phoneElement) {
                        const phoneText = await phoneElement.evaluate((el: Element) => el.textContent?.trim());
                        if (phoneText && this.isValidPhoneNumber(phoneText)) {
                            phoneNumber = phoneText;
                            console.log(`📞 Successfully extracted revealed phone: ${phoneNumber} using selector: ${selector}`);
                            break;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            // If not found within business element, try page-wide search
            if (!phoneNumber) {
                console.log('📞 Phone not found in business element, searching page-wide...');
                for (const selector of revealedPhoneSelectors) {
                    try {
                        const phoneElement = await page.$(selector);
                        if (phoneElement) {
                            const phoneText = await phoneElement.evaluate((el: Element) => el.textContent?.trim());
                            if (phoneText && this.isValidPhoneNumber(phoneText)) {
                                phoneNumber = phoneText;
                                console.log(`📞 Successfully extracted revealed phone (page-wide): ${phoneNumber} using selector: ${selector}`);
                                break;
                            }
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }

            // Wait a bit more and try again if still not found
            if (!phoneNumber) {
                console.log('📞 Phone number not revealed yet, waiting longer...');
                await this.sleep(2000);
                
                // Try one more time with a broader search
                for (const selector of revealedPhoneSelectors) {
                    try {
                        const phoneElements = await page.$$(selector);
                        for (const phoneElement of phoneElements) {
                            const phoneText = await phoneElement.evaluate((el: Element) => el.textContent?.trim());
                            if (phoneText && this.isValidPhoneNumber(phoneText)) {
                                phoneNumber = phoneText;
                                console.log(`📞 Successfully extracted revealed phone (retry): ${phoneNumber}`);
                                break;
                            }
                        }
                        if (phoneNumber) break;
                    } catch (error) {
                        continue;
                    }
                }
            }

            if (!phoneNumber) {
                console.log('📞 Failed to extract revealed phone number, falling back to direct extraction');
                return await this.extractDirectPhoneNumber(businessElement);
            }

            return phoneNumber;

        } catch (error) {
            console.error('📞 Error in phone number reveal extraction:', error);
            // Fallback to direct extraction
            return await this.extractDirectPhoneNumber(businessElement);
        }
    }

    /**
     * Extract phone number directly without reveal interaction (fallback method)
     */
    private async extractDirectPhoneNumber(businessElement: any): Promise<string | undefined> {
        try {
            const directPhoneSelectors = [
                '.phone-number',
                '.telephone',
                '.contact-phone',
                'a[href^="tel:"]',
                'span[class*="phone"]',
                'div[class*="phone"]',
                '.numero',
                '.tel'
            ];

            for (const selector of directPhoneSelectors) {
                try {
                    const phoneElement = await businessElement.$(selector);
                    if (phoneElement) {
                        const phoneText = await phoneElement.evaluate((el: Element) => {
                            // Try both textContent and href attribute
                            const text = el.textContent?.trim();
                            const href = (el as HTMLAnchorElement).href;
                            
                            if (href && href.startsWith('tel:')) {
                                return href.replace('tel:', '');
                            }
                            return text;
                        });
                        
                        if (phoneText && this.isValidPhoneNumber(phoneText)) {
                            console.log(`📞 Extracted direct phone number: ${phoneText}`);
                            return phoneText;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            console.log('📞 No direct phone number found');
            return undefined;
        } catch (error) {
            console.error('📞 Error in direct phone extraction:', error);
            return undefined;
        }
    }

    /**
     * Validate phone number format
     */
    private isValidPhoneNumber(phone: string): boolean {
        if (!phone || phone.trim() === '') return false;
        
        // Remove common phone number formatting
        const cleanPhone = phone.replace(/[\s\-\(\)\+\.]/g, '');
        
        // Check if it contains mostly digits and has reasonable length
        const hasDigits = /\d/.test(cleanPhone);
        const isReasonableLength = cleanPhone.length >= 8 && cleanPhone.length <= 15;
        const isNotJustText = !/^[a-zA-Z\s]+$/.test(phone);
        
        return hasDigits && isReasonableLength && isNotJustText;
    }

    /**
     * Override the extractBusinessData method to use phone reveal functionality
     */
    async extractBusinessData(page: Page): Promise<any> {
        console.log('📊 Extracting business data using PagesJaunes.fr custom method');
        
        try {
            // Wait for business results to load
            await page.waitForSelector('.bi-list-results, .search-results, .results-list', { timeout: 15000 });
            
            // Get all business elements
            const businessElements = await page.$$('.bi-item, .result-item, .business-item, article[data-testid="business-item"]');
            
            if (businessElements.length === 0) {
                console.log('📊 No business elements found');
                return this.createEmptyBusinessData();
            }

            // Extract data from the first business element
            const firstBusiness = businessElements[0];
            
            // Extract basic information
            const businessName = await this.extractText(firstBusiness, 'h3 a, .bi-denomination a, .business-name a, h2 a') || '';
            const website = await this.extractAttribute(firstBusiness, 'h3 a, .bi-denomination a, .business-name a, h2 a', 'href') || null;
            const address = await this.extractText(firstBusiness, '.bi-address, .business-address, .contact-address') || null;
            const categories = await this.extractArray(firstBusiness, '.bi-activite, .business-category, .categories') || [];

            // Use special phone extraction method
            const phone = await this.extractPhoneNumberWithReveal(page, firstBusiness);

            // Parse address components
            const addressComponents = this.parseAddressComponents(address || '');

            return {
                business_name: businessName,
                email: null, // Email usually requires detail page navigation
                phone: phone,
                website: website,
                address: addressComponents,
                categories: categories,
                rating: null,
                business_hours: null,
                description: null,
                social_media: null,
                year_established: null,
                number_of_employees: null,
                payment_methods: null,
                specialties: null
            };

        } catch (error) {
            console.error('📊 Error extracting business data:', error);
            return this.createEmptyBusinessData();
        }
    }

    /**
     * Parse address string into components for French addresses
     */
    private parseAddressComponents(addressString: string): any {
        const components = {
            street: '',
            city: '',
            state: '',
            zipCode: '',
            country: 'France'
        };

        if (!addressString) return components;

        try {
            // French address pattern: "Street, Postal Code City"
            const parts = addressString.split(',').map(part => part.trim());
            
            if (parts.length >= 2) {
                components.street = parts[0];
                
                // Last part usually contains postal code and city
                const lastPart = parts[parts.length - 1];
                const zipCityMatch = lastPart.match(/^(\d{5})\s+(.+)$/);
                
                if (zipCityMatch) {
                    components.zipCode = zipCityMatch[1];
                    components.city = zipCityMatch[2];
                } else {
                    components.city = lastPart;
                }
            } else {
                components.street = addressString;
            }
        } catch (error) {
            console.warn('Error parsing address components:', error);
            components.street = addressString;
        }

        return components;
    }

    /**
     * Create empty business data structure
     */
    private createEmptyBusinessData(): any {
        return {
            business_name: '',
            email: null,
            phone: null,
            website: null,
            address: {
                street: '',
                city: '',
                state: '',
                zipCode: '',
                country: 'France'
            },
            categories: [],
            rating: null,
            business_hours: null,
            description: null,
            social_media: null,
            year_established: null,
            number_of_employees: null,
            payment_methods: null,
            specialties: null
        };
    }

    /**
     * Enhanced text extraction method that handles stale DOM references
     */
    private async extractText(element: ElementHandle, selector: string): Promise<string | null> {
        if (!selector) return null;
        
        try {
            const targetElement = await element.$(selector);
            if (targetElement) {
                const text = await targetElement.evaluate((el: Element) => el.textContent?.trim() || '');
                return text || null;
            }
        } catch (error) {
            console.warn(`Error extracting text with selector ${selector}:`, error);
        }
        
        return null;
    }

    /**
     * Enhanced attribute extraction method
     */
    private async extractAttribute(element: ElementHandle, selector: string, attribute: string): Promise<string | null> {
        if (!selector) return null;
        
        try {
            const targetElement = await element.$(selector);
            if (targetElement) {
                const attrValue = await targetElement.evaluate((el: Element, attr: string) => 
                    el.getAttribute(attr), attribute);
                return attrValue || null;
            }
        } catch (error) {
            console.warn(`Error extracting attribute ${attribute} with selector ${selector}:`, error);
        }
        
        return null;
    }

    /**
     * Enhanced array extraction method
     */
    private async extractArray(element: ElementHandle, selector: string): Promise<string[]> {
        if (!selector) return [];
        
        try {
            const elements = await element.$$(selector);
            const array: string[] = [];
            
            for (const el of elements) {
                try {
                    const text = await el.evaluate((element: Element) => element.textContent?.trim() || '');
                    if (text) array.push(text);
                } catch (error) {
                    continue;
                }
            }
            
            return array;
        } catch (error) {
            console.warn(`Error extracting array with selector ${selector}:`, error);
            return [];
        }
    }

    /**
     * Override searchBusinesses to handle location requirement validation
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<any[]> {
        // Validate location requirement for PagesJaunes.fr
        if (!location || location.trim() === '') {
            throw new Error('Location is required for PagesJaunes.fr searches');
        }

        console.log('🔍 Starting custom search for PagesJaunes.fr');
        console.log(`Keywords: ${keywords.join(', ')}, Location: ${location}`);

        try {
            // Navigate to search page with the first keyword
            const searchUrl = this.buildSearchUrl(keywords, location, 1);
            console.log(`🌐 Navigating to: ${searchUrl}`);
            
            await page.goto(searchUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });

            // Handle page load (cookies, popups, etc.)
            await this.handlePageLoad(page);

            // Wait for search results to load
            await page.waitForSelector('.bi-list-results, .search-results, .results-list', { 
                timeout: 15000 
            });

            // Extract search results with phone reveal functionality
            return await this.extractSearchResultsWithPhoneReveal(page);

        } catch (error) {
            console.error('🚨 Error during PagesJaunes.fr search:', error);
            throw error;
        }
    }

    /**
     * Extract search results with phone reveal functionality
     */
    private async extractSearchResultsWithPhoneReveal(page: Page): Promise<any[]> {
        const results: any[] = [];

        try {
            // Get all business elements
            const businessElements = await page.$$('.bi-item, .result-item, .business-item, article[data-testid="business-item"]');
            console.log(`📋 Found ${businessElements.length} business elements`);

            for (let i = 0; i < businessElements.length; i++) {
                try {
                    console.log(`📊 Processing business ${i + 1}/${businessElements.length}`);
                    
                    // Re-query element to avoid stale references
                    const currentElements = await page.$$('.bi-item, .result-item, .business-item, article[data-testid="business-item"]');
                    if (i >= currentElements.length) {
                        console.log(`⚠️ Business element ${i + 1} no longer exists, skipping`);
                        continue;
                    }
                    
                    const businessElement = currentElements[i];
                    
                    // Extract basic information
                    const businessName = await this.extractText(businessElement, 'h3 a, .bi-denomination a, .business-name a, h2 a');
                    
                    if (!businessName) {
                        console.log(`⚠️ No business name found for element ${i + 1}, skipping`);
                        continue;
                    }

                    const website = await this.extractAttribute(businessElement, 'h3 a, .bi-denomination a, .business-name a, h2 a', 'href');
                    const address = await this.extractText(businessElement, '.bi-address, .business-address, .contact-address');
                    const categories = await this.extractArray(businessElement, '.bi-activite, .business-category, .categories');

                    // Use special phone extraction method with reveal
                    console.log(`📞 Extracting phone for: ${businessName}`);
                    const phone = await this.extractPhoneNumberWithReveal(page, businessElement);

                    const result = {
                        id: `pj-${Date.now()}-${i}`,
                        name: businessName,
                        url: website || '',
                        phone: phone,
                        address: address,
                        categories: categories || []
                    };

                    results.push(result);
                    console.log(`✅ Extracted: ${businessName} ${phone ? `(Phone: ${phone})` : '(No phone)'}`);

                    // Small delay between extractions to avoid overwhelming the page
                    await this.sleep(500);

                } catch (error) {
                    console.error(`❌ Error processing business element ${i + 1}:`, error);
                    continue;
                }
            }

        } catch (error) {
            console.error('🚨 Error extracting search results:', error);
        }

        console.log(`📊 Total extracted: ${results.length} businesses`);
        return results;
    }

    /**
     * Build search URL for PagesJaunes.fr with proper encoding
     */
    buildSearchUrl(keywords: string[], location: string, page: number = 1): string {
        if (!location || location.trim() === '') {
            throw new Error('Location is required for PagesJaunes.fr searches');
        }

        const keywordString = keywords.join(' ');
        const baseUrl = this.baseUrl;
        
        // Use the searchUrlPattern from config or default pattern
        let searchUrl = this.config.settings?.searchUrlPattern || 
            `${baseUrl}/recherche?quoiqui={keywords}&ou={location}&page={page}`;
        
        searchUrl = searchUrl
            .replace('{keywords}', encodeURIComponent(keywordString))
            .replace('{location}', encodeURIComponent(location))
            .replace('{page}', page.toString());

        return searchUrl;
    }

    /**
     * Handle page load events (cookies, popups, etc.)
     */
    private async handlePageLoad(page: Page): Promise<void> {
        try {
            console.log('🔧 Handling page load for PagesJaunes.fr');
            
            // Wait for page to fully load
            await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
                console.log('⏰ Page load timeout reached, continuing...');
            });

            // Handle cookie consent if present
            await this.handleCookieConsent(page);

            // Handle any modal popups or overlays
            await this.handlePopups(page);

        } catch (error) {
            console.warn('⚠️ Error during page load handling:', error);
        }
    }

    /**
     * Handle cookie consent dialog
     */
    private async handleCookieConsent(page: Page): Promise<void> {
        try {
            const cookieConsentSelectors = [
                '#didomi-notice-agree-button',
                'button[id*="cookie"][id*="accept"]',
                'button[class*="cookie"][class*="accept"]',
                '.cookie-consent button',
                '[data-testid="cookie-accept"]'
            ];

            for (const selector of cookieConsentSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 3000 });
                    await page.click(selector);
                    console.log(`🍪 Accepted cookie consent using selector: ${selector}`);
                    await this.sleep(1000);
                    return;
                } catch (error) {
                    continue;
                }
            }

            console.log('🍪 No cookie consent dialog found or already accepted');
        } catch (error) {
            console.log('🍪 No cookie consent handling needed');
        }
    }

    /**
     * Handle modal popups and overlays
     */
    private async handlePopups(page: Page): Promise<void> {
        try {
            const popupCloseSelectors = [
                'button[aria-label="Fermer"]',
                'button[aria-label="Close"]',
                '.close-button',
                '.modal-close',
                '[data-testid="close"]',
                '.popup-close',
                '.overlay-close'
            ];

            for (const selector of popupCloseSelectors) {
                try {
                    const closeButton = await page.$(selector);
                    if (closeButton) {
                        const isVisible = await closeButton.isVisible();
                        if (isVisible) {
                            await closeButton.click();
                            console.log(`❌ Closed popup using selector: ${selector}`);
                            await this.sleep(500);
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
        } catch (error) {
            console.log('📱 No popups to close');
        }
    }

    /**
     * Sleep utility for delays
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    
}
