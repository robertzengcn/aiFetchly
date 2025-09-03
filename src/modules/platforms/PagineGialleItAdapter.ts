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
                'button.iubenda-cs-accept-btn'
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

}
