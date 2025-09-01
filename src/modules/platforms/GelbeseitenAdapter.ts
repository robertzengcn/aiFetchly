import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { SearchResult } from '@/interfaces/IBasePlatformAdapter';
import { BusinessData, Address, BusinessHours, Rating } from '@/interfaces/IDataExtractor';

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
        console.log('Handling page load for gelbeseiten.de');
        
        // Wait for page to fully load first
        await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
            console.log('Page load timeout reached, continuing...');
        });

        // Handle cookie consent with shadow root support - wait a bit for dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try multiple times to handle dynamically created shadow roots
        let shadowRootCookieResult = false;
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries && !shadowRootCookieResult; attempt++) {
            try {
                console.log(`Attempting to find cookie button in shadow root (attempt ${attempt}/${maxRetries})`);
                
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
                        console.log('Found primary cookie button #cmpbntyestxt in shadow root');
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
                                console.log(`Found cookie button in shadow root with selector: ${selector}`);
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
                    console.log(`Successfully clicked cookie button in shadow root on attempt ${attempt}`);
                    break;
                } else if (attempt < maxRetries) {
                    console.log(`Cookie button not found on attempt ${attempt}, waiting before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.log(`Error handling shadow root cookie consent on attempt ${attempt}:`, error);
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
                        console.log(`Found cookie button on gelbeseiten.de using selector: ${selector}`);
                        await cookieButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.log('Accepted cookies on gelbeseiten.de');
                        break;
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }
        } catch (error) {
            console.log('No cookie consent dialog found or already handled');
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
                        console.log('Accepted location on gelbeseiten.de');
                        break;
                    }
                } catch (error) {
                    // Continue to next selector
                }
            }
        } catch (error) {
            console.log('No location popup found or already handled');
        }

        // Wait for page to fully load
        await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
            console.log('Page load timeout reached, continuing...');
        });
    }

    /**
     * Extract email from detail page using Gelbeseiten-specific logic
     * Handles complex patterns like data-link attributes containing mailto links
     */
    async extractEmailFromDetailPage(page: Page): Promise<string | undefined> {
        try {
            console.log('🔍 Attempting to extract email using Gelbeseiten-specific method');
            
            // Method 1: Look for email in data-link attributes (most common pattern)
            const emailFromDataLink = await page.evaluate(() => {
                // Find elements with data-link containing mailto
                const elements = document.querySelectorAll('[data-link*="mailto:"]');
                
                for (const element of elements) {
                    const dataLink = element.getAttribute('data-link');
                    if (dataLink) {
                        // Extract email from mailto: link
                        const mailtoMatch = dataLink.match(/mailto:([^?&\s]+)/);
                        if (mailtoMatch && mailtoMatch[1]) {
                            console.log(`Found email in data-link: ${mailtoMatch[1]}`);
                            return mailtoMatch[1];
                        }
                    }
                }
                return null;
            });

            if (emailFromDataLink) {
                console.log(`📧 Extracted email from data-link: ${emailFromDataLink}`);
                return emailFromDataLink;
            }

            // Method 2: Look for email button containers with specific IDs/classes
            const emailFromButton = await page.evaluate(() => {
                // Common Gelbeseiten email button patterns
                const emailButtonSelectors = [
                    '#email_versenden',
                    '.email-button',
                    '[data-wipe-realview*="e-mail-button"]',
                    '[class*="email"]',
                    '[id*="email"]'
                ];

                for (const selector of emailButtonSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        // Check for data-link attribute
                        const dataLink = element.getAttribute('data-link');
                        if (dataLink && dataLink.includes('mailto:')) {
                            const mailtoMatch = dataLink.match(/mailto:([^?&\s]+)/);
                            if (mailtoMatch && mailtoMatch[1]) {
                                console.log(`Found email in button data-link: ${mailtoMatch[1]}`);
                                return mailtoMatch[1];
                            }
                        }

                        // Check for href attribute
                        const href = element.getAttribute('href');
                        if (href && href.includes('mailto:')) {
                            const mailtoMatch = href.match(/mailto:([^?&\s]+)/);
                            if (mailtoMatch && mailtoMatch[1]) {
                                console.log(`Found email in button href: ${mailtoMatch[1]}`);
                                return mailtoMatch[1];
                            }
                        }

                        // Check for onclick attribute
                        const onclick = element.getAttribute('onclick');
                        if (onclick && onclick.includes('mailto:')) {
                            const mailtoMatch = onclick.match(/mailto:([^?&\s]+)/);
                            if (mailtoMatch && mailtoMatch[1]) {
                                console.log(`Found email in onclick: ${mailtoMatch[1]}`);
                                return mailtoMatch[1];
                            }
                        }
                    }
                }
                return null;
            });

            if (emailFromButton) {
                console.log(`📧 Extracted email from button: ${emailFromButton}`);
                return emailFromButton;
            }

            // Method 3: Look for encoded or obfuscated emails in script tags
            const emailFromScript = await page.evaluate(() => {
                const scripts = document.querySelectorAll('script');
                
                for (const script of scripts) {
                    const scriptContent = script.textContent || script.innerHTML;
                    if (scriptContent) {
                        // Look for mailto patterns in JavaScript
                        const mailtoMatches = scriptContent.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
                        if (mailtoMatches && mailtoMatches.length > 0) {
                            const email = mailtoMatches[0].replace('mailto:', '');
                            console.log(`Found email in script: ${email}`);
                            return email;
                        }

                        // Look for email patterns in JavaScript variables
                        const emailMatches = scriptContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
                        if (emailMatches && emailMatches.length > 0) {
                            console.log(`Found email pattern in script: ${emailMatches[0]}`);
                            return emailMatches[0];
                        }
                    }
                }
                return null;
            });

            if (emailFromScript) {
                console.log(`📧 Extracted email from script: ${emailFromScript}`);
                return emailFromScript;
            }

            // Method 4: Look for hidden form fields or data attributes
            const emailFromHiddenFields = await page.evaluate(() => {
                // Check for hidden inputs with email values
                const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
                
                for (const input of hiddenInputs) {
                    const value = input.getAttribute('value') || '';
                    const name = input.getAttribute('name') || '';
                    
                    if (name.toLowerCase().includes('email') || value.includes('@')) {
                        const emailMatch = value.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                        if (emailMatch) {
                            console.log(`Found email in hidden field: ${emailMatch[0]}`);
                            return emailMatch[0];
                        }
                    }
                }

                // Check for data attributes containing emails
                const allElements = document.querySelectorAll('*');
                for (const element of allElements) {
                    const attributes = element.attributes;
                    for (let i = 0; i < attributes.length; i++) {
                        const attr = attributes[i];
                        if (attr.name.toLowerCase().includes('email') || attr.value.includes('@')) {
                            const emailMatch = attr.value.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                            if (emailMatch) {
                                console.log(`Found email in data attribute: ${emailMatch[0]}`);
                                return emailMatch[0];
                            }
                        }
                    }
                }

                return null;
            });

            if (emailFromHiddenFields) {
                console.log(`📧 Extracted email from hidden fields: ${emailFromHiddenFields}`);
                return emailFromHiddenFields;
            }

            console.log('❌ No email found using Gelbeseiten-specific extraction methods');
            return undefined;

        } catch (error) {
            console.error('Error in Gelbeseiten email extraction:', error);
            return undefined;
        }
    }

}
