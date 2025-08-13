import { BaseModule } from "@/modules/baseModule";
import { PlatformRegistry } from "@/modules/PlatformRegistry";
import { PlatformConfig } from "@/interfaces/IPlatformConfig";

export class YellowPagesPlatformModule extends BaseModule {
    private registry: PlatformRegistry;

    constructor() {
        super();
        this.registry = new PlatformRegistry();
    }

    /**
     * Get all available platforms
     * @returns Array of all platforms
     */
    async getAllPlatforms(): Promise<PlatformConfig[]> {
        try {
            return this.registry.getAllPlatforms();
        } catch (error) {
            console.error(`Error getting all platforms: ${error}`);
            throw new Error(`Failed to retrieve platforms: ${error}`);
        }
    }

    /**
     * Get platform by name
     * @param name The platform name
     * @returns The platform entity or null
     */
    async getPlatformByName(name: string): Promise<PlatformConfig | null> {
        try {
            const platforms = this.registry.getAllPlatforms();
            const match = platforms.find(p => 
                p.name === name || p.id === name || p.display_name === name
            );
            return match || null;
        } catch (error) {
            console.error(`Error getting platform by name '${name}': ${error}`);
            throw new Error(`Failed to retrieve platform by name: ${error}`);
        }
    }

    /**
     * Get platform by ID
     * @param id The platform ID
     * @returns The platform entity or null
     */
    async getPlatformById(id: string): Promise<PlatformConfig | null> {
        try {
            const p = this.registry.getPlatformConfig(id);
            return p;
        } catch (error) {
            console.error(`Error getting platform by ID ${id}: ${error}`);
            throw new Error(`Failed to retrieve platform by ID: ${error}`);
        }
    }

    /**
     * Get active platforms only
     * @returns Array of active platforms
     */
    async getActivePlatforms(): Promise<PlatformConfig[]> {
        try {
            return this.registry.getActivePlatforms();
        } catch (error) {
            console.error(`Error getting active platforms: ${error}`);
            throw new Error(`Failed to retrieve active platforms: ${error}`);
        }
    }

    /**
     * Get platforms by country
     * @param country The country to filter by
     * @returns Array of platforms for the specified country
     */
    async getPlatformsByCountry(country: string): Promise<PlatformConfig[]> {
        try {
            return this.registry.getPlatformsByCountry(country);
        } catch (error) {
            console.error(`Error getting platforms by country '${country}': ${error}`);
            throw new Error(`Failed to retrieve platforms by country: ${error}`);
        }
    }

    /**
     * Get platforms by language
     * @param language The language to filter by
     * @returns Array of platforms for the specified language
     */
    async getPlatformsByLanguage(language: string): Promise<PlatformConfig[]> {
        try {
            const all = this.registry.getAllPlatforms();
            return all.filter(platform => platform.language === language);
        } catch (error) {
            console.error(`Error getting platforms by language '${language}': ${error}`);
            throw new Error(`Failed to retrieve platforms by language: ${error}`);
        }
    }

    /**
     * Create a new platform
     * @param platform The platform data to create
     * @returns The ID of the created platform
     */
    async createPlatform(_platform: Partial<PlatformConfig>): Promise<number> {
        try {
            throw new Error('Creating platforms is not supported in read-only TS config mode. Edit files in src/config/platforms.');
        } catch (error) {
            console.error(`Error creating platform: ${error}`);
            throw new Error(`Failed to create platform: ${error}`);
        }
    }

    /**
     * Update a platform
     * @param id The platform ID
     * @param updates The platform updates
     */
    async updatePlatform(id: string, _updates: Partial<PlatformConfig>): Promise<void> {
        const existingPlatform = await this.getPlatformById(id);
        if (!existingPlatform) {
            throw new Error(`Platform with ID ${id} not found`);
        }
        throw new Error('Updating platforms is not supported in read-only TS config mode. Edit files in src/config/platforms.');
    }

    /**
     * Delete a platform
     * @param id The platform ID
     */
    async deletePlatform(id: string): Promise<void> {
        try {
            const existingPlatform = await this.getPlatformById(id);
            if (!existingPlatform) {
                throw new Error(`Platform with ID ${id} not found`);
            }
            throw new Error('Deleting platforms is not supported in read-only TS config mode. Remove the TS file instead.');
        } catch (error) {
            console.error(`Error deleting platform with ID ${id}: ${error}`);
            throw new Error(`Failed to delete platform: ${error}`);
        }
    }

    /**
     * Toggle platform active status
     * @param id The platform ID
     * @returns The new active status
     */
    async togglePlatformStatus(id: string): Promise<boolean> {
        const platform = await this.getPlatformById(id);
        if (!platform) {
            throw new Error(`Platform with ID ${id} not found`);
        }
        throw new Error('Toggling platform status is not supported in read-only TS config mode. Edit the TS file to change is_active.');
    }

    /**
     * Get platform statistics
     * @returns Object with platform statistics
     */
    async getPlatformStatistics(): Promise<{
        total: number;
        active: number;
        inactive: number;
        byCountry: Record<string, number>;
        byLanguage: Record<string, number>;
    }> {
        try {
            const allPlatforms = this.registry.getAllPlatforms();
            const total = allPlatforms.length;
            const active = this.registry.getActivePlatforms().length;
            const inactive = total - active;

            // Group by country
            const byCountry: Record<string, number> = {};
            allPlatforms.forEach(platform => {
                const country = platform.country;
                byCountry[country] = (byCountry[country] || 0) + 1;
            });

            // Group by language
            const byLanguage: Record<string, number> = {};
            allPlatforms.forEach(platform => {
                const language = platform.language;
                byLanguage[language] = (byLanguage[language] || 0) + 1;
            });

            return {
                total,
                active,
                inactive,
                byCountry,
                byLanguage
            };
        } catch (error) {
            console.error(`Error getting platform statistics: ${error}`);
            throw new Error(`Failed to retrieve platform statistics: ${error}`);
        }
    }

    /**
     * Validate platform configuration
     * @param platform The platform to validate
     * @returns Validation result
     */
    validatePlatformConfig(platform: Partial<PlatformConfig>): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];

        if (!platform.name || platform.name.trim().length === 0) {
            errors.push('Platform name is required');
        }

        if (!platform.base_url || platform.base_url.trim().length === 0) {
            errors.push('Base URL is required');
        }

        if (!platform.country || platform.country.trim().length === 0) {
            errors.push('Country is required');
        }

        if (!platform.language || platform.language.trim().length === 0) {
            errors.push('Language is required');
        }

        if (platform.rate_limit !== undefined && platform.rate_limit < 1) {
            errors.push('Rate limit must be at least 1');
        }

        if (platform.delay_between_requests !== undefined && platform.delay_between_requests < 0) {
            errors.push('Delay between requests cannot be negative');
        }

        if (platform.max_concurrent_requests !== undefined && platform.max_concurrent_requests < 1) {
            errors.push('Max concurrent requests must be at least 1');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Get platform status name
     * @param isActive The platform active status
     * @returns String representation of the status
     */
    getPlatformStatusName(isActive: boolean): string {
        return isActive ? "Active" : "Inactive";
    }
}
