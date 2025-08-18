import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { IBasePlatformAdapter } from '@/interfaces/IBasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { PlatformAdapterFactory } from './platforms';

/**
 * Factory class for creating platform adapters in child processes
 * This allows child processes to dynamically load and use adapter classes
 */
export class ChildProcessAdapterFactory {
    
    /**
     * Create an adapter instance from class information
     * @param adapterClassInfo Information about the adapter class
     * @param platformConfig Platform configuration
     * @returns Platform adapter instance
     */
    static async createAdapter(
        adapterClassInfo: { className: string; modulePath: string },
        platformConfig: PlatformConfig
    ): Promise<BasePlatformAdapter> {
        try {
            console.log(adapterClassInfo);
            
            // Use the factory method instead of dynamic import
            if (!PlatformAdapterFactory.isAdapterAvailable(adapterClassInfo.className)) {
                throw new Error(`Adapter class ${adapterClassInfo.className} is not available`);
            }
            
            // Create and return the adapter instance using the factory
            return PlatformAdapterFactory.createAdapter(adapterClassInfo.className, platformConfig);
            
        } catch (error) {
            console.error(`Failed to create adapter ${adapterClassInfo.className}:`, error);
            throw new Error(`Failed to create adapter: ${error}`);
        }
    }
    
    /**
     * Check if an adapter class is available
     * @param adapterClassInfo Information about the adapter class
     * @returns True if the adapter class is available
     */
    static async isAdapterAvailable(adapterClassInfo: { className: string; modulePath: string }): Promise<boolean> {
        return PlatformAdapterFactory.isAdapterAvailable(adapterClassInfo.className);
    }
    
    /**
     * Get available adapter classes from a module
     * @param modulePath Path to the module (kept for backward compatibility)
     * @returns Array of available adapter class names
     */
    static async getAvailableAdapters(modulePath: string): Promise<string[]> {
        // Return all available adapters from the factory
        return PlatformAdapterFactory.getAvailableAdapters();
    }
}
