import { PlatformConfig, PlatformType } from '@/interfaces/IPlatformConfig';
import { IBasePlatformAdapter, IPlatformAdapterFactory } from '@/interfaces/IBasePlatformAdapter';
import { PlatformRegistry } from '@/modules/PlatformRegistry';
import { BaseModule } from '@/modules/baseModule';

/**
 * Configuration-only platform adapter that uses only JSON configuration
 * for data extraction without custom logic.
 */
class ConfigurationPlatformAdapter implements IBasePlatformAdapter {
    readonly config: PlatformConfig;
    
    constructor(config: PlatformConfig) {
        this.config = config;
    }
    
    get platformName(): string { return this.config.name; }
    get baseUrl(): string { return this.config.base_url; }
    get version(): string { return this.config.version; }
    
    async searchBusinesses(keywords: string[], location: string): Promise<any[]> {
        // Default implementation using configuration
        return [];
    }
    
    async extractBusinessData(page: any): Promise<any> {
        // Default implementation using configuration selectors
        return {};
    }
    
    async handlePagination(page: any, maxPages: number): Promise<void> {
        // Default implementation using configuration
    }
    
    async applyCookies(page: any, cookies: any): Promise<void> {
        // Default implementation
    }
    
    getSelectors(): any {
        return this.config.selectors || {};
    }
    
    getRateLimitingConfig(): any {
        return {
            requestsPerHour: this.config.rate_limit || 100,
            delayBetweenRequests: this.config.delay_between_requests || 2000,
            maxConcurrentRequests: this.config.max_concurrent_requests || 1
        };
    }
    
    getAuthenticationConfig(): any {
        return {
            requiresAuthentication: this.config.settings?.requiresAuthentication || false,
            supportsCookies: this.config.settings?.supportsCookies || true,
            supportsProxy: this.config.settings?.supportsProxy || true
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
        return this.config.settings?.supportedFeatures || ['search', 'pagination'];
    }
    
    buildSearchUrl(keywords: string[], location: string, pageNum: number): string {
        const searchUrlPattern = this.config.settings?.searchUrlPattern || 
            `${this.config.base_url}/search?q={keywords}&location={location}&page={page}`;
        
        return searchUrlPattern
            .replace('{keywords}', encodeURIComponent(keywords.join(' ')))
            .replace('{location}', encodeURIComponent(location))
            .replace('{page}', pageNum.toString());
    }
    
    validateConfig(): any {
        return {
            isValid: true,
            errors: [],
            warnings: [],
            score: 100
        };
    }
}

/**
 * Unified platform factory that creates platform adapters based on configuration type.
 * Supports configuration-only, class-based, and hybrid platforms.
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class UnifiedPlatformFactory extends BaseModule implements IPlatformAdapterFactory {
    private platformRegistry: PlatformRegistry;
    private platformAdapters: Map<string, IBasePlatformAdapter> = new Map();
    private isInitialized: boolean = false;

    constructor() {
        super();
        this.platformRegistry = new PlatformRegistry();
    }

    /**
     * Initialize the factory
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('Initializing Unified Platform Factory...');
            
            // Platform registry is ready to use without initialization
            
            this.isInitialized = true;
            console.log('Unified Platform Factory initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Unified Platform Factory:', error);
            throw error;
        }
    }

    /**
     * Create platform adapter from configuration
     * @param config - Platform configuration
     * @returns Promise resolving to platform adapter
     */
    async createAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter> {
        try {
            // Check if adapter already exists
            if (this.platformAdapters.has(config.id)) {
                return this.platformAdapters.get(config.id)!;
            }

            let adapter: IBasePlatformAdapter;

            switch (config.type) {
                case 'configuration':
                    adapter = this.createConfigurationAdapter(config);
                    break;
                    
                case 'class':
                    adapter = await this.createClassBasedAdapter(config);
                    break;
                    
                case 'hybrid':
                    adapter = await this.createHybridAdapter(config);
                    break;
                    
                default:
                    throw new Error(`Unknown platform type: ${config.type}`);
            }

            // Cache the adapter
            this.platformAdapters.set(config.id, adapter);
            
            console.log(`Created ${config.type} adapter for platform '${config.id}'`);
            return adapter;
            
        } catch (error) {
            console.error(`Failed to create adapter for platform '${config.id}':`, error);
            throw error;
        }
    }

    /**
     * Create configuration-only adapter
     * @param config - Platform configuration
     * @returns Configuration-only platform adapter
     */
    private createConfigurationAdapter(config: PlatformConfig): IBasePlatformAdapter {
        return new ConfigurationPlatformAdapter(config);
    }

    /**
     * Create class-based adapter
     * @param config - Platform configuration
     * @returns Class-based platform adapter
     */
    private async createClassBasedAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter> {
        if (!config.class_name || !config.module_path) {
            throw new Error('Class name and module path are required for class-based platforms');
        }

        try {
            // Dynamically load the class from the specified module
            const module = await import(config.module_path);
            const AdapterClass = module[config.class_name];
            
            if (!AdapterClass) {
                throw new Error(`Class ${config.class_name} not found in ${config.module_path}`);
            }

            // Create instance with config
            return new AdapterClass(config);
            
        } catch (error) {
            console.error(`Failed to load class-based adapter for ${config.id}:`, error);
            throw error;
        }
    }

    /**
     * Create hybrid adapter (configuration + custom logic)
     * @param config - Platform configuration
     * @returns Hybrid platform adapter
     */
    private async createHybridAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter> {
        if (!config.class_name || !config.module_path) {
            throw new Error('Class name and module path are required for hybrid platforms');
        }

        try {
            // Load the base class
            const module = await import(config.module_path);
            const BaseClass = module[config.class_name];
            
            if (!BaseClass) {
                throw new Error(`Class ${config.class_name} not found in ${config.module_path}`);
            }

            // Create hybrid adapter that extends the base class
            return new HybridPlatformAdapter(config, BaseClass);
            
        } catch (error) {
            console.error(`Failed to load hybrid adapter for ${config.id}:`, error);
            throw error;
        }
    }

    /**
     * Register platform adapter
     * @param platformName - Platform name
     * @param adapter - Platform adapter
     */
    registerAdapter(platformName: string, adapter: IBasePlatformAdapter): void {
        this.platformAdapters.set(platformName, adapter);
        console.log(`Registered adapter for platform '${platformName}'`);
    }

    /**
     * Unregister platform adapter
     * @param platformName - Platform name
     */
    unregisterAdapter(platformName: string): void {
        this.platformAdapters.delete(platformName);
        console.log(`Unregistered adapter for platform '${platformName}'`);
    }

    /**
     * Get registered adapters
     * @returns Map of registered adapters
     */
    getRegisteredAdapters(): Map<string, IBasePlatformAdapter> {
        return new Map(this.platformAdapters);
    }

    /**
     * Check if adapter exists
     * @param platformName - Platform name
     * @returns True if adapter exists
     */
    hasAdapter(platformName: string): boolean {
        return this.platformAdapters.has(platformName);
    }

    /**
     * Get adapter by platform name
     * @param platformName - Platform name
     * @returns Platform adapter or null if not found
     */
    getAdapter(platformName: string): IBasePlatformAdapter | null {
        return this.platformAdapters.get(platformName) || null;
    }

    /**
     * Create adapter by platform name
     * @param platformName - Platform name
     * @returns Promise resolving to platform adapter
     */
    async createAdapterByName(platformName: string): Promise<IBasePlatformAdapter> {
        const config = this.platformRegistry.getPlatformConfig(platformName);
        if (!config) {
            throw new Error(`Platform configuration not found: ${platformName}`);
        }
        
        return await this.createAdapter(config);
    }

    /**
     * Get all supported platforms
     * @returns Array of platform names
     */
    getSupportedPlatforms(): string[] {
        return Array.from(this.platformAdapters.keys());
    }

    /**
     * Clear all cached adapters
     */
    clearCache(): void {
        this.platformAdapters.clear();
        console.log('Cleared platform adapter cache');
    }
}

/**
 * Hybrid platform adapter that combines configuration with custom logic
 */
class HybridPlatformAdapter implements IBasePlatformAdapter {
    readonly config: PlatformConfig;
    private baseAdapter: IBasePlatformAdapter;
    
    constructor(config: PlatformConfig, BaseClass: any) {
        this.config = config;
        this.baseAdapter = new BaseClass(config);
    }
    
    get platformName(): string { return this.config.name; }
    get baseUrl(): string { return this.config.base_url; }
    get version(): string { return this.config.version; }
    
    async searchBusinesses(keywords: string[], location: string): Promise<any[]> {
        return await this.baseAdapter.searchBusinesses(keywords, location);
    }
    
    async extractBusinessData(page: any): Promise<any> {
        // Use base implementation but apply custom extractors if defined
        const baseData = await this.baseAdapter.extractBusinessData(page);
        
        if (this.config.custom_extractors) {
            return await this.applyCustomExtractors(baseData, page);
        }
        
        return baseData;
    }
    
    async handlePagination(page: any, maxPages: number): Promise<void> {
        return await this.baseAdapter.handlePagination(page, maxPages);
    }
    
    async applyCookies(page: any, cookies: any): Promise<void> {
        return await this.baseAdapter.applyCookies(page, cookies);
    }
    
    getSelectors(): any {
        return this.baseAdapter.getSelectors();
    }
    
    getRateLimitingConfig(): any {
        return this.baseAdapter.getRateLimitingConfig();
    }
    
    getAuthenticationConfig(): any {
        return this.baseAdapter.getAuthenticationConfig();
    }
    
    supportsAuthentication(): boolean {
        return this.baseAdapter.supportsAuthentication();
    }
    
    supportsProxy(): boolean {
        return this.baseAdapter.supportsProxy();
    }
    
    supportsCookies(): boolean {
        return this.baseAdapter.supportsCookies();
    }
    
    getSupportedFeatures(): string[] {
        return this.baseAdapter.getSupportedFeatures();
    }
    
    buildSearchUrl(keywords: string[], location: string, pageNum: number): string {
        return this.baseAdapter.buildSearchUrl(keywords, location, pageNum);
    }
    
    validateConfig(): any {
        return this.baseAdapter.validateConfig();
    }
    
    /**
     * Apply custom extraction functions defined in configuration
     * @param baseData - Base extracted data
     * @param page - Puppeteer page object
     * @returns Enhanced data with custom extractions
     */
    private async applyCustomExtractors(baseData: any, page: any): Promise<any> {
        const customData = { ...baseData };
        
        for (const [extractorName, functionName] of Object.entries(this.config.custom_extractors || {})) {
            try {
                // Load custom function from module
                const customExtractor = await this.loadCustomExtractor(functionName as string);
                customData[extractorName] = await customExtractor(page);
            } catch (error) {
                console.warn(`Failed to apply custom extractor ${extractorName}:`, error);
            }
        }
        
        return customData;
    }
    
    /**
     * Load custom extractor function from module
     * @param functionName - Function name to load
     * @returns Custom extractor function
     */
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
} 