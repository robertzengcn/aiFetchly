import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { IBasePlatformAdapter } from '@/modules/interface/IBasePlatformAdapter';
import { Page } from 'puppeteer';

/**
 * Example class-based platform adapter for complex platforms that require custom logic.
 * This demonstrates how to implement a platform adapter with custom business logic
 * that goes beyond simple configuration-based extraction.
 * 
 * @example
 * ```typescript
 * const config: PlatformConfig = {
 *   id: "complex-yellow-pages",
 *   type: "class",
 *   class_name: "ExampleClassBasedAdapter",
 *   module_path: "./platforms/ExampleClassBasedAdapter",
 *   // ... other config
 * };
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class ExampleClassBasedAdapter implements IBasePlatformAdapter {
    readonly config: PlatformConfig;
    
    constructor(config: PlatformConfig) {
        this.config = config;
    }
    
    get platformName(): string { return this.config.name; }
    get baseUrl(): string { return this.config.base_url; }
    get version(): string { return this.config.version; }
    
    /**
     * Custom search implementation with advanced logic
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<any[]> {
        // Custom search logic that might involve:
        // - Multiple search endpoints
        // - Advanced query building
        // - Search result filtering
        // - Pagination handling
        
        const searchResults: any[] = [];
        
        // Example: Search across multiple categories
        for (const keyword of keywords) {
            const categoryResults = await this.searchByCategory(keyword, location);
            searchResults.push(...categoryResults);
        }
        
        // Custom filtering logic
        return this.filterAndRankResults(searchResults);
    }
    
    /**
     * Custom data extraction with advanced parsing
     */
    async extractBusinessData(page: Page): Promise<any> {
        // Custom extraction logic that might involve:
        // - Complex DOM traversal
        // - Data cleaning and normalization
        // - Multi-step extraction process
        // - Error handling and fallbacks
        
        const businessData: any = {};
        
        try {
            // Step 1: Extract basic information
            businessData.basic = await this.extractBasicInfo(page);
            
            // Step 2: Extract contact information
            businessData.contact = await this.extractContactInfo(page);
            
            // Step 3: Extract address information
            businessData.address = await this.extractAddressInfo(page);
            
            // Step 4: Extract business details
            businessData.details = await this.extractBusinessDetails(page);
            
            // Step 5: Extract reviews and ratings
            businessData.reviews = await this.extractReviewInfo(page);
            
            // Step 6: Clean and validate data
            return this.cleanAndValidateData(businessData);
            
        } catch (error) {
            console.error('Error extracting business data:', error);
            return this.getFallbackData(page);
        }
    }
    
    /**
     * Custom pagination handling
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        // Custom pagination logic that might involve:
        // - Multiple pagination strategies
        // - AJAX-based pagination
        // - Infinite scroll handling
        // - Rate limiting between pages
        
        let currentPage = 1;
        
        while (currentPage <= maxPages) {
            // Wait for content to load
            await page.waitForSelector(this.config.selectors?.businessList || '.business-item', { timeout: 10000 });
            
            // Check if there's a next page
            const hasNextPage = await this.checkForNextPage(page);
            if (!hasNextPage) {
                break;
            }
            
            // Custom delay between pages
            await this.delayWithJitter(2000, 500);
            
            // Click next page
            await this.clickNextPage(page);
            
            currentPage++;
        }
    }
    
    /**
     * Custom cookie application
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        // Custom cookie handling that might involve:
        // - Cookie validation
        // - Session management
        // - Cookie rotation
        // - Authentication state
        
        if (!cookies || cookies.length === 0) {
            return;
        }
        
        // Validate cookies before applying
        const validCookies = this.validateCookies(cookies);
        
        // Apply cookies with custom logic
        for (const cookie of validCookies) {
            await page.setCookie(cookie);
        }
        
        // Verify authentication state
        await this.verifyAuthentication(page);
    }
    
    getSelectors(): any {
        return this.config.selectors || {};
    }
    
    getRateLimitingConfig(): any {
        return {
            requestsPerHour: this.config.rate_limit || 50, // More conservative for complex platforms
            delayBetweenRequests: this.config.delay_between_requests || 3000,
            maxConcurrentRequests: this.config.max_concurrent_requests || 1,
            useExponentialBackoff: true,
            maxRetries: 3
        };
    }
    
    getAuthenticationConfig(): any {
        return {
            requiresAuthentication: this.config.settings?.requiresAuthentication || true,
            supportsCookies: this.config.settings?.supportsCookies || true,
            supportsProxy: this.config.settings?.supportsProxy || true,
            loginUrl: `${this.config.base_url}/login`,
            logoutUrl: `${this.config.base_url}/logout`,
            sessionTimeout: 30 // minutes
        };
    }
    
    supportsAuthentication(): boolean {
        return this.config.settings?.requiresAuthentication || true;
    }
    
    supportsProxy(): boolean {
        return this.config.settings?.supportsProxy || true;
    }
    
    supportsCookies(): boolean {
        return this.config.settings?.supportsCookies || true;
    }
    
    getSupportedFeatures(): string[] {
        return this.config.settings?.supportedFeatures || [
            'search', 'pagination', 'authentication', 'reviews', 'ratings'
        ];
    }
    
    buildSearchUrl(keywords: string[], location: string, pageNum: number): string {
        // Custom URL building logic
        const baseUrl = this.config.base_url;
        const encodedKeywords = encodeURIComponent(keywords.join(' '));
        const encodedLocation = encodeURIComponent(location);
        
        return `${baseUrl}/search?q=${encodedKeywords}&loc=${encodedLocation}&page=${pageNum}`;
    }
    
    validateConfig(): any {
        const errors: string[] = [];
        const warnings: string[] = [];
        let score = 100;
        
        // Custom validation logic
        if (!this.config.selectors?.businessList) {
            errors.push('Business list selector is required');
            score -= 20;
        }
        
        if (!this.config.settings?.requiresAuthentication) {
            warnings.push('Authentication is recommended for this platform');
            score -= 5;
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            score
        };
    }
    
    // Custom helper methods
    
    private async searchByCategory(keyword: string, location: string): Promise<any[]> {
        // Custom category-based search logic
        return [];
    }
    
    private filterAndRankResults(results: any[]): any[] {
        // Custom filtering and ranking logic
        return results.filter(result => result.score > 0.5);
    }
    
    private async extractBasicInfo(page: Page): Promise<any> {
        // Custom basic info extraction
        return {};
    }
    
    private async extractContactInfo(page: Page): Promise<any> {
        // Custom contact info extraction
        return {};
    }
    
    private async extractAddressInfo(page: Page): Promise<any> {
        // Custom address extraction
        return {};
    }
    
    private async extractBusinessDetails(page: Page): Promise<any> {
        // Custom business details extraction
        return {};
    }
    
    private async extractReviewInfo(page: Page): Promise<any> {
        // Custom review extraction
        return {};
    }
    
    private cleanAndValidateData(data: any): any {
        // Custom data cleaning and validation
        return data;
    }
    
    private async getFallbackData(page: Page): Promise<any> {
        // Fallback data extraction when main extraction fails
        return {};
    }
    
    private async checkForNextPage(page: Page): Promise<boolean> {
        // Custom next page detection
        return false;
    }
    
    private async delayWithJitter(baseDelay: number, jitter: number): Promise<void> {
        const delay = baseDelay + Math.random() * jitter;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    private async clickNextPage(page: Page): Promise<void> {
        // Custom next page clicking logic
    }
    
    private validateCookies(cookies: any[]): any[] {
        // Custom cookie validation
        return cookies.filter(cookie => cookie.name && cookie.value);
    }
    
    private async verifyAuthentication(page: Page): Promise<void> {
        // Custom authentication verification
    }
} 