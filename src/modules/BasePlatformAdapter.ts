import { Page } from 'puppeteer';
import { 
    IBasePlatformAdapter, 
    SearchResult, 
    RateLimitingConfig, 
    AuthenticationConfig,
    ValidationResult
} from '@/interfaces/IBasePlatformAdapter';
import { 
    PlatformConfig, 
    PlatformSelectors 
} from '@/interfaces/IPlatformConfig';
import { BusinessData } from '@/interfaces/IDataExtractor';

/**
 * Base platform adapter that provides default implementations for all platform types
 * This class serves as the foundation for configuration-only, class-based, and hybrid platforms
 * 
 * Note: All methods now have default implementations and are optional to override.
 * Subclasses can override any method to provide custom behavior, or use the defaults.
 */
export class BasePlatformAdapter implements IBasePlatformAdapter {
    protected _config: PlatformConfig;

    constructor(config: PlatformConfig) {
        this._config = config;
    }

    get config(): PlatformConfig {
        return this._config;
    }

    get platformName(): string {
        return this._config.name;
    }

    get baseUrl(): string {
        return this._config.base_url;
    }

    get version(): string {
        return this._config.version || '1.0.0';
    }

    /**
     * Search for businesses using keywords and location
     * Default implementation returns empty results - can be overridden by subclasses
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<SearchResult[]> {

        return [];
    }

    /**
     * Extract business data from a page
     * Default implementation uses selectors - can be overridden by subclasses
     */
    async extractBusinessData(page: Page): Promise<BusinessData> {
        return this.defaultExtractBusinessData(page);
    }

    /**
     * Handle pagination on the current page
     * Default implementation uses selectors - can be overridden by subclasses
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        return this.defaultHandlePagination(page, maxPages);
    }

    /**
     * Apply cookies to the page for authentication
     * Default implementation handles basic cookie application - can be overridden by subclasses
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        return this.defaultApplyCookies(page, cookies);
    }

    /**
     * Get platform selectors
     */
    getSelectors(): PlatformSelectors {
        return this._config.selectors || { businessList: '', businessName: '' };
    }

    /**
     * Get rate limiting configuration
     */
    getRateLimitingConfig(): RateLimitingConfig {
        return {
            requestsPerHour: this._config.rate_limit || 100,
            delayBetweenRequests: this._config.delay_between_requests || 2000,
            maxConcurrentRequests: this._config.max_concurrent_requests || 1,
            useExponentialBackoff: false, // Not in interface yet
            maxRetries: 3 // Not in interface yet
        };
    }

    /**
     * Get authentication configuration
     */
    getAuthenticationConfig(): AuthenticationConfig {
        return {
            requiresAuthentication: this._config.settings?.requiresAuthentication || false,
            supportsCookies: this._config.settings?.supportsCookies || true,
            supportsProxy: this._config.settings?.supportsProxy || true,
            loginUrl: undefined,
            logoutUrl: undefined,
            sessionTimeout: 30
        };
    }

    /**
     * Check if platform supports authentication
     */
    supportsAuthentication(): boolean {
        return this._config.settings?.requiresAuthentication || false;
    }

    /**
     * Check if platform supports proxy
     */
    supportsProxy(): boolean {
        return this._config.settings?.supportsProxy !== false;
    }

    /**
     * Check if platform supports cookies
     */
    supportsCookies(): boolean {
        return this._config.settings?.supportsCookies !== false;
    }

    /**
     * Get supported platform features
     */
    getSupportedFeatures(): string[] {
        return this._config.settings?.supportedFeatures || ['search', 'pagination'];
    }

    /**
     * Custom function called after page load (optional)
     * Default implementation does nothing - can be overridden by subclasses
     */
    async onPageLoad(page: Page): Promise<void> {
        // Default implementation - do nothing
        // Subclasses can override this for custom post-load logic
    }

    /**
     * Extract email from detail page using platform-specific logic
     * Default implementation returns undefined - can be overridden by subclasses
     * This method should handle complex email extraction patterns like data attributes
     */
    async extractEmailFromDetailPage(page: Page): Promise<string | undefined> {
        // Default implementation - no custom email extraction
        // Subclasses can override this for platform-specific email extraction
        return undefined;
    }

    /**
     * Extract phone number with reveal interaction for platforms that hide phone numbers behind click buttons
     * Default implementation returns undefined - can be overridden by subclasses
     * This method should handle phone reveal interactions like clicking "Afficher le N°" buttons
     */
    async extractPhoneNumberWithReveal(page: Page, businessElement: any): Promise<string | undefined> {
        // Default implementation - no custom phone extraction
        // Subclasses can override this for platform-specific phone reveal extraction
        return undefined;
    }

    /**
     * Extract website URL with reveal interaction for platforms that hide website URLs behind click buttons
     * Default implementation returns undefined - can be overridden by subclasses
     * This method should handle website reveal interactions like clicking encoded data attributes
     */
    async extractWebsiteWithReveal(page: Page, businessElement: any): Promise<string | undefined> {
        // Default implementation - no custom website extraction
        // Subclasses can override this for platform-specific website reveal extraction
        return undefined;
    }



    /**
     * Build search URL for the platform
     */
    buildSearchUrl(keywords: string[], location: string, pageNum: number = 1): string {
        const searchTerms = keywords.join(' ');
        const baseUrl = this._config.base_url;
        
        // Default URL pattern - can be overridden by subclasses
        if (this._config.settings?.searchUrlPattern) {
            return this._config.settings.searchUrlPattern
                .replace('{keywords}', encodeURIComponent(searchTerms))
                .replace('{location}', encodeURIComponent(location))
                .replace('{page}', pageNum.toString());
        }

        // Fallback to basic search pattern
        return `${baseUrl}/search?q=${encodeURIComponent(searchTerms)}&location=${encodeURIComponent(location)}&page=${pageNum}`;
    }

    /**
     * Validate platform configuration
     */
    validateConfig(): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        let score = 100;

        // Required fields validation
        if (!this._config.id) {
            errors.push('Platform ID is required');
            score -= 20;
        }

        if (!this._config.name) {
            errors.push('Platform name is required');
            score -= 20;
        }

        if (!this._config.base_url) {
            errors.push('Base URL is required');
            score -= 20;
        }

        if (!this._config.selectors) {
            errors.push('Selectors configuration is required');
            score -= 20;
        }

        // Optional field warnings
        if (!this._config.country) {
            warnings.push('Country not specified');
            score -= 5;
        }

        if (!this._config.language) {
            warnings.push('Language not specified');
            score -= 5;
        }

        if (this._config.rate_limit && this._config.rate_limit < 10) {
            warnings.push('Rate limit is very low (< 10 requests/hour)');
            score -= 10;
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            score: Math.max(0, score)
        };
    }

    /**
     * Default implementation for extracting business data using selectors
     * Can be used by configuration-only platforms
     */
    protected async defaultExtractBusinessData(page: Page): Promise<BusinessData> {
        const selectors = this.getSelectors();
        
        return await page.evaluate((sels) => {
            const businesses: any[] = [];
            const businessElements = document.querySelectorAll(sels.businessList);

            businessElements.forEach((element) => {
                const business: any = {};

                // Extract basic fields using selectors
                const nameElement = element.querySelector(sels.businessName);
                business.name = nameElement?.textContent?.trim() || null;

                const phoneElement = element.querySelector(sels.phone || '');
                business.phone = phoneElement?.textContent?.trim() || null;

                const emailElement = element.querySelector(sels.email || '');
                business.email = emailElement?.textContent?.trim() || emailElement?.getAttribute('href')?.replace('mailto:', '') || null;

                const websiteElement = element.querySelector(sels.website || '');
                business.websiteUrl = websiteElement?.getAttribute('href') || websiteElement?.textContent?.trim() || null;

                const addressElement = element.querySelector(sels.address || '');
                business.address = addressElement?.textContent?.trim() || null;

                const categoriesElement = element.querySelector(sels.categories || '');
                business.categories = categoriesElement?.textContent?.trim().split(',').map((cat: string) => cat.trim()) || [];

                const socialElement = element.querySelector(sels.socialMedia || '');
                business.socialMedia = socialElement?.textContent?.trim().split(',').map((link: string) => link.trim()) || [];

                businesses.push(business);
            });

            return {
                business_name: businesses.length > 0 ? businesses[0].name || '' : '',
                businesses,
                totalCount: businesses.length,
                currentPage: 1,
                hasNextPage: false
            };
        }, selectors);
    }

    /**
     * Default implementation for handling pagination using selectors
     */
    protected async defaultHandlePagination(page: Page, maxPages: number): Promise<void> {
        const selectors = this.getSelectors();
        
        if (!selectors.pagination || typeof selectors.pagination !== 'object' || !('nextButton' in selectors.pagination)) {
            console.log('No pagination selector configured');
            return;
        }

        const nextButton = await page.$(selectors.pagination.nextButton!);
        if (!nextButton) {
            console.log('No next page button found');
            return;
        }
        await nextButton.evaluate((btn) => {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            nextButton.click()
        ]);

        // Wait for new results to load
        await page.waitForSelector(selectors.businessList, { timeout: 10000 });
    }

    /**
     * Default implementation for applying cookies
     */
    protected async defaultApplyCookies(page: Page, cookies: any): Promise<void> {
        if (!cookies || !Array.isArray(cookies)) {
            console.log(`No cookies to apply for ${this.platformName}`);
            return;
        }

        try {
            const platformCookies = cookies.filter(cookie => 
                cookie.domain && cookie.domain.includes(new URL(this.baseUrl).hostname)
            );

            if (platformCookies.length > 0) {
                await page.setCookie(...platformCookies);
                console.log(`Applied ${platformCookies.length} cookies for ${this.platformName}`);
            }
        } catch (error) {
            console.error(`Error applying cookies for ${this.platformName}:`, error);
        }
    }
}