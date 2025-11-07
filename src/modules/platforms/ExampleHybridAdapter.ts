import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { IBasePlatformAdapter } from '@/modules/interface/IBasePlatformAdapter';
import { Page } from 'puppeteer';

/**
 * Example hybrid platform adapter that combines configuration-based extraction
 * with custom logic for specific data fields.
 * 
 * This demonstrates the hybrid approach where:
 * - Basic data extraction uses configuration selectors
 * - Complex data extraction uses custom functions
 * - Custom logic can override configuration-based extraction
 * 
 * @example
 * ```typescript
 * const config: PlatformConfig = {
 *   id: "hybrid-yellow-pages",
 *   type: "hybrid",
 *   class_name: "ExampleHybridAdapter",
 *   module_path: "./platforms/ExampleHybridAdapter",
 *   custom_extractors: {
 *     extractBusinessHours: "customBusinessHoursExtractor",
 *     extractRating: "customRatingExtractor"
 *   },
 *   // ... other config
 * };
 * ```
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class ExampleHybridAdapter implements IBasePlatformAdapter {
    readonly config: PlatformConfig;
    
    constructor(config: PlatformConfig) {
        this.config = config;
    }
    
    get platformName(): string { return this.config.name; }
    get baseUrl(): string { return this.config.base_url; }
    get version(): string { return this.config.version; }
    
    /**
     * Hybrid search implementation - uses configuration with custom enhancements
     */
    async searchBusinesses(page: Page, keywords: string[], location: string): Promise<any[]> {
        // Use configuration-based search as base
        const baseResults = await this.configurationBasedSearch(keywords, location);
        
        // Apply custom filtering and enhancement
        return this.enhanceSearchResults(baseResults);
    }
    
    /**
     * Hybrid data extraction - combines configuration and custom logic
     */
    async extractBusinessData(page: Page): Promise<any> {
        const businessData: any = {};
        
        try {
            // Step 1: Use configuration-based extraction for basic fields
            businessData.basic = await this.extractBasicDataFromConfig(page);
            
            // Step 2: Apply custom extractors for complex fields
            if (this.config.custom_extractors) {
                const customData = await this.applyCustomExtractors(page);
                Object.assign(businessData, customData);
            }
            
            // Step 3: Apply custom post-processing
            return this.postProcessData(businessData);
            
        } catch (error) {
            console.error('Error in hybrid data extraction:', error);
            return this.getFallbackData(page);
        }
    }
    
    /**
     * Hybrid pagination - uses configuration with custom logic
     */
    async handlePagination(page: Page, maxPages: number): Promise<void> {
        // Use configuration-based pagination as base
        await this.configurationBasedPagination(page, maxPages);
        
        // Apply custom pagination enhancements
        await this.applyCustomPaginationLogic(page);
    }
    
    /**
     * Hybrid cookie application - uses configuration with custom validation
     */
    async applyCookies(page: Page, cookies: any): Promise<void> {
        // Use configuration-based cookie application
        await this.configurationBasedCookieApplication(page, cookies);
        
        // Apply custom cookie validation and enhancement
        await this.applyCustomCookieLogic(page, cookies);
    }
    
    getSelectors(): any {
        return this.config.selectors || {};
    }
    
    getRateLimitingConfig(): any {
        return {
            requestsPerHour: this.config.rate_limit || 75, // Balanced for hybrid approach
            delayBetweenRequests: this.config.delay_between_requests || 2500,
            maxConcurrentRequests: this.config.max_concurrent_requests || 1,
            useExponentialBackoff: true,
            maxRetries: 2
        };
    }
    
    getAuthenticationConfig(): any {
        return {
            requiresAuthentication: this.config.settings?.requiresAuthentication || false,
            supportsCookies: this.config.settings?.supportsCookies || true,
            supportsProxy: this.config.settings?.supportsProxy || true,
            loginUrl: `${this.config.base_url}/login`,
            logoutUrl: `${this.config.base_url}/logout`,
            sessionTimeout: 20 // minutes
        };
    }
    
    supportsAuthentication(): boolean {
        return this.config.settings?.requiresAuthentication || false;
    }
    
    supportsProxy(): boolean {
        return this.config.settings?.supportsProxy || true;
    }
    
    supportsCookies(): boolean {
        return this.config.settings?.supportsCookies || true;
    }
    
    getSupportedFeatures(): string[] {
        return this.config.settings?.supportedFeatures || [
            'search', 'pagination', 'custom_extractors', 'enhanced_data'
        ];
    }
    
    buildSearchUrl(keywords: string[], location: string, pageNum: number): string {
        // Use configuration-based URL building with custom enhancements
        const baseUrl = this.config.settings?.searchUrlPattern || 
            `${this.config.base_url}/search?q={keywords}&location={location}&page={page}`;
        
        let url = baseUrl
            .replace('{keywords}', encodeURIComponent(keywords.join(' ')))
            .replace('{location}', encodeURIComponent(location))
            .replace('{page}', pageNum.toString());
        
        // Apply custom URL enhancements
        url = this.enhanceSearchUrl(url, keywords, location);
        
        return url;
    }
    
    validateConfig(): any {
        const errors: string[] = [];
        const warnings: string[] = [];
        let score = 100;
        
        // Validate configuration-based requirements
        if (!this.config.selectors?.businessList) {
            errors.push('Business list selector is required');
            score -= 20;
        }
        
        // Validate custom extractors
        if (this.config.custom_extractors) {
            for (const [extractorName, functionName] of Object.entries(this.config.custom_extractors)) {
                if (!functionName) {
                    errors.push(`Custom extractor ${extractorName} has no function name`);
                    score -= 10;
                }
            }
        }
        
        // Hybrid-specific warnings
        if (!this.config.custom_extractors || Object.keys(this.config.custom_extractors).length === 0) {
            warnings.push('No custom extractors defined - consider adding custom logic for complex fields');
            score -= 5;
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            score
        };
    }
    
    // Configuration-based methods (base implementation)
    
    private async configurationBasedSearch(keywords: string[], location: string): Promise<any[]> {
        // Basic configuration-based search implementation
        return [];
    }
    
    private async extractBasicDataFromConfig(page: Page): Promise<any> {
        // Basic configuration-based data extraction
        const basicData: any = {};
        
        if (this.config.selectors) {
            // Extract business name
            if (this.config.selectors.businessName) {
                basicData.business_name = await this.extractText(page, this.config.selectors.businessName);
            }
            
            // Extract phone
            if (this.config.selectors.phone) {
                basicData.phone = await this.extractText(page, this.config.selectors.phone);
            }
            
            // Extract email
            if (this.config.selectors.email) {
                basicData.email = await this.extractText(page, this.config.selectors.email);
            }
            
            // Extract website
            if (this.config.selectors.website) {
                basicData.website = await this.extractAttribute(page, this.config.selectors.website, 'href');
            }
        }
        
        return basicData;
    }
    
    private async configurationBasedPagination(page: Page, maxPages: number): Promise<void> {
        // Basic configuration-based pagination
        if (this.config.selectors?.pagination && typeof this.config.selectors.pagination === 'object' && 'nextButton' in this.config.selectors.pagination) {
            // Implementation for configuration-based pagination
        }
    }
    
    private async configurationBasedCookieApplication(page: Page, cookies: any): Promise<void> {
        // Basic configuration-based cookie application
        if (cookies && cookies.length > 0) {
            for (const cookie of cookies) {
                await page.setCookie(cookie);
            }
        }
    }
    
    // Custom enhancement methods
    
    private enhanceSearchResults(results: any[]): any[] {
        // Custom logic to enhance search results
        return results.map(result => ({
            ...result,
            enhanced: true,
            processedAt: new Date()
        }));
    }
    
    private async applyCustomExtractors(page: Page): Promise<any> {
        const customData: any = {};
        
        if (this.config.custom_extractors) {
            for (const [extractorName, functionName] of Object.entries(this.config.custom_extractors)) {
                try {
                    const customExtractor = await this.loadCustomExtractor(functionName as string);
                    customData[extractorName] = await customExtractor(page);
                } catch (error) {
                    console.warn(`Failed to apply custom extractor ${extractorName}:`, error);
                }
            }
        }
        
        return customData;
    }
    
    private postProcessData(data: any): any {
        // Custom post-processing logic
        return {
            ...data,
            processed: true,
            processedAt: new Date(),
            platform: this.config.name
        };
    }
    
    private async applyCustomPaginationLogic(page: Page): Promise<void> {
        // Custom pagination enhancements
        // e.g., handle infinite scroll, AJAX loading, etc.
    }
    
    private async applyCustomCookieLogic(page: Page, cookies: any): Promise<void> {
        // Custom cookie logic
        // e.g., cookie validation, session management, etc.
    }
    
    private enhanceSearchUrl(url: string, keywords: string[], location: string): string {
        // Custom URL enhancements
        // e.g., add additional parameters, filters, etc.
        return url;
    }
    
    private async loadCustomExtractor(functionName: string): Promise<Function> {
        if (!this.config.module_path) {
            throw new Error('Module path is required for custom extractors');
        }
        
        const module = await import(this.config.module_path);
        const customFunction = module[functionName];
        
        if (!customFunction) {
            throw new Error(`Custom extractor function ${functionName} not found in ${this.config.module_path}`);
        }
        
        return customFunction;
    }
    
    private async extractText(page: Page, selector: string): Promise<string | undefined> {
        try {
            const element = await page.$(selector);
            if (element) {
                return await element.evaluate(el => el.textContent?.trim());
            }
        } catch (error) {
            console.warn(`Failed to extract text from selector ${selector}:`, error);
        }
        return undefined;
    }
    
    private async extractAttribute(page: Page, selector: string, attribute: string): Promise<string | undefined> {
        try {
            const element = await page.$(selector);
            if (element) {
                const result = await element.evaluate((el, attr) => el.getAttribute(attr), attribute);
                return result || undefined;
            }
        } catch (error) {
            console.warn(`Failed to extract attribute ${attribute} from selector ${selector}:`, error);
        }
        return undefined;
    }
    
    private async getFallbackData(page: Page): Promise<any> {
        // Fallback data extraction when hybrid extraction fails
        return {
            error: 'Hybrid extraction failed',
            fallback: true,
            timestamp: new Date()
        };
    }
    
    // Example custom extractor functions that can be referenced in config
    
    /**
     * Custom business hours extractor
     * This function can be referenced in the platform configuration
     */
    static async customBusinessHoursExtractor(page: Page): Promise<any> {
        // Custom logic for extracting business hours
        return {
            monday: { open: '9:00 AM', close: '5:00 PM' },
            tuesday: { open: '9:00 AM', close: '5:00 PM' },
            wednesday: { open: '9:00 AM', close: '5:00 PM' },
            thursday: { open: '9:00 AM', close: '5:00 PM' },
            friday: { open: '9:00 AM', close: '5:00 PM' },
            saturday: { open: '10:00 AM', close: '3:00 PM' },
            sunday: { open: '', close: '', closed: true }
        };
    }
    
    /**
     * Custom rating extractor
     * This function can be referenced in the platform configuration
     */
    static async customRatingExtractor(page: Page): Promise<any> {
        // Custom logic for extracting ratings
        return {
            score: 4.5,
            max_score: 5,
            review_count: 25,
            rating_text: 'Excellent'
        };
    }
} 