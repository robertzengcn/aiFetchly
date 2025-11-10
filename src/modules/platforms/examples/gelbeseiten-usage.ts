import { AdapterGelbeseiten } from '../GelbeseitenAdapter';
import { PlatformConfig } from '@/modules/interface/IPlatformConfig';
import { PlatformAdapterFactory } from '../PlatformAdapterFactory';

/**
 * Example usage of the Gelbeseiten adapter
 * This demonstrates how to create and use the adapter for scraping German business data
 */

// Example 1: Direct instantiation
export function createGelbeseitenAdapterDirectly(): AdapterGelbeseiten {
    const config: PlatformConfig = {
        id: 'gelbeseiten',
        name: 'Gelbeseiten',
        display_name: 'Gelbeseiten.de',
        base_url: 'https://www.gelbeseiten.de',
        country: 'Germany',
        language: 'de',
        is_active: true,
        version: '1.0.0',
        rate_limit: 100,
        delay_between_requests: 1000,
        max_concurrent_requests: 1,
        type: 'class',
        class_name: 'AdapterGelbeseiten'
    };

    return new AdapterGelbeseiten(config);
}

// Example 2: Using the factory pattern
export function createGelbeseitenAdapterViaFactory(): AdapterGelbeseiten {
    const config: PlatformConfig = {
        id: 'gelbeseiten',
        name: 'Gelbeseiten',
        display_name: 'Gelbeseiten.de',
        base_url: 'https://www.gelbeseiten.de',
        country: 'Germany',
        language: 'de',
        is_active: true,
        version: '1.0.0',
        rate_limit: 100,
        delay_between_requests: 1000,
        max_concurrent_requests: 1,
        type: 'class',
        class_name: 'AdapterGelbeseiten'
    };

    return PlatformAdapterFactory.createAdapter('AdapterGelbeseiten', config) as AdapterGelbeseiten;
}

// Example 3: Configuration with custom settings
export function createGelbeseitenAdapterWithCustomSettings(): AdapterGelbeseiten {
    const config: PlatformConfig = {
        id: 'gelbeseiten-custom',
        name: 'Gelbeseiten Custom',
        display_name: 'Gelbeseiten.de (Custom)',
        base_url: 'https://www.gelbeseiten.de',
        country: 'Germany',
        language: 'de',
        is_active: true,
        version: '1.0.0',
        rate_limit: 50, // Lower rate limit for custom usage
        delay_between_requests: 2000, // Higher delay between requests
        max_concurrent_requests: 1,
        type: 'class',
        class_name: 'AdapterGelbeseiten',
        settings: {
            requiresAuthentication: false,
            supportsProxy: true,
            supportsCookies: true,
            searchUrlPattern: 'https://www.gelbeseiten.de/suche/{query}',
            resultUrlPattern: 'https://www.gelbeseiten.de/ergebnisse/{query}',
            custom: {
                max_pages: 10,
                timeout: 15000,
                wait_for_network_idle: true
            }
        },
        metadata: {
            lastUpdated: new Date(),
            version: '1.0.0',
            category: 'business-directory',
            priority: 'high',
            tags: ['german', 'business-directory', 'custom']
        }
    };

    return new AdapterGelbeseiten(config);
}

// Example 4: Batch processing with multiple adapters
export function createMultipleGelbeseitenAdapters(): AdapterGelbeseiten[] {
    const baseConfig: PlatformConfig = {
        id: 'gelbeseiten',
        name: 'Gelbeseiten',
        display_name: 'Gelbeseiten.de',
        base_url: 'https://www.gelbeseiten.de',
        country: 'Germany',
        language: 'de',
        is_active: true,
        version: '1.0.0',
        rate_limit: 100,
        delay_between_requests: 1000,
        max_concurrent_requests: 1,
        type: 'class',
        class_name: 'AdapterGelbeseiten'
    };

    // Create multiple instances with different configurations
    const adapters: AdapterGelbeseiten[] = [];
    
    // Standard adapter
    adapters.push(new AdapterGelbeseiten(baseConfig));
    
    // High-performance adapter (lower delays)
    const highPerfConfig = { ...baseConfig, delay_between_requests: 500 };
    adapters.push(new AdapterGelbeseiten(highPerfConfig));
    
    // Conservative adapter (higher delays, lower rate limit)
    const conservativeConfig = { 
        ...baseConfig, 
        delay_between_requests: 3000, 
        rate_limit: 30 
    };
    adapters.push(new AdapterGelbeseiten(conservativeConfig));

    return adapters;
}

// Example 5: Error handling and validation
export function createGelbeseitenAdapterWithValidation(): AdapterGelbeseiten | null {
    try {
        const config: PlatformConfig = {
            id: 'gelbeseiten',
            name: 'Gelbeseiten',
            display_name: 'Gelbeseiten.de',
            base_url: 'https://www.gelbeseiten.de',
            country: 'Germany',
            language: 'de',
            is_active: true,
            version: '1.0.0',
            rate_limit: 100,
            delay_between_requests: 1000,
            max_concurrent_requests: 1,
            type: 'class',
            class_name: 'AdapterGelbeseiten'
        };

        // Validate configuration
        if (!config.base_url || !config.class_name) {
            throw new Error('Invalid configuration: missing required fields');
        }

        if (config.rate_limit <= 0 || config.delay_between_requests < 0) {
            throw new Error('Invalid configuration: invalid rate limiting values');
        }

        return new AdapterGelbeseiten(config);
    } catch (error) {
        console.error('Failed to create Gelbeseiten adapter:', error);
        return null;
    }
}

// Example 6: Async initialization with retry logic
export async function createGelbeseitenAdapterWithRetry(
    maxRetries: number = 3,
    retryDelay: number = 1000
): Promise<AdapterGelbeseiten> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const config: PlatformConfig = {
                id: 'gelbeseiten',
                name: 'Gelbeseiten',
                display_name: 'Gelbeseiten.de',
                base_url: 'https://www.gelbeseiten.de',
                country: 'Germany',
                language: 'de',
                is_active: true,
                version: '1.0.0',
                rate_limit: 100,
                delay_between_requests: 1000,
                max_concurrent_requests: 1,
                type: 'class',
                class_name: 'AdapterGelbeseiten'
            };

            const adapter = new AdapterGelbeseiten(config);
            console.log(`Gelbeseiten adapter created successfully on attempt ${attempt}`);
            return adapter;
        } catch (error) {
            lastError = error as Error;
            console.warn(`Attempt ${attempt} failed:`, error);
            
            if (attempt < maxRetries) {
                console.log(`Retrying in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    throw new Error(`Failed to create Gelbeseiten adapter after ${maxRetries} attempts. Last error: ${lastError?.message}`);
}
