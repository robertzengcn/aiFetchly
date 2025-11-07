import { Page, ElementHandle } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { SearchResult } from '@/modules/interface/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/modules/interface/IDataExtractor';

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
                    const phoneRevealButtons = await page.$$(selector);
                    if (phoneRevealButtons.length > 0) {
                        // Try each button until we find one that's clickable
                        for (const button of phoneRevealButtons) {
                            const isClickable = await button.evaluate((el: Element) => {
                                const rect = el.getBoundingClientRect();
                                const style = window.getComputedStyle(el);
                                const htmlEl = el as HTMLElement;
                                return rect.width > 0 && 
                                       rect.height > 0 && 
                                       style.display !== 'none' && 
                                       style.visibility !== 'hidden' && 
                                       htmlEl.offsetParent !== null;
                            });
                            
                            if (isClickable) {
                                phoneRevealButton = button;
                                usedSelector = selector;
                                console.log(`📞 Found clickable phone reveal button with selector: ${selector} (${phoneRevealButtons.length} total found)`);
                                break;
                            }
                        }
                        if (phoneRevealButton) break;
                    }
                } catch (error) {
                    continue;
                }
            }

            if (!phoneRevealButton) {
                console.log('📞 No clickable phone reveal button found, trying direct phone extraction');
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
                'span[class*="telephone"]',
                'span.coord-numero'
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
     * Validate phone number format - enhanced for French phone numbers
     */
    private isValidPhoneNumber(phone: string): boolean {
        if (!phone || phone.trim() === '') return false;
        
        // Remove common phone number formatting
        const cleanPhone = phone.replace(/[\s\-\(\)\+\.]/g, '');
        
        // Check if it contains mostly digits and has reasonable length
        const hasDigits = /\d/.test(cleanPhone);
        const isReasonableLength = cleanPhone.length >= 8 && cleanPhone.length <= 15;
        const isNotJustText = !/^[a-zA-Z\s]+$/.test(phone);
        
        // Additional validation for French phone numbers
        // French mobile numbers: 06, 07, 08
        // French landline: 01, 02, 03, 04, 05
        const frenchPhonePattern = /^(0[1-8]|0[6-8])\d{8}$/;
        const isFrenchFormat = frenchPhonePattern.test(cleanPhone);
        
        // Also accept international format starting with +33
        const internationalFrenchPattern = /^\+33[1-8]\d{8}$/;
        const isInternationalFrench = internationalFrenchPattern.test(cleanPhone);
        
        // Basic validation: has digits, reasonable length, not just text
        const basicValidation = hasDigits && isReasonableLength && isNotJustText;
        
        // Return true if it passes basic validation OR matches French patterns
        return basicValidation || isFrenchFormat || isInternationalFrench;
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
     * Extract website URL with reveal interaction for PagesJaunes.fr
     * This method handles the special case where website URLs are hidden in encoded data attributes
     */
    async extractWebsiteWithReveal(page: Page, businessElement: any): Promise<string | undefined> {
        try {
            console.log('🌐 Attempting to extract website URL with reveal method for PagesJaunes.fr');

            // Look for website reveal elements with encoded data attributes
            const websiteRevealSelectors = [
                'a[data-pjlb]',
                'a[data-pjstats*="TEASER-VOIR-SITE"]',
                'a[title*="Site internet du professionnel"]',
                'a[title*="nouvelle fenêtre"]',
                'a.pj-lb[href="#"]',
                '.teaser-item.black-icon.pj-lb',
                'a[data-pjlb*="url"]',
                '.lvs-container a[data-pjlb]',
                'div.lvs-container.marg-btm-s a.teaser-item.black-icon.pj-lb.pj-link'
            ];

            let websiteRevealElement: any = null;
            let usedSelector = '';

            // Try to find the website reveal element within the business element
            for (const selector of websiteRevealSelectors) {
                try {
                    websiteRevealElement = await page.$(selector);
                    if (websiteRevealElement) {
                        usedSelector = selector;
                        console.log(`🌐 Found website reveal element with selector: ${selector}`);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }

            if (!websiteRevealElement) {
                console.log('🌐 No website reveal element found, trying direct website extraction');
                return await this.extractDirectWebsite(page);
            }

            // Extract the encoded URL from data-pjlb attribute
            const encodedData = await websiteRevealElement.evaluate((el: Element) => {
                const pjlbAttr = el.getAttribute('data-pjlb');
                if (pjlbAttr) {
                    try {
                        const decoded = JSON.parse(pjlbAttr);
                        return decoded.url;
                    } catch (error) {
                        console.warn('Failed to parse data-pjlb JSON:', error);
                        return null;
                    }
                }
                return null;
            });

            if (!encodedData) {
                console.log('🌐 No encoded URL data found, trying direct extraction');
                return await this.extractDirectWebsite(page);
            }

            // Decode the base64 encoded URL
            let websiteUrl: string | undefined = undefined;
            try {
                websiteUrl = Buffer.from(encodedData, 'base64').toString('utf-8');
                console.log(`🌐 Successfully decoded website URL: ${websiteUrl}`);
            } catch (error) {
                console.warn('🌐 Failed to decode base64 URL:', error);
                return await this.extractDirectWebsite(page);
            }

            // Validate the URL
            if (websiteUrl && this.isValidWebsiteUrl(websiteUrl)) {
                console.log(`🌐 Successfully extracted website URL: ${websiteUrl}`);
                return websiteUrl;
            } else {
                console.log('🌐 Invalid website URL format, trying direct extraction');
                return await this.extractDirectWebsite(page);
            }

        } catch (error) {
            console.error('🌐 Error in website URL reveal extraction:', error);
            // Fallback to direct extraction
            return await this.extractDirectWebsite(page);
        }
    }

    /**
     * Extract website URL directly without reveal interaction (fallback method)
     */
    private async extractDirectWebsite(businessElement: Page): Promise<string | undefined> {
        try {
            // First try to extract from span.value elements (PagesJaunes specific)
            const valueSpanSelectors = [
                'div.lvs-container.marg-btm-s a.teaser-item.black-icon.pj-lb.pj-link span.value',
                // 'a .value',
                // 'span.value',
                // '.lvs-container a span.value',
                // 'a[title*="Site internet"] span.value',
                // 'a[data-pjstats*="TEASER-VOIR-SITE"] span.value'
            ];

            for (const selector of valueSpanSelectors) {
                try {
                    const valueElement = await businessElement.$(selector);
                    if (valueElement) {
                        const websiteUrl = await valueElement.evaluate((el: Element) => {
                            const text = el.textContent?.trim();
                            if (text && text.length > 0) {
                                // Add http:// if not present
                                if (!text.startsWith('http://') && !text.startsWith('https://')) {
                                    return `http://${text}`;
                                }
                                return text;
                            }
                            return null;
                        });
                        
                        if (websiteUrl) {
                            console.log(`🌐 Extracted website URL from span.value: ${websiteUrl}`);
                            return websiteUrl;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            // Fallback to standard href extraction
            const directWebsiteSelectors = [
                'a[href^="http"]',
                'a[href^="https"]',
                'a[href^="www"]',
                '.website-link',
                '.business-website',
                'a[title*="website"]',
                'a[title*="site"]',
                'a[title*="internet"]',
                '.lvs-container a[href^="http"]'
            ];

            for (const selector of directWebsiteSelectors) {
                try {
                    const websiteElement = await businessElement.$(selector);
                    if (websiteElement) {
                        const websiteUrl = await websiteElement.evaluate((el: Element) => {
                            const href = (el as HTMLAnchorElement).href;
                            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                                return href;
                            }
                            return null;
                        });
                        
                        if (websiteUrl && this.isValidWebsiteUrl(websiteUrl)) {
                            console.log(`🌐 Extracted direct website URL from href: ${websiteUrl}`);
                            return websiteUrl;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            console.log('🌐 No direct website URL found');
            return undefined;
        } catch (error) {
            console.error('🌐 Error in direct website extraction:', error);
            return undefined;
        }
    }

    /**
     * Validate website URL format - enhanced for PagesJaunes.fr
     */
    private isValidWebsiteUrl(url: string): boolean {
        if (!url || url.trim() === '') return false;
        
        try {
            // Check if it's a valid URL format (with or without protocol)
            const urlWithProtocol = /^https?:\/\/.+/i;
            const urlWithoutProtocol = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}/i;
            
            return urlWithProtocol.test(url) || urlWithoutProtocol.test(url);
        } catch (error) {
            console.error('🌐 Error in website URL validation:', error);
            return false;
        }
    }

    /**
     * Sleep utility for delays
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    
}
