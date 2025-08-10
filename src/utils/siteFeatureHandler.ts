import { Page } from 'puppeteer';

/**
 * Site-specific feature handling utilities
 * Handles common patterns like cookie banners, popups, language selectors, etc.
 */
export class SiteFeatureHandler {
    
    /**
     * Handle cookie consent banners
     * Supports multiple banner formats and platforms
     */
    static async handleCookieBanner(page: Page, platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common cookie banner selectors
            const bannerSelectors = [
                '.cookie-banner',
                '.gdpr-banner',
                '#cookieConsentBanner',
                '[data-testid="cookie-banner"]',
                '.privacy-notice',
                '.cookie-notice',
                '.cookie-policy',
                '.consent-banner'
            ];

            // Common accept button selectors
            const acceptButtonSelectors = [
                '.cookie-banner .accept',
                '.gdpr-banner .accept',
                '#cookieConsentBanner .accept',
                '[data-testid="cookie-banner"] .accept',
                '.privacy-notice .accept',
                '.cookie-notice .accept',
                '.cookie-policy .accept',
                '.consent-banner .accept',
                'button[data-testid="accept-cookies"]',
                'button:contains("Accept")',
                'button:contains("Agree")',
                'button:contains("OK")',
                'button:contains("Continue")'
            ];

            // Try to find and handle cookie banner
            for (const bannerSelector of bannerSelectors) {
                const banner = await page.$(bannerSelector);
                if (banner) {
                    console.log(`Found cookie banner on ${platform} using selector: ${bannerSelector}`);
                    
                    // Try to find accept button
                    for (const buttonSelector of acceptButtonSelectors) {
                        const acceptButton = await page.$(buttonSelector);
                        if (acceptButton) {
                            await acceptButton.click();
                            console.log(`Accepted cookie banner on ${platform}`);
                            return true;
                        }
                    }
                }
            }

            return false;
        } catch (error) {
            console.log(`Error handling cookie banner on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Handle popup modals and overlays
     * Supports various popup formats
     */
    static async handlePopup(page: Page, platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common popup selectors
            const popupSelectors = [
                '.modal',
                '.popup',
                '.overlay',
                '[data-testid="modal"]',
                '.dialog',
                '.lightbox',
                '.modal-overlay',
                '.popup-overlay'
            ];

            // Common close button selectors
            const closeButtonSelectors = [
                '.modal .close',
                '.popup .close',
                '.overlay .close',
                '[data-testid="modal"] .close',
                '.dialog .close',
                '.lightbox .close',
                '.modal-overlay .close',
                '.popup-overlay .close',
                'button[data-testid="close-modal"]',
                'button:contains("Close")',
                'button:contains("X")',
                'button:contains("×")',
                '.close-button',
                '.dismiss-button'
            ];

            // Try to find and handle popup
            for (const popupSelector of popupSelectors) {
                const popup = await page.$(popupSelector);
                if (popup) {
                    console.log(`Found popup on ${platform} using selector: ${popupSelector}`);
                    
                    // Try to find close button
                    for (const buttonSelector of closeButtonSelectors) {
                        const closeButton = await page.$(buttonSelector);
                        if (closeButton) {
                            await closeButton.click();
                            console.log(`Closed popup on ${platform}`);
                            return true;
                        }
                    }
                }
            }

            return false;
        } catch (error) {
            console.log(`Error handling popup on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Handle language selection
     * Useful for sites that support multiple languages
     */
    static async handleLanguageSelector(page: Page, preferredLanguage: string = 'en', platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common language selector patterns
            const languageSelectors = [
                '.language-selector',
                '.lang-switch',
                '.language-toggle',
                '[data-testid="language-selector"]',
                '.locale-selector',
                '.language-dropdown'
            ];

            // Language option patterns
            const languageOptionSelectors = [
                `.language-selector .${preferredLanguage}`,
                `.lang-switch .${preferredLanguage}`,
                `.language-toggle .${preferredLanguage}`,
                `[data-testid="language-selector"] .${preferredLanguage}`,
                `.locale-selector .${preferredLanguage}`,
                `.language-dropdown .${preferredLanguage}`,
                `a[href*="lang=${preferredLanguage}"]`,
                `a[href*="locale=${preferredLanguage}"]`
            ];

            // Try to find language selector
            for (const selector of languageSelectors) {
                const languageSelector = await page.$(selector);
                if (languageSelector) {
                    console.log(`Found language selector on ${platform} using selector: ${selector}`);
                    
                    // Try to find and click preferred language option
                    for (const optionSelector of languageOptionSelectors) {
                        const languageOption = await page.$(optionSelector);
                        if (languageOption) {
                            await languageOption.click();
                            console.log(`Selected ${preferredLanguage} language on ${platform}`);
                            return true;
                        }
                    }
                }
            }

            return false;
        } catch (error) {
            console.log(`Error handling language selector on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Handle location permission prompts
     * Common on sites that request location access
     */
    static async handleLocationPrompt(page: Page, platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common location prompt selectors
            const locationPromptSelectors = [
                '[data-testid="location-prompt"]',
                '.location-prompt',
                '.location-permission',
                '.geo-permission',
                '.location-request'
            ];

            // Common dismiss/deny button selectors
            const dismissButtonSelectors = [
                '[data-testid="location-prompt"] button',
                '.location-prompt .dismiss',
                '.location-permission .deny',
                '.geo-permission .dismiss',
                '.location-request .cancel',
                'button:contains("Not now")',
                'button:contains("Skip")',
                'button:contains("Dismiss")',
                'button:contains("Cancel")'
            ];

            // Try to find and handle location prompt
            for (const promptSelector of locationPromptSelectors) {
                const locationPrompt = await page.$(promptSelector);
                if (locationPrompt) {
                    console.log(`Found location prompt on ${platform} using selector: ${promptSelector}`);
                    
                    // Try to find dismiss button
                    for (const buttonSelector of dismissButtonSelectors) {
                        const dismissButton = await page.$(buttonSelector);
                        if (dismissButton) {
                            await dismissButton.click();
                            console.log(`Dismissed location prompt on ${platform}`);
                            return true;
                        }
                    }
                }
            }

            return false;
        } catch (error) {
            console.log(`Error handling location prompt on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Handle newsletter subscription prompts
     * Common on many business directory sites
     */
    static async handleNewsletterPrompt(page: Page, platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common newsletter prompt selectors
            const newsletterSelectors = [
                '.newsletter-signup',
                '.email-signup',
                '.subscription-prompt',
                '[data-testid="newsletter-modal"]',
                '.email-capture',
                '.signup-modal'
            ];

            // Common close/dismiss button selectors
            const closeButtonSelectors = [
                '.newsletter-signup .close',
                '.email-signup .dismiss',
                '.subscription-prompt .skip',
                '[data-testid="newsletter-modal"] .close',
                '.email-capture .cancel',
                '.signup-modal .dismiss',
                'button:contains("No thanks")',
                'button:contains("Skip")',
                'button:contains("Close")',
                'button:contains("Not now")'
            ];

            // Try to find and handle newsletter prompt
            for (const selector of newsletterSelectors) {
                const newsletterPrompt = await page.$(selector);
                if (newsletterPrompt) {
                    console.log(`Found newsletter prompt on ${platform} using selector: ${selector}`);
                    
                    // Try to find close button
                    for (const buttonSelector of closeButtonSelectors) {
                        const closeButton = await page.$(buttonSelector);
                        if (closeButton) {
                            await closeButton.click();
                            console.log(`Closed newsletter prompt on ${platform}`);
                            return true;
                        }
                    }
                }
            }

            return false;
        } catch (error) {
            console.log(`Error handling newsletter prompt on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Handle all common site-specific features
     * Runs all handlers in sequence
     */
    static async handleAllSiteFeatures(
        page: Page, 
        platform: string = 'unknown',
        options: {
            handleCookies?: boolean;
            handlePopups?: boolean;
            handleLanguage?: boolean;
            handleLocation?: boolean;
            handleNewsletter?: boolean;
            preferredLanguage?: string;
        } = {}
    ): Promise<void> {
        const {
            handleCookies = true,
            handlePopups = true,
            handleLanguage = true,
            handleLocation = true,
            handleNewsletter = true,
            preferredLanguage = 'en'
        } = options;

        try {
            // Wait for page to load
            await page.waitForSelector('body', { timeout: 10000 });

            // Handle features in order of priority
            if (handleCookies) {
                await this.handleCookieBanner(page, platform);
            }

            if (handlePopups) {
                await this.handlePopup(page, platform);
            }

            if (handleLocation) {
                await this.handleLocationPrompt(page, platform);
            }

            if (handleLanguage) {
                await this.handleLanguageSelector(page, preferredLanguage, platform);
            }

            if (handleNewsletter) {
                await this.handleNewsletterPrompt(page, platform);
            }

        } catch (error) {
            console.log(`Error handling site features on ${platform}:`, error);
        }
    }

    /**
     * Wait for page to be ready for interaction
     * Ensures all dynamic content has loaded
     */
    static async waitForPageReady(page: Page, timeout: number = 10000): Promise<void> {
        try {
            await page.waitForFunction(
                () => document.readyState === 'complete',
                { timeout }
            );
        } catch (error) {
            console.log('Page ready state timeout, continuing anyway');
        }
    }
} 