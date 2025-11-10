import { ChildProcessAdapterFactory } from './ChildProcessAdapterFactory';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';

/**
 * Example child process scraper that demonstrates how to use adapter classes
 * This would typically run in a separate process via Electron's utilityProcess
 */
export class ChildProcessScraper {
    private adapter: BasePlatformAdapter | null = null;
    private platformConfig: PlatformConfig | null = null;

    /**
     * Initialize the scraper with platform configuration and adapter class info
     */
    async initialize(platformConfig: PlatformConfig, adapterClassInfo?: { className: string; modulePath: string }): Promise<void> {
        this.platformConfig = platformConfig;
        
        if (adapterClassInfo) {
            try {
                // Create adapter instance using the factory
                this.adapter = await ChildProcessAdapterFactory.createAdapter(adapterClassInfo, platformConfig);
                console.log(`Successfully created adapter: ${adapterClassInfo.className}`);
            } catch (error) {
                console.error('Failed to create adapter:', error);
                throw error;
            }
        } else {
            console.log('No adapter class specified, using base platform adapter');
        }
    }

    /**
     * Execute scraping using the platform-specific adapter
     */
    async executeScraping(taskData: any, page?: any): Promise<any[]> {
        if (!this.platformConfig) {
            throw new Error('Scraper not initialized');
        }

        if (this.adapter) {
            // Use platform-specific adapter methods
            console.log('Using platform-specific adapter for scraping');
            
            // Example: Use adapter-specific search method
            if (this.adapter.searchBusinesses !== BasePlatformAdapter.prototype.searchBusinesses) {
                const results = await this.adapter.searchBusinesses(
                    page, 
                    taskData.keywords, 
                    taskData.location
                );
                return results;
            }
            
            // Example: Use adapter-specific data extraction method
            if (this.adapter.extractBusinessData !== BasePlatformAdapter.prototype.extractBusinessData) {
                // This would require a page object from Puppeteer
                // For demonstration, we'll return empty results
                console.log('Adapter has custom data extraction method');
                return [];
            }
        }

        // Fallback to base implementation or configuration-based approach
        console.log('Using configuration-based scraping approach');
        return this.executeConfigurationBasedScraping(taskData);
    }

    /**
     * Fallback to configuration-based scraping when no adapter is available
     */
    private async executeConfigurationBasedScraping(taskData: any): Promise<any[]> {
        // This would implement scraping logic based on platformConfig.selectors
        // For now, return empty results
        console.log('Executing configuration-based scraping');
        return [];
    }

    /**
     * Get adapter capabilities
     */
    getAdapterCapabilities(): string[] {
        if (!this.adapter) {
            return ['configuration-based'];
        }

        const capabilities: string[] = ['class-based'];
        
        // Check what methods the adapter provides
        if (this.adapter.searchBusinesses !== BasePlatformAdapter.prototype.searchBusinesses) capabilities.push('custom-search');
        if (this.adapter.extractBusinessData !== BasePlatformAdapter.prototype.extractBusinessData) capabilities.push('custom-extraction');
        if (this.adapter.handlePagination !== BasePlatformAdapter.prototype.handlePagination) capabilities.push('custom-pagination');
        
        return capabilities;
    }

    /**
     * Check if adapter supports a specific feature
     */
    supportsFeature(feature: string): boolean {
        if (!this.adapter) return false;
        
        switch (feature) {
            case 'custom-search':
                return this.adapter.searchBusinesses !== BasePlatformAdapter.prototype.searchBusinesses;
            case 'custom-extraction':
                return this.adapter.extractBusinessData !== BasePlatformAdapter.prototype.extractBusinessData;
            case 'custom-pagination':
                return this.adapter.handlePagination !== BasePlatformAdapter.prototype.handlePagination;
            default:
                return false;
        }
    }
}
