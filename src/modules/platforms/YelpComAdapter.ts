import { Page, ElementHandle } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';

/**
 * Yelp.com Platform Adapter
 * 
 * Specialized adapter for scraping business data from yelp.com
 * Implements custom logic for handling Yelp-specific features
 */
export class YelpComAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Handle page load events for Yelp.com
     * This method handles alert popups and other page load issues specific to Yelp
     */
    async onPageLoad(page: Page): Promise<void> {
        try {
            console.log('🔄 YelpComAdapter: Handling page load events');

            // Handle alert popups that might appear
            await this.handleAlertPopups(page);

            // Wait for any dynamic content to load
            await this.waitForDynamicContent(page);

            console.log('✅ YelpComAdapter: Page load handling completed');
        } catch (error) {
            console.warn('⚠️ YelpComAdapter: Error during page load handling:', error);
        }
    }

    /**
     * Handle alert popups that might appear on Yelp pages
     */
    private async handleAlertPopups(page: Page): Promise<void> {
        try {
            // Set up dialog handler to automatically accept alerts
            page.on('dialog', async (dialog) => {
                console.log('🚨 Alert dialog detected:', dialog.message());
                await dialog.accept();
                console.log('✅ Alert dialog accepted');
            });

            // Check for common Yelp popup selectors and close them
            const popupSelectors = [
                '[data-testid="modal-close"]',
                '.modal-close',
                '.close-button',
                '[aria-label="Close"]',
                '[aria-label="close"]',
                '.y-css-close',
                '.y-css-modal-close',
                'button[class*="close"]',
                'button[class*="Close"]',
                '.popup-close',
                '.alert-close'
            ];

            for (const selector of popupSelectors) {
                try {
                    const popupElement = await page.$(selector);
                    if (popupElement) {
                        console.log(`🔍 Found popup with selector: ${selector}`);
                        await popupElement.click();
                        console.log('✅ Popup closed');
                        await this.sleep(1000); // Wait for popup to close
                        break; // Only close the first popup found
                    }
                } catch (error) {
                    // Continue to next selector if this one fails
                    continue;
                }
            }

            // Handle any remaining alerts that might not be caught by selectors
            try {
                const alertText = await page.evaluate(() => {
                    const alert = document.querySelector('[role="alert"]');
                    return alert ? alert.textContent : null;
                });
                
                if (alertText) {
                    console.log('🚨 Alert text found:', alertText);
                    // Try to find and click any "OK", "Confirm", or "Accept" buttons
                    const confirmButtons = await page.$$('button');
                    for (const button of confirmButtons) {
                        const text = await button.evaluate(el => el.textContent?.toLowerCase().trim());
                        if (text && (text.includes('ok') || text.includes('confirm') || text.includes('accept') || text.includes('continue'))) {
                            console.log('🔘 Clicking confirm button:', text);
                            await button.click();
                            await this.sleep(1000);
                            break;
                        }
                    }
                }
            } catch (error) {
                console.log('ℹ️ No additional alerts to handle');
            }

        } catch (error) {
            console.warn('⚠️ Error handling alert popups:', error);
        }
    }

    /**
     * Sleep for a specified number of milliseconds
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Wait for dynamic content to load on Yelp pages
     */
    private async waitForDynamicContent(page: Page): Promise<void> {
        try {
            // Wait for common Yelp content to load
            const contentSelectors = [
                'section.y-css-1790tv2', // Business information section
                '[data-testid="cookbook-island"]', // Business details
                '.y-css-y8tdj8', // Business container
                'main', // Main content
                'body' // Fallback to body
            ];

            for (const selector of contentSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    console.log(`✅ Content loaded: ${selector}`);
                    break;
                } catch (error) {
                    console.log(`⏳ Waiting for content: ${selector} - timeout`);
                    continue;
                }
            }

            // Additional wait for any lazy-loaded content
            await this.sleep(2000);

        } catch (error) {
            console.warn('⚠️ Error waiting for dynamic content:', error);
        }
    }

 
    /**
     * Extract phone number from Yelp.com business section
     * This method extracts phone number from the business information section
     */
    async extractPhoneNumberWithReveal(page: Page, businessElement: any): Promise<string | undefined> {
        try {
            console.log('📞 Extracting phone number from Yelp.com business section');

            // Look for the business information section
            const businessSection = await page.$('section.y-css-1790tv2 div.y-css-y8tdj8');
            if (!businessSection) {
                console.log('❌ Business section not found');
                return undefined;
            }

            // Get the HTML content of the business section
            const sectionHTML = await businessSection.evaluate((el: Element) => el.outerHTML);
            console.log('🔍 Business section HTML content retrieved');

            // Extract phone number using regex from the HTML content
            // Look for the pattern after "Phone number</p>" and before the next closing tag
            const phoneRegex = /Phone number<\/p>\s*<p[^>]*data-font-weight="semibold"[^>]*>([^<]+)<\/p>/i;
            const phoneMatch = sectionHTML.match(phoneRegex);
            
            if (phoneMatch && phoneMatch[1]) {
                console.log('✅ Found phone number element in regex: ', phoneMatch[1]);
                const phoneText = phoneMatch[1].trim();
                if (phoneText && this.isValidPhoneNumber(phoneText)) {
                    console.log(`✅ Found phone number: ${phoneText}`);
                    return phoneText;
                }
            }else{
                console.log('❌ No phone number found in regex');
            }

            // Alternative: Look for phone number in any paragraph with semibold font-weight
            const phoneParagraphs = await businessSection.$$('p[data-font-weight="semibold"]');
            for (const paragraph of phoneParagraphs) {
                const text = await paragraph.evaluate((el: Element) => el.textContent?.trim() || '');
                if (text && this.isValidPhoneNumber(text)) {
                    console.log(`✅ Found phone number in paragraph: ${text}`);
                    return text;
                }
            }

            // Alternative: Look for phone number using text content search
            const sectionText = await businessSection.evaluate((el: Element) => el.textContent || '');
            const phoneRegex2 = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
            const phoneMatches = sectionText.match(phoneRegex2);
            
            if (phoneMatches && phoneMatches.length > 0) {
                for (const phone of phoneMatches) {
                    if (this.isValidPhoneNumber(phone)) {
                        console.log(`✅ Found phone number in text: ${phone}`);
                        return phone;
                    }
                }
            }

            console.log('❌ No phone number found in business section');
            return undefined;

        } catch (error) {
            console.error('❌ Error extracting phone number from Yelp business section:', error);
            return undefined;
        }
    }

    /**
     * Extract website URL from Yelp.com business section
     * This method extracts website URL from the business information section
     */
    async extractWebsiteWithReveal(page: Page, businessElement: any): Promise<string | undefined> {
        try {
            console.log('🌐 Extracting website URL from Yelp.com business section');

            // Look for the business information section
            const businessSection = await page.$('section.y-css-1790tv2 div.y-css-y8tdj8');
            if (!businessSection) {
                console.log('❌ Business section not found');
                return undefined;
            }

            // Get the HTML content of the business section
            const sectionHTML = await businessSection.evaluate((el: Element) => el.outerHTML);
            console.log('🔍 Business section HTML content retrieved');

            // Extract website URL using regex from the HTML content
            // Look for the pattern after "Business website</p>" and extract the href from the link
            const websiteRegex = /Business website<\/p>\s*<p[^>]*data-font-weight="semibold"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i;
            const websiteMatch = sectionHTML.match(websiteRegex);
            
            if (websiteMatch && websiteMatch[1] && websiteMatch[2]) {
                const href = websiteMatch[1];
                const displayText = websiteMatch[2].trim();
                
                // Check if it's a biz_redir URL
                if (href.includes('biz_redir')) {
                    const urlMatch = href.match(/url=([^&]+)/);
                    if (urlMatch) {
                        const decodedUrl = decodeURIComponent(urlMatch[1]);
                        if (this.isValidWebsite(decodedUrl)) {
                            console.log(`✅ Found website URL: ${decodedUrl}`);
                            return decodedUrl;
                        }
                    }
                } else if (this.isValidWebsite(href)) {
                    console.log(`✅ Found website URL: ${href}`);
                    return href;
                } else if (this.isValidWebsite(`https://${displayText}`)) {
                    console.log(`✅ Found website from display text: ${displayText}`);
                    return `https://${displayText}`;
                }
            }

            // Alternative: Look for any biz_redir links in the section
            const bizRedirRegex = /href="([^"]*biz_redir[^"]*)"/gi;
            const bizRedirMatches = sectionHTML.match(bizRedirRegex);
            
            if (bizRedirMatches) {
                for (const match of bizRedirMatches) {
                    const href = match.replace(/href="/, '').replace(/"$/, '');
                    const urlMatch = href.match(/url=([^&]+)/);
                    if (urlMatch) {
                        const decodedUrl = decodeURIComponent(urlMatch[1]);
                        if (this.isValidWebsite(decodedUrl)) {
                            console.log(`✅ Found website URL from biz_redir: ${decodedUrl}`);
                            return decodedUrl;
                        }
                    }
                }
            }

            // Alternative: Look for website in any paragraph with semibold font-weight that contains a link
            const websiteParagraphs = await businessSection.$$('p[data-font-weight="semibold"] a');
            for (const link of websiteParagraphs) {
                const href = await link.evaluate((el: Element) => el.getAttribute('href') || '');
                const text = await link.evaluate((el: Element) => el.textContent?.trim() || '');
                
                if (href && href.includes('biz_redir')) {
                    const urlMatch = href.match(/url=([^&]+)/);
                    if (urlMatch) {
                        const decodedUrl = decodeURIComponent(urlMatch[1]);
                        if (this.isValidWebsite(decodedUrl)) {
                            console.log(`✅ Found website URL in link: ${decodedUrl}`);
                            return decodedUrl;
                        }
                    }
                } else if (href && this.isValidWebsite(href)) {
                    console.log(`✅ Found website URL in link: ${href}`);
                    return href;
                } else if (text && this.isValidWebsite(`https://${text}`)) {
                    console.log(`✅ Found website from link text: ${text}`);
                    return `https://${text}`;
                }
            }

            console.log('❌ No website URL found in business section');
            return undefined;

        } catch (error) {
            console.error('❌ Error extracting website URL from Yelp business section:', error);
            return undefined;
        }
    }

    /**
     * Extract address from Yelp.com business section
     * This method extracts business address from the business information section
     */
    async extractAddressFromBusinessSection(page: Page): Promise<string | undefined> {
        try {
            console.log('📍 Extracting address from Yelp.com business section');

            // Look for the business information section
            const businessSection = await page.$('section.y-css-1790tv2 div.y-css-y8tdj8');
            if (!businessSection) {
                console.log('❌ Business section not found');
                return undefined;
            }

            // Get the HTML content of the business section
            const sectionHTML = await businessSection.evaluate((el: Element) => el.outerHTML);
            console.log('🔍 Business section HTML content retrieved');

            // Extract address using regex from the HTML content
            // Look for the pattern after "Get Directions" and before the next closing tag
            const addressRegex = /Get Directions<\/a><\/p>\s*<p[^>]*data-font-weight="semibold"[^>]*>([^<]+)<\/p>/i;
            const addressMatch = sectionHTML.match(addressRegex);
            
            if (addressMatch && addressMatch[1]) {
                const addressText = addressMatch[1].trim();
                // Check if it looks like an address (contains city, state, zip pattern)
                if (addressText && /^[A-Za-z\s,]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(addressText)) {
                    console.log(`✅ Found address: ${addressText}`);
                    return addressText;
                }
            }

            // Alternative: Look for address pattern in the text content
            const sectionText = await businessSection.evaluate((el: Element) => el.textContent || '');
            const addressRegex2 = /([A-Za-z\s,]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?)/g;
            const addressMatches = sectionText.match(addressRegex2);
            
            if (addressMatches && addressMatches.length > 0) {
                for (const address of addressMatches) {
                    const trimmedAddress = address.trim();
                    if (trimmedAddress && /^[A-Za-z\s,]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(trimmedAddress)) {
                        console.log(`✅ Found address in text: ${trimmedAddress}`);
                        return trimmedAddress;
                    }
                }
            }

            // Alternative: Look for address in any paragraph with semibold font-weight
            const addressParagraphs = await businessSection.$$('p[data-font-weight="semibold"]');
            for (const paragraph of addressParagraphs) {
                const text = await paragraph.evaluate((el: Element) => el.textContent?.trim() || '');
                // Check if it looks like an address (contains city, state, zip pattern)
                if (text && text !== 'Get Directions' && /^[A-Za-z\s,]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(text)) {
                    console.log(`✅ Found address in paragraph: ${text}`);
                    return text;
                }
            }

            // Alternative: Look for address in specific Yelp CSS classes
            const addressSelectors = [
                '.y-css-p0gpmm[data-font-weight="semibold"]',
                'p[data-font-weight="semibold"]'
            ];

            for (const selector of addressSelectors) {
                try {
                    const elements = await businessSection.$$(selector);
                    for (const element of elements) {
                        const text = await element.evaluate((el: Element) => el.textContent?.trim() || '');
                        if (text && text !== 'Get Directions' && /^[A-Za-z\s,]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(text)) {
                            console.log(`✅ Found address with selector ${selector}: ${text}`);
                            return text;
                        }
                    }
                } catch (error) {
                    console.log(`⚠️ Error checking address selector ${selector}:`, error);
                }
            }

            console.log('❌ No address found in business section');
            return undefined;

        } catch (error) {
            console.error('❌ Error extracting address from Yelp business section:', error);
            return undefined;
        }
    }

    /**
     * Extract all business information from Yelp.com business section
     * This method extracts website, phone, address, and email from the business section
     */
    async extractBusinessInfoFromSection(page: Page): Promise<{
        website?: string;
        phone?: string;
        address?: string;
        email?: string;
    }> {
        try {
            console.log('🏢 Extracting all business information from Yelp.com business section');

            const businessInfo = {
                website: undefined as string | undefined,
                phone: undefined as string | undefined,
                address: undefined as string | undefined,
                email: undefined as string | undefined
            };

            // Look for the business information section
            const businessSection = await page.$('section.y-css-1790tv2 div.y-css-y8tdj8');
            if (!businessSection) {
                console.log('❌ Business section not found');
                return businessInfo;
            }

            // Extract website
            try {
                businessInfo.website = await this.extractWebsiteWithReveal(page, null);
            } catch (error) {
                console.log('⚠️ Error extracting website:', error);
            }

            // Extract phone
            try {
                businessInfo.phone = await this.extractPhoneNumberWithReveal(page, null);
            } catch (error) {
                console.log('⚠️ Error extracting phone:', error);
            }

            // Extract address
            try {
                businessInfo.address = await this.extractAddressFromBusinessSection(page);
            } catch (error) {
                console.log('⚠️ Error extracting address:', error);
            }

            // Extract email
            try {
                businessInfo.email = await this.extractEmailFromDetailPage(page);
            } catch (error) {
                console.log('⚠️ Error extracting email:', error);
            }

            console.log('✅ Business information extraction completed:', businessInfo);
            return businessInfo;

        } catch (error) {
            console.error('❌ Error extracting business information from Yelp section:', error);
            return {
                website: undefined,
                phone: undefined,
                address: undefined,
                email: undefined
            };
        }
    }

    /**
     * Validate email format
     */
    private isValidEmail(email: string): boolean {
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email);
    }

    /**
     * Validate phone number format
     */
    private isValidPhoneNumber(phone: string): boolean {
        // Remove all non-digit characters
        const digitsOnly = phone.replace(/\D/g, '');
        // Check if it has 10-15 digits (typical phone number length)
        return digitsOnly.length >= 10 && digitsOnly.length <= 15;
    }

    /**
     * Validate website URL format
     */
    private isValidWebsite(url: string): boolean {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        } catch {
            return false;
        }
    }
}
