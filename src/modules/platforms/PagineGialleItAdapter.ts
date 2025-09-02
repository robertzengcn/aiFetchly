import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';

/**
 * PagineGialle.it Platform Adapter
 * 
 * Specialized adapter for scraping business data from PagineGialle.it
 * Implements custom logic for handling PagineGialle.it specific features
 */
export class PagineGialleItAdapter extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Handle page load events and initial setup for PagineGialle.it
     */
    async onPageLoad(page: Page): Promise<void> {
        console.log('🔧 PagineGialle.it adapter: Custom onPageLoad method called');
        
        try {
            // Handle cookie consent if present
            const cookieSelectors = [
                '#cookie-accept',
                '.cookie-accept',
                '.accept-cookies',
                'button[data-testid="cookie-accept"]',
                '.cookie-banner button',
                '#cmpwelcomebtnyes > a'
            ];

            for (const selector of cookieSelectors) {
                try {
                    const cookieButton = await page.$(selector);
                    if (cookieButton) {
                        console.log('🍪 Found cookie button on PagineGialle.it');
                        await cookieButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.log('✅ Accepted cookies on PagineGialle.it');
                        break;
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }

            // Handle location popup if present
            const locationSelectors = [
                'button[data-testid="location-accept"]',
                '.location-accept',
                '#location-accept',
                '.location-popup button',
                '.geo-location-accept'
            ];

            for (const selector of locationSelectors) {
                try {
                    const locationButton = await page.$(selector);
                    if (locationButton) {
                        console.log('📍 Found location popup on PagineGialle.it');
                        await locationButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.log('✅ Accepted location on PagineGialle.it');
                        break;
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }

            // Wait for page to be fully ready
            console.log('⏳ Waiting for page to be fully ready...');
            await page.waitForFunction(() => {
                // Check if the page has finished loading dynamic content
                return document.readyState === 'complete' && 
                       !document.querySelector('.loading, .spinner, .progress-bar');
            }, { timeout: 10000 }).catch(() => {
                console.log('⏰ Page load timeout reached, continuing...');
            });

            // Wait for network to be idle
            await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
                console.log('⏰ Network idle timeout reached, continuing...');
            });

            console.log('✅ PagineGialle.it adapter: onPageLoad method completed successfully');
            
        } catch (error) {
            console.warn('⚠️ PagineGialle.it adapter: Error in onPageLoad method:', error);
            // Don't throw error - this method should not fail the scraping process
        }
    }

    /**
     * Extract website URL with reveal interaction for PagineGialle.it
     * This method handles the special case where website URLs are hidden in encoded data attributes
     */
    async extractWebsiteWithReveal(page: Page, businessElement: any): Promise<string | undefined> {
        try {
            console.log('🌐 Attempting to extract website URL with reveal method for PagineGialle.it');

            // Look for website reveal elements with encoded data attributes
            const websiteRevealSelectors = [
                'a[data-pjlb]',
                'a[data-pjstats*="TEASER-VOIR-SITE"]',
                'a[title*="Site internet"]',
                'a[title*="nouvelle fenêtre"]',
                'a.pj-lb[href="#"]',
                '.teaser-item.black-icon.pj-lb',
                'a[data-pjlb*="url"]'
            ];

            let websiteRevealElement: any = null;
            let usedSelector = '';

            // Try to find the website reveal element within the business element
            for (const selector of websiteRevealSelectors) {
                try {
                    websiteRevealElement = await businessElement.$(selector);
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
    private async extractDirectWebsite(page: Page): Promise<string | undefined> {
        try {
            const directWebsiteSelectors = [
                'div.lvs-container.marg-btm-s a.teaser-item.black-icon.pj-lb.pj-link span.value',
               
            ];

            for (const selector of directWebsiteSelectors) {
                try {
                    const websiteElement = await page.$(selector);
                    if (websiteElement) {
                        const websiteUrl = await websiteElement.evaluate((el: Element) => {
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
                        
                        if (websiteUrl && this.isValidWebsiteUrl(websiteUrl)) {
                            console.log(`🌐 Extracted direct website URL: ${websiteUrl}`);
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
     * Validate website URL format
     */
    private isValidWebsiteUrl(url: string): boolean {
        if (!url || url.trim() === '') return false;
        
        try {
            // Check if it's a valid URL format
            const urlPattern = /^https?:\/\/.+/i;
            return urlPattern.test(url);
        } catch (error) {
            return false;
        }
    }
}
