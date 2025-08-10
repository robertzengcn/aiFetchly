/**
 * Test for 192.com Platform Adapter
 * This test verifies that the 192ComAdapter works correctly
 */

import { PlatformAdapterFactory } from '@/modules/PlatformAdapterFactory';
import * as Adapter192 from '@/platforms/192ComAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';

export class ComAdapterTest192 {
    private factory: PlatformAdapterFactory;

    constructor() {
        this.factory = new PlatformAdapterFactory();
    }

    /**
     * Test platform configuration loading
     */
    async testPlatformConfiguration(): Promise<void> {
        console.log('🧪 Testing 192.com platform configuration loading...');

        try {
            const platformRegistry = this.factory.getPlatformRegistry();
            const config = platformRegistry.getPlatformConfig('192-com');

            if (!config) {
                throw new Error('192.com configuration not found');
            }

            console.log('✅ Platform configuration loaded:', {
                id: config.id,
                name: config.name,
                base_url: config.base_url,
                type: config.type,
                is_active: config.is_active
            });

            // Validate configuration
            const validation = platformRegistry.validatePlatformConfig(config);
            if (!validation.isValid) {
                throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
            }

            console.log('✅ Platform configuration is valid (score: ' + validation.score + ')');

        } catch (error) {
            console.error('❌ Platform configuration test failed:', error);
            throw error;
        }
    }

    /**
     * Test adapter factory creation
     */
    async testAdapterFactory(): Promise<void> {
        console.log('🧪 Testing 192.com adapter factory creation...');

        try {
            const adapter = await this.factory.createAdapterById('192-com');

            if (!(adapter instanceof (Adapter192 as any)['192ComAdapter'])) {
                throw new Error('Created adapter is not an instance of 192ComAdapter');
            }

            console.log('✅ Adapter created successfully:', {
                platformName: adapter.platformName,
                baseUrl: adapter.baseUrl,
                version: adapter.version
            });

            // Test adapter methods exist
            const requiredMethods = ['searchBusinesses', 'extractBusinessData', 'handlePagination', 'applyCookies'];
            for (const method of requiredMethods) {
                if (typeof adapter[method] !== 'function') {
                    throw new Error(`Required method missing: ${method}`);
                }
            }

            console.log('✅ All required methods are present');

            // Test configuration validation
            const validation = adapter.validateConfig();
            if (!validation.isValid) {
                throw new Error(`Adapter configuration invalid: ${validation.errors.join(', ')}`);
            }

            console.log('✅ Adapter configuration is valid');

        } catch (error) {
            console.error('❌ Adapter factory test failed:', error);
            throw error;
        }
    }

    /**
     * Test adapter configuration methods
     */
    async testAdapterConfiguration(): Promise<void> {
        console.log('🧪 Testing 192.com adapter configuration methods...');

        try {
            const adapter = await this.factory.createAdapterById('192-com');

            // Test rate limiting configuration
            const rateLimiting = adapter.getRateLimitingConfig();
            console.log('✅ Rate limiting config:', rateLimiting);

            // Test authentication configuration
            const authConfig = adapter.getAuthenticationConfig();
            console.log('✅ Authentication config:', authConfig);

            // Test supported features
            const features = adapter.getSupportedFeatures();
            console.log('✅ Supported features:', features);

            // Test platform capabilities
            console.log('✅ Platform capabilities:', {
                supportsAuthentication: adapter.supportsAuthentication(),
                supportsProxy: adapter.supportsProxy(),
                supportsCookies: adapter.supportsCookies()
            });

        } catch (error) {
            console.error('❌ Adapter configuration test failed:', error);
            throw error;
        }
    }

    /**
     * Test URL building functionality
     */
    async testUrlBuilding(): Promise<void> {
        console.log('🧪 Testing 192.com URL building...');

        try {
            const adapter = await this.factory.createAdapterById('192-com');

            const keywords = ['plumber', 'heating'];
            const location = 'Manchester';
            const page = 1;

            const searchUrl = adapter.buildSearchUrl(keywords, location, page);
            console.log('✅ Built search URL:', searchUrl);

            // Validate URL format
            if (!searchUrl.includes('192.com')) {
                throw new Error('Search URL does not contain correct domain');
            }

            if (!searchUrl.includes('plumber') || !searchUrl.includes('heating')) {
                throw new Error('Search URL does not contain keywords');
            }

            if (!searchUrl.includes('Manchester')) {
                throw new Error('Search URL does not contain location');
            }

            console.log('✅ URL building validation passed');

        } catch (error) {
            console.error('❌ URL building test failed:', error);
            throw error;
        }
    }

    /**
     * Test platform statistics
     */
    async testPlatformStatistics(): Promise<void> {
        console.log('🧪 Testing 192.com platform statistics...');

        try {
            const platformRegistry = this.factory.getPlatformRegistry();
            const stats = platformRegistry.getPlatformStatistics();

            console.log('✅ Platform statistics:', {
                totalPlatforms: stats.totalPlatforms,
                activePlatforms: stats.activePlatforms,
                platformsByCountry: stats.platformsByCountry,
                platformsByType: stats.platformsByType
            });

            // Check if UK platforms are included
            const ukPlatforms = platformRegistry.getPlatformsByCountry('UK');
            const platform192 = ukPlatforms.find(p => p.id === '192-com');

            if (!platform192) {
                throw new Error('192.com platform not found in UK platforms');
            }

            console.log('✅ 192.com found in UK platforms');

        } catch (error) {
            console.error('❌ Platform statistics test failed:', error);
            throw error;
        }
    }

    /**
     * Test framework efficiency metrics
     */
    async testFrameworkEfficiency(): Promise<void> {
        console.log('🧪 Testing framework efficiency for 192.com...');

        try {
            const startTime = Date.now();
            
            // Test adapter creation time
            const adapter = await this.factory.createAdapterById('192-com');
            const creationTime = Date.now() - startTime;
            
            console.log('✅ Adapter creation time:', creationTime + 'ms');

            // Test configuration loading time
            const configStartTime = Date.now();
            const platformRegistry = this.factory.getPlatformRegistry();
            const config = platformRegistry.getPlatformConfig('192-com');
            const configLoadTime = Date.now() - configStartTime;
            
            console.log('✅ Configuration loading time:', configLoadTime + 'ms');

            // Test validation time
            const validationStartTime = Date.now();
            const validation = adapter.validateConfig();
            const validationTime = Date.now() - validationStartTime;
            
            console.log('✅ Validation time:', validationTime + 'ms');

            // Efficiency metrics
            const totalTime = creationTime + configLoadTime + validationTime;
            console.log('✅ Total framework overhead:', totalTime + 'ms');

            if (totalTime > 1000) {
                console.warn('⚠️ Framework overhead is high (>1s)');
            } else {
                console.log('✅ Framework efficiency is good');
            }

        } catch (error) {
            console.error('❌ Framework efficiency test failed:', error);
            throw error;
        }
    }

    /**
     * Test UK platform integration
     */
    async testUKPlatformIntegration(): Promise<void> {
        console.log('🧪 Testing UK platform integration...');

        try {
            const platformRegistry = this.factory.getPlatformRegistry();
            
            // Get all UK platforms
            const ukPlatforms = platformRegistry.getPlatformsByCountry('UK');
            console.log('✅ UK platforms found:', ukPlatforms.length);

            // Verify both UK platforms are present
            const yellPlatform = ukPlatforms.find(p => p.id === 'yell-com');
            const platform192 = ukPlatforms.find(p => p.id === '192-com');

            if (!yellPlatform || !platform192) {
                throw new Error('Not all UK platforms are registered');
            }

            console.log('✅ All UK platforms are registered:', {
                yell: yellPlatform.name,
                platform192: platform192.name
            });

            // Test that both adapters can be created
            const yellAdapter = await this.factory.createAdapterById('yell-com');
            const adapter192 = await this.factory.createAdapterById('192-com');

            console.log('✅ Both UK adapters created successfully');

        } catch (error) {
            console.error('❌ UK platform integration test failed:', error);
            throw error;
        }
    }

    /**
     * Run all tests for 192.com adapter
     */
    async runAllTests(): Promise<void> {
        console.log('🚀 Starting 192.com adapter test suite...');
        console.log('=' .repeat(60));

        const tests = [
            this.testPlatformConfiguration.bind(this),
            this.testAdapterFactory.bind(this),
            this.testAdapterConfiguration.bind(this),
            this.testUrlBuilding.bind(this),
            this.testPlatformStatistics.bind(this),
            this.testFrameworkEfficiency.bind(this),
            this.testUKPlatformIntegration.bind(this)
        ];

        let passedTests = 0;
        let totalTests = tests.length;

        for (const test of tests) {
            try {
                await test();
                passedTests++;
                console.log('✅ Test passed');
            } catch (error) {
                console.error('❌ Test failed:', error);
            }
            console.log('-'.repeat(40));
        }

        console.log('=' .repeat(60));
        console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);
        
        if (passedTests === totalTests) {
            console.log('🎉 All 192.com adapter tests passed!');
        } else {
            console.log('⚠️ Some tests failed. Please review the errors above.');
        }
    }
}

// Export for use in other test files
export default ComAdapterTest192;
