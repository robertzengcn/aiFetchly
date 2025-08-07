import { BaseModule } from "@/modules/baseModule";
import { YellowPagesPlatformModel } from "@/model/YellowPagesPlatform.model";

export class YellowPagesInitModule extends BaseModule {
    private platformModel: YellowPagesPlatformModel;

    constructor() {
        super();
        this.platformModel = new YellowPagesPlatformModel(this.dbpath);
    }

    /**
     * Initialize Yellow Pages system with default platforms
     */
    async initializeYellowPagesSystem(): Promise<void> {
        try {
            console.log('Initializing Yellow Pages system...');
            
            // Initialize default platforms
            await this.initializeDefaultPlatforms();
            
            console.log('Yellow Pages system initialization completed');
        } catch (error) {
            console.error('Failed to initialize Yellow Pages system:', error);
            throw error;
        }
    }

    /**
     * Initialize default platforms
     */
    private async initializeDefaultPlatforms(): Promise<void> {
        const defaultPlatforms = [
            {
                name: "yellowpages.com",
                display_name: "Yellow Pages (USA)",
                base_url: "https://www.yellowpages.com",
                country: "USA",
                language: "English",
                type: "configuration",
                rate_limit: 100,
                delay_between_requests: 2000,
                selectors: {
                    businessList: ".result",
                    businessName: ".business-name",
                    phone: ".phone",
                    email: ".email",
                    website: ".website",
                    address: ".address",
                    categories: ".categories",
                    socialMedia: ".social-media",
                    pagination: {
                        nextButton: ".next-page",
                        currentPage: ".current-page",
                        maxPages: ".total-pages"
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: "https://www.yellowpages.com/search?search_terms={keywords}&geo_location_terms={location}",
                    resultUrlPattern: "https://www.yellowpages.com/business/{id}"
                },
                description: "Yellow Pages USA - Business directory and search",
                maintainer: "System",
                documentation: "https://www.yellowpages.com"
            },
            {
                name: "yelp.com",
                display_name: "Yelp (USA)",
                base_url: "https://www.yelp.com",
                country: "USA",
                language: "English",
                type: "configuration",
                rate_limit: 50,
                delay_between_requests: 3000,
                selectors: {
                    businessList: ".business-result",
                    businessName: ".business-name",
                    phone: ".phone",
                    email: ".email",
                    website: ".website",
                    address: ".address",
                    categories: ".categories",
                    socialMedia: ".social-media",
                    pagination: {
                        nextButton: ".next-page",
                        currentPage: ".current-page",
                        maxPages: ".total-pages"
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: "https://www.yelp.com/search?find_desc={keywords}&find_loc={location}",
                    resultUrlPattern: "https://www.yelp.com/biz/{id}"
                },
                description: "Yelp - Business reviews and directory",
                maintainer: "System",
                documentation: "https://www.yelp.com"
            },
            {
                name: "yellowpages.ca",
                display_name: "Yellow Pages (Canada)",
                base_url: "https://www.yellowpages.ca",
                country: "Canada",
                language: "English",
                type: "configuration",
                rate_limit: 80,
                delay_between_requests: 2500,
                selectors: {
                    businessList: ".result",
                    businessName: ".business-name",
                    phone: ".phone",
                    email: ".email",
                    website: ".website",
                    address: ".address",
                    categories: ".categories",
                    socialMedia: ".social-media",
                    pagination: {
                        nextButton: ".next-page",
                        currentPage: ".current-page",
                        maxPages: ".total-pages"
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: "https://www.yellowpages.ca/search/si/{keywords}/{location}",
                    resultUrlPattern: "https://www.yellowpages.ca/bus/{id}"
                },
                description: "Yellow Pages Canada - Business directory",
                maintainer: "System",
                documentation: "https://www.yellowpages.ca"
            }
        ];

        for (const platform of defaultPlatforms) {
            try {
                // Check if platform already exists
                const existingPlatform = await this.platformModel.getPlatformByName(platform.name);
                if (!existingPlatform) {
                    await this.platformModel.saveYellowPagesPlatform(platform);
                    console.log(`Created default platform: ${platform.name}`);
                } else {
                    console.log(`Platform already exists: ${platform.name}`);
                }
            } catch (error) {
                console.error(`Failed to create platform ${platform.name}:`, error);
            }
        }
    }

    /**
     * Check if Yellow Pages system is properly initialized
     */
    async isSystemInitialized(): Promise<boolean> {
        try {
            const activePlatforms = await this.platformModel.getActivePlatforms();
            return activePlatforms.length > 0;
        } catch (error) {
            console.error('Failed to check system initialization:', error);
            return false;
        }
    }

    /**
     * Get system status
     */
    async getSystemStatus(): Promise<{
        initialized: boolean;
        activePlatforms: number;
        totalPlatforms: number;
    }> {
        try {
            const activePlatforms = await this.platformModel.getActivePlatforms();
            const totalPlatforms = await this.platformModel.getPlatformTotal();
            
            return {
                initialized: activePlatforms.length > 0,
                activePlatforms: activePlatforms.length,
                totalPlatforms
            };
        } catch (error) {
            console.error('Failed to get system status:', error);
            return {
                initialized: false,
                activePlatforms: 0,
                totalPlatforms: 0
            };
        }
    }
} 