import { Page } from 'puppeteer';
import { log } from "@/modules/Logger";
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { SearchResult } from '@/modules/interface/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/modules/interface/IDataExtractor';

/**
 * Gelbeseiten.de Platform Adapter
 * 
 * Specialized adapter for scraping business data from gelbeseiten.de
 * Implements custom logic for handling German business directory site specific features
 */
export class AdapterGelbeseiten extends BasePlatformAdapter {
    
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Handle page load events and initial setup for gelbeseiten.de
     */
    async onPageLoad(page: Page): Promise<void> {
        log.info('Handling page load for gelbeseiten.de');
        
        // Wait for page to fully load first
        await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
            log.info('Page load timeout reached, continuing...');
        });

        // Handle cookie consent with shadow root support - wait a bit for dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try multiple times to handle dynamically created shadow roots
        let shadowRootCookieResult = false;
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries && !shadowRootCookieResult; attempt++) {
            try {
                log.info(`Attempting to find cookie button in shadow root (attempt ${attempt}/${maxRetries})`);
                
                // Handle shadow root cookie consent - common pattern for modern cookie dialogs
                shadowRootCookieResult = await page.evaluate(() => {
                    // Function to recursively search through shadow roots
                    function findInShadowRoots(root: Document | ShadowRoot, targetSelector: string): HTMLElement | null {
                        // First check in the current root
                        const element = root.querySelector(targetSelector) as HTMLElement;
                        if (element && typeof element.click === 'function') {
                            return element;
                        }
                        
                        // Then check all shadow roots in the current root
                        const allElements = root.querySelectorAll('*');
                        for (const el of allElements) {
                            if (el.shadowRoot) {
                                const found = findInShadowRoots(el.shadowRoot, targetSelector);
                                if (found) return found;
                            }
                        }
                        
                        return null;
                    }
                    
                    // Primary target: #cmpbntyestxt
                    const primaryButton = findInShadowRoots(document, '#cmpbntyestxt');
                    if (primaryButton) {
                        log.info('Found primary cookie button #cmpbntyestxt in shadow root');
                        primaryButton.click();
                        return true;
                    }
                    
                    // Secondary targets: other common cookie button selectors
                    const alternativeSelectors = [
                        '#cmpwelcomebtnyes',
                        '.cookie-accept',
                        'button[data-testid="cookie-accept"]',
                        'button:contains("Accept")',
                        'button:contains("Akzeptieren")',
                        'button[data-testid="cookie-accept-all"]',
                        '.gdpr-consent-accept-all'
                    ];
                    
                    for (const selector of alternativeSelectors) {
                        try {
                            const button = findInShadowRoots(document, selector);
                            if (button) {
                                log.info(`Found cookie button in shadow root with selector: ${selector}`);
                                button.click();
                                return true;
                            }
                        } catch (e) {
                            // Continue to next selector
                        }
                    }
                    
                    return false;
                });
                
                if (shadowRootCookieResult) {
                    log.info(`Successfully clicked cookie button in shadow root on attempt ${attempt}`);
                    break;
                } else if (attempt < maxRetries) {
                    log.info(`Cookie button not found on attempt ${attempt}, waiting before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                log.info(`Error handling shadow root cookie consent on attempt ${attempt}:`, error);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        if (shadowRootCookieResult) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Handle regular cookie consent if present (common on German sites)
        try {
            // Common German cookie consent selectors
            const cookieSelectors = [
                '#gdpr-consent-accept-all',
                '.gdpr-consent-accept-all',
                'button[data-testid="cookie-accept-all"]',
                '.cookie-accept-all',
                '#cookie-accept-all',
                'button:contains("Alle akzeptieren")',
                'button:contains("Accept all")',
                '.js-accept-all-cookies',
                '#cmpbntyestxt', // Also check for this selector in regular DOM
                '#cmpwelcomebtnyes'
            ];
            
            for (const selector of cookieSelectors) {
                try {
                    const cookieButton = await page.$(selector);
                    if (cookieButton) {
                        log.info(`Found cookie button on gelbeseiten.de using selector: ${selector}`);
                        await cookieButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        log.info('Accepted cookies on gelbeseiten.de');
                        break;
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }
        } catch (error) {
            log.info('No cookie consent dialog found or already handled');
        }

        // Handle location popup if present (common on German business sites)
        try {
            const locationSelectors = [
                'button[data-testid="location-accept"]',
                '.location-accept',
                '#location-accept',
                'button:contains("Standort akzeptieren")',
                'button:contains("Accept location")',
                '.js-location-accept'
            ];
            
            for (const selector of locationSelectors) {
                try {
                    const locationButton = await page.$(selector);
                    if (locationButton) {
                        await locationButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        log.info('Accepted location on gelbeseiten.de');
                        break;
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }
        } catch (error) {
            log.info('No location popup found or already handled');
        }

        // Wait for page to fully load
        await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
            log.info('Page load timeout reached, continuing...');
        });
    }

    /**
     * Extract email from detail page for gelbeseiten.de
     * Looks for email addresses in data-link attributes that start with "mailto:"
     */
    async extractEmailFromDetailPage(page: Page): Promise<string | undefined> {
        try {
            log.info('🔧 Extracting email from gelbeseiten.de detail page using custom method');
            
            // Look for elements with data-link attributes containing mailto
            const emailElement = await page.$('[data-link^="mailto:"]');
            
            if (emailElement) {
                // Extract the data-link attribute value
                const dataLink = await emailElement.evaluate(el => el.getAttribute('data-link'));
                
                if (dataLink && dataLink.startsWith('mailto:')) {
                    // Extract email from mailto URL
                    const emailMatch = dataLink.match(/mailto:([^?&\s]+)/);
                    if (emailMatch && emailMatch[1]) {
                        const extractedEmail = emailMatch[1].trim();
                        log.info(`📧 Successfully extracted email from data-link: ${extractedEmail}`);
                        return extractedEmail;
                    }
                }
            }
            
            // Fallback: look for other common email patterns on gelbeseiten.de
            const fallbackSelectors = [
                'a[href^="mailto:"]',
                '[data-email]',
                '.email-link',
                '.contact-email'
            ];
            
            for (const selector of fallbackSelectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        // Try href attribute first
                        const href = await element.evaluate(el => el.getAttribute('href'));
                        if (href && href.startsWith('mailto:')) {
                            const emailMatch = href.match(/mailto:([^?&\s]+)/);
                            if (emailMatch && emailMatch[1]) {
                                const extractedEmail = emailMatch[1].trim();
                                log.info(`📧 Extracted email from href (${selector}): ${extractedEmail}`);
                                return extractedEmail;
                            }
                        }
                        
                        // Try data-email attribute
                        const dataEmail = await element.evaluate(el => el.getAttribute('data-email'));
                        if (dataEmail) {
                            log.info(`📧 Extracted email from data-email (${selector}): ${dataEmail}`);
                            return dataEmail.trim();
                        }
                        
                        // Try text content as last resort
                        const textContent = await element.evaluate(el => el.textContent?.trim());
                        if (textContent && this.isValidEmail(textContent)) {
                            log.info(`📧 Extracted email from text content (${selector}): ${textContent}`);
                            return textContent;
                        }
                    }
                } catch (error) {
                    // Continue to next selector if current one fails
                    continue;
                }
            }
            
            log.info('📧 No email found on gelbeseiten.de detail page');
            return undefined;
            
        } catch (error) {
            log.error('❌ Error extracting email from gelbeseiten.de detail page:', error);
            return undefined;
        }
    }
    
    /**
     * Validate email format
     */
    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.trim());
    }

}
