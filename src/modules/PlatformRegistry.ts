import { BaseModule } from '@/modules/baseModule';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { ValidationResult } from '@/interfaces/IBasePlatformAdapter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Platform Registry - Manages platform configurations and adapters
 * 
 * This class handles registration, validation, and management of platform configurations
 * for the Yellow Pages scraping system.
 */
export class PlatformRegistry extends BaseModule {
    private platforms: Map<string, PlatformConfig> = new Map();
    private platformsDir: string;

    constructor() {
        super();
        this.platformsDir = path.join(process.cwd(), 'src/config/platforms');
        this.loadPlatformConfigurations();
    }

    /**
     * Register a new platform configuration
     */
    async registerPlatform(config: PlatformConfig): Promise<void> {
        const validation = this.validatePlatformConfig(config);
        if (!validation.isValid) {
            throw new Error(`Invalid platform configuration: ${validation.errors.join(', ')}`);
        }

        this.platforms.set(config.id, config);
        await this.savePlatformConfig(config);
        
        console.log(`✅ Registered platform: ${config.name} (${config.id})`);
    }

    /**
     * Get platform configuration by ID
     */
    getPlatformConfig(platformId: string): PlatformConfig | null {
        return this.platforms.get(platformId) || null;
    }

    /**
     * Get all available platform configurations
     */
    getAllPlatforms(): PlatformConfig[] {
        return Array.from(this.platforms.values());
    }

    /**
     * Get active platforms only
     */
    getActivePlatforms(): PlatformConfig[] {
        return this.getAllPlatforms().filter(platform => platform.is_active);
    }

    /**
     * Get platforms by country
     */
    getPlatformsByCountry(country: string): PlatformConfig[] {
        return this.getAllPlatforms().filter(platform => 
            platform.country.toLowerCase() === country.toLowerCase()
        );
    }

    /**
     * Get platforms by type (configuration, class, hybrid)
     */
    getPlatformsByType(type: string): PlatformConfig[] {
        return this.getAllPlatforms().filter(platform => platform.type === type);
    }

    /**
     * Update platform configuration
     */
    async updatePlatformConfig(platformId: string, updates: Partial<PlatformConfig>): Promise<void> {
        const existing = this.platforms.get(platformId);
        if (!existing) {
            throw new Error(`Platform not found: ${platformId}`);
        }

        const updated = { ...existing, ...updates };
        const validation = this.validatePlatformConfig(updated);
        
        if (!validation.isValid) {
            throw new Error(`Invalid platform configuration: ${validation.errors.join(', ')}`);
        }

        this.platforms.set(platformId, updated);
        await this.savePlatformConfig(updated);
        
        console.log(`✅ Updated platform: ${updated.name} (${platformId})`);
    }

    /**
     * Remove platform configuration
     */
    async removePlatform(platformId: string): Promise<void> {
        const platform = this.platforms.get(platformId);
        if (!platform) {
            throw new Error(`Platform not found: ${platformId}`);
        }

        this.platforms.delete(platformId);
        await this.removePlatformConfig(platformId);
        
        console.log(`✅ Removed platform: ${platform.name} (${platformId})`);
    }

    /**
     * Check if platform exists
     */
    hasPlatform(platformId: string): boolean {
        return this.platforms.has(platformId);
    }

    /**
     * Validate platform configuration
     */
    validatePlatformConfig(config: PlatformConfig): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        let score = 100;

        // Required fields validation
        if (!config.id) {
            errors.push('Platform ID is required');
            score -= 20;
        }

        if (!config.name) {
            errors.push('Platform name is required');
            score -= 20;
        }

        if (!config.base_url) {
            errors.push('Base URL is required');
            score -= 20;
        } else if (!this.isValidUrl(config.base_url)) {
            errors.push('Base URL is not a valid URL');
            score -= 15;
        }

        if (!config.selectors) {
            errors.push('Selectors configuration is required');
            score -= 20;
        } else {
            // Validate required selectors
            const requiredSelectors = ['businessList', 'businessName'];
            for (const selector of requiredSelectors) {
                if (!config.selectors[selector]) {
                    errors.push(`Required selector missing: ${selector}`);
                    score -= 10;
                }
            }
        }

        // Type validation
        if (config.type && !['configuration', 'class', 'hybrid'].includes(config.type)) {
            errors.push('Platform type must be one of: configuration, class, hybrid');
            score -= 15;
        }

        // Class-based platform validation
        if (config.type === 'class' || config.type === 'hybrid') {
            if (!config.class_name) {
                errors.push('Class name is required for class-based platforms');
                score -= 15;
            }
            if (!config.module_path) {
                errors.push('Module path is required for class-based platforms');
                score -= 15;
            }
        }

        // Optional field warnings
        if (!config.country) {
            warnings.push('Country not specified');
            score -= 5;
        }

        if (!config.language) {
            warnings.push('Language not specified');
            score -= 5;
        }

        if (config.rate_limit && config.rate_limit < 10) {
            warnings.push('Rate limit is very low (< 10 requests/hour)');
            score -= 10;
        }

        if (config.delay_between_requests && config.delay_between_requests < 1000) {
            warnings.push('Delay between requests is very low (< 1 second)');
            score -= 5;
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            score: Math.max(0, score)
        };
    }

    /**
     * Load platform configurations from files
     */
    private loadPlatformConfigurations(): void {
        try {
            // Ensure platforms directory exists
            if (!fs.existsSync(this.platformsDir)) {
                fs.mkdirSync(this.platformsDir, { recursive: true });
                console.log(`Created platforms directory: ${this.platformsDir}`);
                return;
            }

            // Load all JSON files from platforms directory
            const files = fs.readdirSync(this.platformsDir)
                .filter(file => file.endsWith('.json'));

            for (const file of files) {
                try {
                    const filePath = path.join(this.platformsDir, file);
                    const configData = fs.readFileSync(filePath, 'utf8');
                    const config: PlatformConfig = JSON.parse(configData);
                    
                    // Validate configuration
                    const validation = this.validatePlatformConfig(config);
                    if (validation.isValid) {
                        this.platforms.set(config.id, config);
                        console.log(`✅ Loaded platform: ${config.name} (${config.id})`);
                    } else {
                        console.error(`❌ Invalid platform config in ${file}:`, validation.errors);
                    }
                } catch (error) {
                    console.error(`❌ Error loading platform config from ${file}:`, error);
                }
            }

            console.log(`📋 Loaded ${this.platforms.size} platform configurations`);
        } catch (error) {
            console.error('❌ Error loading platform configurations:', error);
        }
    }

    /**
     * Save platform configuration to file
     */
    private async savePlatformConfig(config: PlatformConfig): Promise<void> {
        try {
            // Ensure platforms directory exists
            if (!fs.existsSync(this.platformsDir)) {
                fs.mkdirSync(this.platformsDir, { recursive: true });
            }

            const fileName = `${config.id}.json`;
            const filePath = path.join(this.platformsDir, fileName);
            
            // Add metadata timestamps
            const configWithMetadata = {
                ...config,
                metadata: {
                    ...config.metadata,
                    lastUpdated: new Date().toISOString()
                }
            };

            fs.writeFileSync(filePath, JSON.stringify(configWithMetadata, null, 2));
            console.log(`💾 Saved platform config: ${filePath}`);
        } catch (error) {
            console.error(`❌ Error saving platform config for ${config.id}:`, error);
            throw error;
        }
    }

    /**
     * Remove platform configuration file
     */
    private async removePlatformConfig(platformId: string): Promise<void> {
        try {
            const fileName = `${platformId}.json`;
            const filePath = path.join(this.platformsDir, fileName);
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Deleted platform config file: ${filePath}`);
            }
        } catch (error) {
            console.error(`❌ Error removing platform config for ${platformId}:`, error);
            throw error;
        }
    }

    /**
     * Validate URL format
     */
    private isValidUrl(urlString: string): boolean {
        try {
            new URL(urlString);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get platform statistics
     */
    getPlatformStatistics(): any {
        const platforms = this.getAllPlatforms();
        const activePlatforms = platforms.filter(p => p.is_active);
        
        const byCountry = platforms.reduce((acc, platform) => {
            acc[platform.country] = (acc[platform.country] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const byType = platforms.reduce((acc, platform) => {
            const type = platform.type || 'configuration';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            total: platforms.length,
            active: activePlatforms.length,
            inactive: platforms.length - activePlatforms.length,
            byCountry,
            byType,
            platforms: platforms.map(p => ({
                id: p.id,
                name: p.name,
                country: p.country,
                isActive: p.is_active,
                type: p.type || 'configuration'
            }))
        };
    }
}