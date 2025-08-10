import { Page } from 'puppeteer';

/**
 * Pagination handling utilities for different platforms
 * Supports various pagination patterns commonly found in yellow pages and business directories
 */
export class PaginationHandler {
    
    /**
     * Find and click next page button
     * Supports multiple pagination patterns
     */
    static async goToNextPage(page: Page, platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common next page button selectors
            const nextPageSelectors = [
                // Standard pagination
                '.pagination .next',
                '.pagination .next-page',
                '.pagination a[rel="next"]',
                '.pagination .page-next',
                '.pagination .next-button',
                
                // Alternative pagination patterns
                '.pager .next',
                '.pager .next-page',
                '.pager a[rel="next"]',
                '.pager .page-next',
                '.pager .next-button',
                
                // Navigation patterns
                '.nav .next',
                '.navigation .next',
                '.nav-pagination .next',
                '.page-nav .next',
                
                // Button patterns
                'button[data-testid="next-page"]',
                'button[data-testid="pagination-next"]',
                'a[data-testid="next-page"]',
                'a[data-testid="pagination-next"]',
                
                // Text-based patterns
                'a:contains("Next")',
                'button:contains("Next")',
                'a:contains("Next Page")',
                'button:contains("Next Page")',
                'a:contains(">")',
                'button:contains(">")',
                'a:contains("→")',
                'button:contains("→")',
                
                // Arrow patterns
                '.arrow.next',
                '.arrow-right',
                '.next-arrow',
                '.pagination-arrow.next',
                
                // Number-based patterns
                '.pagination a[href*="page="]',
                '.pager a[href*="page="]',
                '.pagination a[href*="p="]',
                '.pager a[href*="p="]'
            ];

            // Try each selector
            for (const selector of nextPageSelectors) {
                try {
                    const nextButton = await page.$(selector);
                    if (nextButton) {
                        // Check if button is enabled/clickable
                        const isDisabled = await page.evaluate((el) => {
                            return el.hasAttribute('disabled') || 
                                   el.classList.contains('disabled') ||
                                   el.classList.contains('inactive') ||
                                   (el as HTMLElement).style.pointerEvents === 'none';
                        }, nextButton);

                        if (!isDisabled) {
                            await nextButton.click();
                            console.log(`Clicked next page on ${platform} using selector: ${selector}`);
                            
                            // Wait for page to load
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            return true;
                        }
                    }
                } catch (error) {
                    // Continue to next selector
                    continue;
                }
            }

            console.log(`No next page button found on ${platform}`);
            return false;
        } catch (error) {
            console.log(`Error navigating to next page on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Check if there are more pages available
     */
    static async hasNextPage(page: Page, platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common indicators for next page availability
            const nextPageIndicators = [
                '.pagination .next:not(.disabled)',
                '.pagination .next:not(.inactive)',
                '.pager .next:not(.disabled)',
                '.pager .next:not(.inactive)',
                '.nav .next:not(.disabled)',
                '.navigation .next:not(.disabled)',
                'button[data-testid="next-page"]:not([disabled])',
                'a[data-testid="next-page"]:not(.disabled)',
                'a:contains("Next"):not(.disabled)',
                'button:contains("Next"):not([disabled])'
            ];

            for (const selector of nextPageIndicators) {
                const nextButton = await page.$(selector);
                if (nextButton) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.log(`Error checking for next page on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Get current page number
     */
    static async getCurrentPage(page: Page, platform: string = 'unknown'): Promise<number> {
        try {
            // Common current page indicators
            const currentPageSelectors = [
                '.pagination .current',
                '.pagination .active',
                '.pager .current',
                '.pager .active',
                '.nav .current',
                '.navigation .current',
                '[data-testid="current-page"]',
                '.page-number.current',
                '.page-number.active'
            ];

            for (const selector of currentPageSelectors) {
                const currentPageElement = await page.$(selector);
                if (currentPageElement) {
                    const pageText = await page.evaluate(el => el.textContent, currentPageElement);
                    const pageNumber = parseInt(pageText?.trim() || '1');
                    if (!isNaN(pageNumber)) {
                        return pageNumber;
                    }
                }
            }

            // Fallback: try to extract from URL
            const url = page.url();
            const pageMatch = url.match(/[?&]page=(\d+)/) || url.match(/[?&]p=(\d+)/);
            if (pageMatch) {
                return parseInt(pageMatch[1]);
            }

            return 1; // Default to page 1
        } catch (error) {
            console.log(`Error getting current page on ${platform}:`, error);
            return 1;
        }
    }

    /**
     * Get total number of pages (if available)
     */
    static async getTotalPages(page: Page, platform: string = 'unknown'): Promise<number | null> {
        try {
            // Common total page indicators
            const totalPageSelectors = [
                '.pagination .total',
                '.pager .total',
                '.nav .total',
                '[data-testid="total-pages"]',
                '.page-info .total',
                '.pagination-info .total'
            ];

            for (const selector of totalPageSelectors) {
                const totalElement = await page.$(selector);
                if (totalElement) {
                    const totalText = await page.evaluate(el => el.textContent, totalElement);
                    const totalMatch = totalText?.match(/(\d+)/);
                    if (totalMatch) {
                        return parseInt(totalMatch[1]);
                    }
                }
            }

            // Try to extract from pagination text
            const paginationText = await page.evaluate(() => {
                const pagination = document.querySelector('.pagination, .pager, .nav');
                return pagination?.textContent || '';
            });

            const totalMatch = paginationText.match(/of\s+(\d+)/i) || paginationText.match(/page\s+\d+\s+of\s+(\d+)/i);
            if (totalMatch) {
                return parseInt(totalMatch[1]);
            }

            return null;
        } catch (error) {
            console.log(`Error getting total pages on ${platform}:`, error);
            return null;
        }
    }

    /**
     * Navigate to a specific page number
     */
    static async goToPage(page: Page, pageNumber: number, platform: string = 'unknown'): Promise<boolean> {
        try {
            // Common page number link patterns
            const pageLinkSelectors = [
                `.pagination a[href*="page=${pageNumber}"]`,
                `.pager a[href*="page=${pageNumber}"]`,
                `.nav a[href*="page=${pageNumber}"]`,
                `.pagination a[href*="p=${pageNumber}"]`,
                `.pager a[href*="p=${pageNumber}"]`,
                `.nav a[href*="p=${pageNumber}"]`,
                `a[data-testid="page-${pageNumber}"]`,
                `button[data-testid="page-${pageNumber}"]`
            ];

            for (const selector of pageLinkSelectors) {
                const pageLink = await page.$(selector);
                if (pageLink) {
                    await pageLink.click();
                    console.log(`Navigated to page ${pageNumber} on ${platform}`);
                    
                    // Wait for page to load
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return true;
                }
            }

            // Try direct URL manipulation
            const currentUrl = page.url();
            const newUrl = currentUrl.replace(/[?&](page|p)=\d+/, `$1=${pageNumber}`);
            if (newUrl !== currentUrl) {
                await page.goto(newUrl);
                console.log(`Navigated to page ${pageNumber} on ${platform} via URL`);
                return true;
            }

            return false;
        } catch (error) {
            console.log(`Error navigating to page ${pageNumber} on ${platform}:`, error);
            return false;
        }
    }

    /**
     * Wait for pagination to be ready
     */
    static async waitForPagination(page: Page, timeout: number = 10000): Promise<void> {
        try {
            await page.waitForSelector('.pagination, .pager, .nav', { timeout });
        } catch (error) {
            console.log('Pagination not found, continuing anyway');
        }
    }

    /**
     * Get pagination information
     */
    static async getPaginationInfo(page: Page, platform: string = 'unknown'): Promise<{
        currentPage: number;
        totalPages: number | null;
        hasNext: boolean;
        hasPrevious: boolean;
    }> {
        const currentPage = await this.getCurrentPage(page, platform);
        const totalPages = await this.getTotalPages(page, platform);
        const hasNext = await this.hasNextPage(page, platform);
        const hasPrevious = currentPage > 1;

        return {
            currentPage,
            totalPages,
            hasNext,
            hasPrevious
        };
    }
} 