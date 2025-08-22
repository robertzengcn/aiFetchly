import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '../BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { BusinessData } from '@/interfaces/IDataExtractor';

/**
 * Example Platform Adapter
 * Demonstrates how to implement custom methods including the new onPageLoad method
 */
export class ExamplePlatformAdapter extends BasePlatformAdapter {
    constructor(config: PlatformConfig) {
        super(config);
    }

    /**
     * Custom implementation of searchBusinesses
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<any[]> {
        console.log('🔍 Example adapter: Custom search implementation');
        // Custom search logic here
        return [];
    }

    /**
     * Custom implementation of extractBusinessData
     */
    async extractBusinessData(page: Page): Promise<BusinessData> {
        console.log('📊 Example adapter: Custom data extraction');
        // Custom data extraction logic here
        return {
            business_name: 'Example Business'
        };
    }

    /**
     * Custom implementation of handlePagination
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        console.log('📄 Example adapter: Custom pagination handling');
        // Custom pagination logic here
    }

    /**
     * Custom implementation of applyCookies
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        console.log('🍪 Example adapter: Custom cookie handling');
        // Custom cookie logic here
    }

    /**
     * Custom implementation of onPageLoad
     * This method is called after each page is fully loaded
     */
    async onPageLoad(page: Page): Promise<void> {
        console.log('🔧 Example adapter: Custom onPageLoad method called');
        
        try {
            // Example: Wait for dynamic content to load
            console.log('⏳ Waiting for dynamic content to load...');
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));
            
            // Example: Handle any overlays or popups
            console.log('🔍 Checking for overlays or popups...');
            const overlaySelectors = [
                '.popup-overlay',
                '.modal',
                '.cookie-banner',
                '.newsletter-signup'
            ];
            
            for (const selector of overlaySelectors) {
                try {
                    const overlay = await page.$(selector);
                    if (overlay) {
                        console.log(`🚫 Found overlay: ${selector}, attempting to close...`);
                        
                        // Try to find and click close button
                        const closeButton = await page.$(`${selector} .close, ${selector} .close-btn, ${selector} [data-dismiss]`);
                        if (closeButton) {
                            await closeButton.click();
                            console.log(`✅ Closed overlay: ${selector}`);
                            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
                        }
                    }
                } catch (error) {
                    // Ignore errors for individual overlay handling
                }
            }
            
            // Example: Wait for specific elements that indicate the page is ready
            console.log('⏳ Waiting for page to be fully ready...');
            await page.waitForFunction(() => {
                // Check if the page has finished loading dynamic content
                return document.readyState === 'complete' && 
                       !document.querySelector('.loading, .spinner, .progress-bar');
            }, { timeout: 10000 });
            
            // Example: Scroll to trigger lazy loading
            console.log('📜 Scrolling to trigger lazy loading...');
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight / 2);
            });
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));
            
            console.log('✅ Example adapter: onPageLoad method completed successfully');
            
        } catch (error) {
            console.warn('⚠️ Example adapter: Error in onPageLoad method:', error);
            // Don't throw error - this method should not fail the scraping process
        }
    }
}
