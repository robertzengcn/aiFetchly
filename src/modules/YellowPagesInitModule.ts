import { BaseModule } from "@/modules/baseModule";
import { PlatformRegistry } from "@/modules/PlatformRegistry";

export class YellowPagesInitModule extends BaseModule {
    private platformRegistry: PlatformRegistry;

    constructor() {
        super();
        this.platformRegistry = new PlatformRegistry();
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
        // No-op: platforms are defined in TS configs and loaded by PlatformRegistry
        return;
    }

    /**
     * Check if Yellow Pages system is properly initialized
     */
    async isSystemInitialized(): Promise<boolean> {
        try {
            return this.platformRegistry.getActivePlatforms().length > 0;
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
            const activePlatforms = this.platformRegistry.getActivePlatforms();
            const totalPlatforms = this.platformRegistry.getAllPlatforms().length;
            
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