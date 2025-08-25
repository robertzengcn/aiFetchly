import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { IBasePlatformAdapter } from '@/interfaces/IBasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';
import { ExampleHybridAdapter } from './ExampleHybridAdapter';
import { ComAdapter192 } from './192ComAdapter';
import { YellComAdapter } from './YellComAdapter';
import { YellowPagesComAdapter } from './YellowPagesComAdapter';
import { YelpComAdapter } from './YelpComAdapter';
import { YellowPagesCaAdapter } from './YellowPagesCaAdapter';
import { ExampleClassBasedAdapter } from './ExampleClassBasedAdapter';
import { Adapter11880 } from './11880Adapter';

/**
 * Factory class for creating platform adapters
 * This avoids dynamic imports in child processes by using direct class references
 */
export class PlatformAdapterFactory {
    
    /**
     * Create an adapter instance by class name
     * @param className The name of the adapter class
     * @param platformConfig Platform configuration
     * @returns Platform adapter instance
     */
    static createAdapter(className: string, platformConfig: PlatformConfig): BasePlatformAdapter {
        switch (className) {
            case 'ExampleHybridAdapter':
                return new ExampleHybridAdapter(platformConfig) as unknown as BasePlatformAdapter;
                
            case 'ComAdapter192':
                return new ComAdapter192(platformConfig);
                
            case 'YellComAdapter':
                return new YellComAdapter(platformConfig);
                
            case 'YellowPagesComAdapter':
                return new YellowPagesComAdapter(platformConfig);
                
            case 'YelpComAdapter':
                return new YelpComAdapter(platformConfig);
                
            case 'YellowPagesCaAdapter':
                return new YellowPagesCaAdapter(platformConfig);
                
            case 'ExampleClassBasedAdapter':
                return new ExampleClassBasedAdapter(platformConfig) as unknown as BasePlatformAdapter;
                
            case 'Adapter11880':
                return new Adapter11880(platformConfig);
                
            default:
                throw new Error(`Unknown adapter class: ${className}. Available classes: ${PlatformAdapterFactory.getAvailableAdapters().join(', ')}`);
        }
    }
    
    /**
     * Check if an adapter class is available
     * @param className The name of the adapter class
     * @returns True if the adapter class is available
     */
    static isAdapterAvailable(className: string): boolean {
        const availableClasses = [
            'ExampleHybridAdapter',
            'ComAdapter192',
            'YellComAdapter',
            'YellowPagesComAdapter',
            'YelpComAdapter',
            'YellowPagesCaAdapter',
            'ExampleClassBasedAdapter',
            'Adapter11880'
        ];
        return availableClasses.includes(className);
    }
    
    /**
     * Get all available adapter class names
     * @returns Array of available adapter class names
     */
    static getAvailableAdapters(): string[] {
        return [
            'ExampleHybridAdapter',
            'ComAdapter192',
            'YellComAdapter',
            'YellowPagesComAdapter',
            'YelpComAdapter',
            'YellowPagesCaAdapter',
            'ExampleClassBasedAdapter',
            'Adapter11880'
        ];
    }
    
    /**
     * Get adapter class constructor by name
     * @param className The name of the adapter class
     * @returns The adapter class constructor
     */
    static getAdapterClass(className: string): new (config: PlatformConfig) => BasePlatformAdapter {
        switch (className) {
            case 'ExampleHybridAdapter':
                return ExampleHybridAdapter as unknown as new (config: PlatformConfig) => BasePlatformAdapter;
                
            case 'ComAdapter192':
                return ComAdapter192;
                
            case 'YellComAdapter':
                return YellComAdapter;
                
            case 'YellowPagesComAdapter':
                return YellowPagesComAdapter;
                
            case 'YelpComAdapter':
                return YelpComAdapter;
                
            case 'YellowPagesCaAdapter':
                return YellowPagesCaAdapter;
                
            case 'ExampleClassBasedAdapter':
                return ExampleClassBasedAdapter as unknown as new (config: PlatformConfig) => BasePlatformAdapter;
                
            case 'Adapter11880':
                return Adapter11880;
                
            default:
                throw new Error(`Unknown adapter class: ${className}. Available classes: ${PlatformAdapterFactory.getAvailableAdapters().join(', ')}`);
        }
    }
}
