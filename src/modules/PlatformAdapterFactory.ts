import { BaseModule } from '@/modules/baseModule';
import { PlatformRegistry } from '@/modules/PlatformRegistry';
import { IBasePlatformAdapter, IPlatformAdapterFactory } from '@/modules/interface/IBasePlatformAdapter';
import { PlatformConfig, PlatformSummary } from '@/modules/interface/IPlatformConfig';

/**
 * Platform Adapter Factory - Creates platform adapters based on configuration
 * 
 * This factory creates appropriate adapter instances based on platform configuration type:
 * - Configuration-only platforms use the default adapter
 * - Class-based platforms load custom adapter classes
 * - Hybrid platforms combine configuration with custom logic
 */
export class PlatformAdapterFactory extends BaseModule implements IPlatformAdapterFactory {
    private platformRegistry: PlatformRegistry;
    private adapterCache: Map<string, IBasePlatformAdapter> = new Map();

    constructor() {
        super();
        this.platformRegistry = new PlatformRegistry();
    }

    /**
     * Create platform adapter from configuration
     */
    async createAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter> {
        // Check cache first
        if (this.adapterCache.has(config.id)) {
            return this.adapterCache.get(config.id)!;
        }

        let adapter: IBasePlatformAdapter;

        try {
            switch (config.type) {
                case 'configuration':
                    adapter = await this.createConfigurationAdapter(config);
                    break;
                    
                case 'class':
                    adapter = await this.createClassBasedAdapter(config);
                    break;
                    
                case 'hybrid':
                    adapter = await this.createHybridAdapter(config);
                    break;
                    
                default:
                    // Default to configuration-based adapter
                    adapter = await this.createConfigurationAdapter(config);
                    break;
            }

            // Cache the adapter
            this.adapterCache.set(config.id, adapter);
            
            console.log(`✅ Created adapter for platform: ${config.name} (${config.type || 'configuration'})`);
            return adapter;

        } catch (error) {
            console.error(`❌ Error creating adapter for platform ${config.id}:`, error);
            throw error;
        }
    }

    /**
     * Create adapter by platform ID
     */
    async createAdapterById(platformId: string): Promise<IBasePlatformAdapter> {
        const config = this.platformRegistry.getPlatformConfig(platformId);
        if (!config) {
            throw new Error(`Platform configuration not found: ${platformId}`);
        }

        return await this.createAdapter(config);
    }

    /**
     * Register platform adapter manually
     */
    registerAdapter(platformName: string, adapter: IBasePlatformAdapter): void {
        this.adapterCache.set(platformName, adapter);
        console.log(`✅ Manually registered adapter: ${platformName}`);
    }

    /**
     * Unregister platform adapter
     */
    unregisterAdapter(platformName: string): void {
        this.adapterCache.delete(platformName);
        console.log(`🗑️ Unregistered adapter: ${platformName}`);
    }

    /**
     * Get all registered adapters
     */
    getRegisteredAdapters(): Map<string, IBasePlatformAdapter> {
        return new Map(this.adapterCache);
    }

    /**
     * Check if adapter exists in cache
     */
    hasAdapter(platformName: string): boolean {
        return this.adapterCache.has(platformName);
    }

    /**
     * Clear adapter cache
     */
    clearCache(): void {
        this.adapterCache.clear();
        console.log('🧹 Cleared adapter cache');
    }

    /**
     * Get available platforms
     */
    getAvailablePlatforms(): PlatformSummary[] {
        return this.platformRegistry.getAllPlatforms().map(p => ({
            id: p.id,
            name: p.name,
            display_name: p.display_name,
            country: p.country,
            language: p.language,
            rate_limit: p.rate_limit,
            is_active: p.is_active
        }));
    }

    /**
     * Get platform registry instance
     */
    getPlatformRegistry(): PlatformRegistry {
        return this.platformRegistry;
    }

    /**
     * Create configuration-only adapter
     */
    private async createConfigurationAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter> {
        // Import the ConfigurationPlatformAdapter
        const { ConfigurationPlatformAdapter } = await import('@/modules/ConfigurationPlatformAdapter');
        return new ConfigurationPlatformAdapter(config);
    }

    /**
     * Create class-based adapter
     */
    private async createClassBasedAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter> {
        if (!config.class_name || !config.module_path) {
            throw new Error(`Class name and module path required for class-based platform: ${config.id}`);
        }

        try {
            // Dynamically import the adapter class
            const modulePath = this.resolveModulePath(config.module_path);
            const module = await import(modulePath);
            
            const AdapterClass = module[config.class_name];
            if (!AdapterClass) {
                throw new Error(`Class ${config.class_name} not found in module ${config.module_path}`);
            }

            // Create instance with configuration
            return new AdapterClass(config);

        } catch (error) {
            console.error(`❌ Error loading class-based adapter ${config.class_name}:`, error);
            throw new Error(`Failed to load class-based adapter: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Create hybrid adapter
     */
    private async createHybridAdapter(config: PlatformConfig): Promise<IBasePlatformAdapter> {
        if (!config.class_name || !config.module_path) {
            throw new Error(`Class name and module path required for hybrid platform: ${config.id}`);
        }

        try {
            // Dynamically import the hybrid adapter class
            const modulePath = this.resolveModulePath(config.module_path);
            const module = await import(modulePath);
            
            const AdapterClass = module[config.class_name];
            if (!AdapterClass) {
                throw new Error(`Class ${config.class_name} not found in module ${config.module_path}`);
            }

            // Create hybrid instance with configuration
            return new AdapterClass(config);

        } catch (error) {
            console.error(`❌ Error loading hybrid adapter ${config.class_name}:`, error);
            throw new Error(`Failed to load hybrid adapter: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Resolve module path to absolute path
     */
    private resolveModulePath(modulePath: string): string {
        // Handle relative paths
        if (modulePath.startsWith('./')) {
            return modulePath.replace('./', '@/platforms/');
        }
        
        // Handle absolute paths
        if (modulePath.startsWith('@/')) {
            return modulePath;
        }
        
        // Default to platforms directory
        return `@/platforms/${modulePath}`;
    }

    /**
     * Validate adapter implementation
     */
    async validateAdapter(adapter: IBasePlatformAdapter): Promise<boolean> {
        try {
            // Check if adapter implements required methods
            const requiredMethods = [
                'searchBusinesses',
                'extractBusinessData', 
                'handlePagination',
                'applyCookies'
            ];

            for (const method of requiredMethods) {
                if (typeof adapter[method] !== 'function') {
                    console.error(`❌ Adapter missing required method: ${method}`);
                    return false;
                }
            }

            // Validate configuration
            const configValidation = adapter.validateConfig();
            if (!configValidation.isValid) {
                console.error(`❌ Adapter configuration invalid:`, configValidation.errors);
                return false;
            }

            console.log(`✅ Adapter validation passed for: ${adapter.platformName}`);
            return true;

        } catch (error) {
            console.error(`❌ Error validating adapter:`, error);
            return false;
        }
    }

    /**
     * Get factory statistics
     */
    getFactoryStatistics(): any {
        const platforms = this.platformRegistry.getAllPlatforms();
        const cachedAdapters = Array.from(this.adapterCache.keys());
        
        return {
            availablePlatforms: platforms.length,
            cachedAdapters: cachedAdapters.length,
            cacheHitRatio: cachedAdapters.length / Math.max(platforms.length, 1),
            platformsByType: platforms.reduce((acc, p) => {
                const type = p.type || 'configuration';
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            cachedPlatforms: cachedAdapters
        };
    }
}