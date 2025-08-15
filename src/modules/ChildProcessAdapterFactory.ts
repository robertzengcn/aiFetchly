import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';

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
            // Dynamic import of the adapter module
            const module = await import(adapterClassInfo.modulePath);
            
            // Get the adapter class from the module
            const AdapterClass = module[adapterClassInfo.className];
            
            if (!AdapterClass) {
                throw new Error(`Adapter class ${adapterClassInfo.className} not found in module ${adapterClassInfo.modulePath}`);
            }
            
            // Check if it's a valid adapter class
            if (typeof AdapterClass !== 'function') {
                throw new Error(`Exported value ${adapterClassInfo.className} is not a class`);
            }
            
            // Create and return the adapter instance
            return new AdapterClass(platformConfig);
            
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
        try {
            const module = await import(adapterClassInfo.modulePath);
            return typeof module[adapterClassInfo.className] === 'function';
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Get available adapter classes from a module
     * @param modulePath Path to the module
     * @returns Array of available adapter class names
     */
    static async getAvailableAdapters(modulePath: string): Promise<string[]> {
        try {
            const module = await import(modulePath);
            return Object.keys(module).filter(key => 
                typeof module[key] === 'function' && 
                module[key].prototype instanceof BasePlatformAdapter
            );
        } catch (error) {
            console.error(`Failed to get available adapters from ${modulePath}:`, error);
            return [];
        }
    }
}
