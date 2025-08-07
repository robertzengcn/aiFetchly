import { PlatformConfig, PlatformType, PlatformStatus } from '@/interfaces/IPlatformConfig';
import { YellowPagesPlatformModel } from '@/model/YellowPagesPlatform.model';
import { BaseModule } from '@/modules/baseModule';

/**
 * Platform registry for managing platform configurations.
 * This class provides CRUD operations for platform management and configuration validation.
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class PlatformRegistry extends BaseModule {
    private platformModel: YellowPagesPlatformModel;
    private platformConfigs: Map<string, PlatformConfig> = new Map();
    private isInitialized: boolean = false;

    constructor() {
        super();
        this.platformModel = new YellowPagesPlatformModel(this.dbpath);
    }

    /**
     * Initialize the platform registry
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('Initializing Platform Registry...');
            
            // Load all platforms from database
            const platforms = await this.platformModel.listPlatforms(1, 1000);
            
            for (const platform of platforms) {
                const config = this.convertEntityToConfig(platform);
                this.platformConfigs.set(config.id, config);
            }
            
            this.isInitialized = true;
            console.log(`Platform Registry initialized with ${this.platformConfigs.size} platforms`);
        } catch (error) {
            console.error('Failed to initialize Platform Registry:', error);
            throw error;
        }
    }

    /**
     * Register a new platform configuration
     * @param config - Platform configuration to register
     */
    async registerPlatform(config: PlatformConfig): Promise<void> {
        try {
            // Validate configuration
            const validation = this.validatePlatformConfig(config);
            if (!validation.isValid) {
                throw new Error(`Invalid platform configuration: ${validation.errors.join(', ')}`);
            }

            // Check if platform already exists
            if (this.platformConfigs.has(config.id)) {
                throw new Error(`Platform with ID '${config.id}' already exists`);
            }

            // Save to database
            const platformId = await this.platformModel.saveYellowPagesPlatform({
                name: config.id,
                display_name: config.display_name,
                base_url: config.base_url,
                country: config.country,
                language: config.language,
                is_active: config.is_active,
                version: config.version,
                rate_limit: config.rate_limit,
                delay_between_requests: config.delay_between_requests,
                max_concurrent_requests: config.max_concurrent_requests,
                selectors: config.selectors || undefined,
                custom_extractors: config.custom_extractors || undefined,
                type: config.type,
                class_name: config.class_name,
                module_path: config.module_path,
                settings: config.settings || undefined,
                metadata: config.metadata || undefined,
                description: config.description,
                maintainer: config.maintainer,
                documentation: config.documentation
            });

            // Add to memory cache
            this.platformConfigs.set(config.id, config);
            
            console.log(`Platform '${config.id}' registered successfully with ID ${platformId}`);
        } catch (error) {
            console.error(`Failed to register platform '${config.id}':`, error);
            throw error;
        }
    }

    /**
     * Get platform configuration by ID
     * @param platformId - Platform ID
     * @returns Platform configuration or null if not found
     */
    getPlatformConfig(platformId: string): PlatformConfig | null {
        return this.platformConfigs.get(platformId) || null;
    }

    /**
     * Get all platform configurations
     * @returns Array of all platform configurations
     */
    getAllPlatforms(): PlatformConfig[] {
        return Array.from(this.platformConfigs.values());
    }

    /**
     * Get active platform configurations
     * @returns Array of active platform configurations
     */
    getActivePlatforms(): PlatformConfig[] {
        return Array.from(this.platformConfigs.values()).filter(config => config.is_active);
    }

    /**
     * Get platforms by type
     * @param type - Platform type
     * @returns Array of platform configurations of the specified type
     */
    getPlatformsByType(type: PlatformType): PlatformConfig[] {
        return Array.from(this.platformConfigs.values()).filter(config => config.type === type);
    }

    /**
     * Get platforms by country
     * @param country - Country code
     * @returns Array of platform configurations for the specified country
     */
    getPlatformsByCountry(country: string): PlatformConfig[] {
        return Array.from(this.platformConfigs.values()).filter(config => 
            config.country.toLowerCase() === country.toLowerCase()
        );
    }

    /**
     * Update platform configuration
     * @param platformId - Platform ID
     * @param updates - Updates to apply
     */
    async updatePlatformConfig(platformId: string, updates: Partial<PlatformConfig>): Promise<void> {
        try {
            const existingConfig = this.platformConfigs.get(platformId);
            if (!existingConfig) {
                throw new Error(`Platform '${platformId}' not found`);
            }

            // Merge updates with existing config
            const updatedConfig = { ...existingConfig, ...updates };

            // Validate updated configuration
            const validation = this.validatePlatformConfig(updatedConfig);
            if (!validation.isValid) {
                throw new Error(`Invalid platform configuration: ${validation.errors.join(', ')}`);
            }

            // Update in database
            const platform = await this.platformModel.getPlatformByName(platformId);
            if (!platform) {
                throw new Error(`Platform '${platformId}' not found in database`);
            }

            const updateData: any = {};
            if (updates.display_name) updateData.display_name = updates.display_name;
            if (updates.base_url) updateData.base_url = updates.base_url;
            if (updates.country) updateData.country = updates.country;
            if (updates.language) updateData.language = updates.language;
            if (updates.is_active !== undefined) updateData.is_active = updates.is_active;
            if (updates.version) updateData.version = updates.version;
            if (updates.rate_limit) updateData.rate_limit = updates.rate_limit;
            if (updates.delay_between_requests) updateData.delay_between_requests = updates.delay_between_requests;
            if (updates.max_concurrent_requests) updateData.max_concurrent_requests = updates.max_concurrent_requests;
            if (updates.selectors) updateData.selectors = JSON.stringify(updates.selectors);
            if (updates.custom_extractors) updateData.custom_extractors = JSON.stringify(updates.custom_extractors);
            if (updates.type) updateData.type = updates.type;
            if (updates.class_name) updateData.class_name = updates.class_name;
            if (updates.module_path) updateData.module_path = updates.module_path;
            if (updates.settings) updateData.settings = JSON.stringify(updates.settings);
            if (updates.metadata) updateData.metadata = JSON.stringify(updates.metadata);
            if (updates.description) updateData.description = updates.description;
            if (updates.maintainer) updateData.maintainer = updates.maintainer;
            if (updates.documentation) updateData.documentation = updates.documentation;

            await this.platformModel.updatePlatform(platform.id, updateData);

            // Update memory cache
            this.platformConfigs.set(platformId, updatedConfig);
            
            console.log(`Platform '${platformId}' updated successfully`);
        } catch (error) {
            console.error(`Failed to update platform '${platformId}':`, error);
            throw error;
        }
    }

    /**
     * Remove platform configuration
     * @param platformId - Platform ID
     */
    async removePlatform(platformId: string): Promise<void> {
        try {
            const platform = await this.platformModel.getPlatformByName(platformId);
            if (!platform) {
                throw new Error(`Platform '${platformId}' not found`);
            }

            // Remove from database
            await this.platformModel.deletePlatform(platform.id);

            // Remove from memory cache
            this.platformConfigs.delete(platformId);
            
            console.log(`Platform '${platformId}' removed successfully`);
        } catch (error) {
            console.error(`Failed to remove platform '${platformId}':`, error);
            throw error;
        }
    }

    /**
     * Activate platform
     * @param platformId - Platform ID
     */
    async activatePlatform(platformId: string): Promise<void> {
        await this.updatePlatformConfig(platformId, { is_active: true });
    }

    /**
     * Deactivate platform
     * @param platformId - Platform ID
     */
    async deactivatePlatform(platformId: string): Promise<void> {
        await this.updatePlatformConfig(platformId, { is_active: false });
    }

    /**
     * Check if platform exists
     * @param platformId - Platform ID
     * @returns True if platform exists
     */
    hasPlatform(platformId: string): boolean {
        return this.platformConfigs.has(platformId);
    }

    /**
     * Get platform count
     * @returns Total number of platforms
     */
    getPlatformCount(): number {
        return this.platformConfigs.size;
    }

    /**
     * Get active platform count
     * @returns Number of active platforms
     */
    getActivePlatformCount(): number {
        return Array.from(this.platformConfigs.values()).filter(config => config.is_active).length;
    }

    /**
     * Validate platform configuration
     * @param config - Platform configuration to validate
     * @returns Validation result
     */
    validatePlatformConfig(config: PlatformConfig): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
        score: number;
    } {
        const errors: string[] = [];
        const warnings: string[] = [];
        let score = 100;

        // Required fields validation
        if (!config.id) errors.push('Platform ID is required');
        if (!config.name) errors.push('Platform name is required');
        if (!config.display_name) errors.push('Platform display name is required');
        if (!config.base_url) errors.push('Platform base URL is required');
        if (!config.country) errors.push('Platform country is required');
        if (!config.language) errors.push('Platform language is required');
        if (!config.version) errors.push('Platform version is required');

        // URL validation
        if (config.base_url && !this.isValidUrl(config.base_url)) {
            errors.push('Invalid base URL format');
        }

        // Type-specific validation
        if (config.type === 'class' || config.type === 'hybrid') {
            if (!config.class_name) {
                errors.push('Class name is required for class-based platforms');
            }
            if (!config.module_path) {
                errors.push('Module path is required for class-based platforms');
            }
        }

        // Selectors validation
        if (config.selectors) {
            if (!config.selectors.businessList) {
                errors.push('Business list selector is required');
            }
            if (!config.selectors.businessName) {
                errors.push('Business name selector is required');
            }
        }

        // Rate limiting validation
        if (config.rate_limit && config.rate_limit <= 0) {
            errors.push('Rate limit must be greater than 0');
        }
        if (config.delay_between_requests && config.delay_between_requests < 0) {
            errors.push('Delay between requests must be non-negative');
        }

        // Calculate score
        score = Math.max(0, score - (errors.length * 20) - (warnings.length * 5));

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            score
        };
    }

    /**
     * Convert database entity to platform configuration
     * @param entity - Database entity
     * @returns Platform configuration
     */
    private convertEntityToConfig(entity: any): PlatformConfig {
        return {
            id: entity.name,
            name: entity.name,
            display_name: entity.display_name,
            base_url: entity.base_url,
            country: entity.country,
            language: entity.language,
            is_active: entity.is_active,
            version: entity.version,
            rate_limit: entity.rate_limit,
            delay_between_requests: entity.delay_between_requests,
            max_concurrent_requests: entity.max_concurrent_requests,
            selectors: entity.selectors ? JSON.parse(entity.selectors) : undefined,
            custom_extractors: entity.custom_extractors ? JSON.parse(entity.custom_extractors) : undefined,
            type: entity.type as PlatformType,
            class_name: entity.class_name,
            module_path: entity.module_path,
            settings: entity.settings ? JSON.parse(entity.settings) : undefined,
            metadata: entity.metadata ? JSON.parse(entity.metadata) : undefined,
            description: entity.description,
            maintainer: entity.maintainer,
            documentation: entity.documentation
        };
    }

    /**
     * Validate URL format
     * @param url - URL to validate
     * @returns True if URL is valid
     */
    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
} 