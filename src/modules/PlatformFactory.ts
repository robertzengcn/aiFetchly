import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';

/**
 * Factory class for creating platform adapters
 * Supports both direct class instantiation and dynamic imports
 */
export class PlatformFactory {
    /**
     * Create a platform adapter instance
     * @param config Platform configuration
     * @returns Platform adapter instance
     */
    static createAdapter(config: PlatformConfig): BasePlatformAdapter {
        if (config.adapter_class) {
            // Direct class instantiation (recommended approach)
            return new config.adapter_class(config);
        } else if (config.module_path) {
            // Fallback to dynamic import (legacy support)
            throw new Error(`Dynamic imports not supported for ${config.id}. Use adapter_class instead.`);
        } else {
            throw new Error(`Platform ${config.id} must specify either adapter_class or module_path`);
        }
    }

    /**
     * Check if a platform configuration supports direct class loading
     * @param config Platform configuration
     * @returns True if the platform supports direct class loading
     */
    static supportsDirectLoading(config: PlatformConfig): boolean {
        return config.adapter_class !== undefined;
    }

    /**
     * Get the adapter class constructor for a platform
     * @param config Platform configuration
     * @returns Adapter class constructor or undefined
     */
    static getAdapterClass(config: PlatformConfig): (new (config: PlatformConfig) => BasePlatformAdapter) | undefined {
        return config.adapter_class;
    }
}
