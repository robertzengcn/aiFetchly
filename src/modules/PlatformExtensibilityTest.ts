import { PlatformRegistry } from '@/modules/PlatformRegistry';
import { UnifiedPlatformFactory } from '@/modules/UnifiedPlatformFactory';
import { PlatformConfig, PlatformType, PlatformFeature } from '@/interfaces/IPlatformConfig';
import { IBasePlatformAdapter } from '@/interfaces/IBasePlatformAdapter';
import { BaseModule } from '@/modules/baseModule';

/**
 * Comprehensive test module for the unified platform extensibility framework.
 * This module demonstrates and validates all three platform types:
 * - Configuration-only platforms
 * - Class-based platforms
 * - Hybrid platforms
 * 
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export class PlatformExtensibilityTest extends BaseModule {
    private platformRegistry: PlatformRegistry;
    private platformFactory: UnifiedPlatformFactory;

    constructor() {
        super();
        this.platformRegistry = new PlatformRegistry();
        this.platformFactory = new UnifiedPlatformFactory();
    }

    /**
     * Run comprehensive tests for the platform extensibility framework
     */
    async runComprehensiveTests(): Promise<{
        success: boolean;
        results: {
            configurationTest: TestResult;
            classBasedTest: TestResult;
            hybridTest: TestResult;
            integrationTest: TestResult;
        };
        summary: string;
    }> {
        console.log('Starting comprehensive platform extensibility framework tests...');

        try {
            // Platform registry is ready to use without initialization
            await this.platformFactory.initialize();

            // Run individual tests
            const configurationTest = await this.testConfigurationOnlyPlatform();
            const classBasedTest = await this.testClassBasedPlatform();
            const hybridTest = await this.testHybridPlatform();
            const integrationTest = await this.testIntegration();

            const results = {
                configurationTest,
                classBasedTest,
                hybridTest,
                integrationTest
            };

            // Determine overall success
            const success = Object.values(results).every(result => result.success);

            const summary = this.generateTestSummary(results);

            console.log('Comprehensive tests completed:', { success, summary });

            return {
                success,
                results,
                summary
            };

        } catch (error) {
            console.error('Comprehensive tests failed:', error);
            return {
                success: false,
                results: {
                    configurationTest: { success: false, message: 'Tests failed to start' },
                    classBasedTest: { success: false, message: 'Tests failed to start' },
                    hybridTest: { success: false, message: 'Tests failed to start' },
                    integrationTest: { success: false, message: 'Tests failed to start' }
                },
                summary: 'Tests failed to start due to initialization error'
            };
        }
    }

    /**
     * Test configuration-only platform
     */
    private async testConfigurationOnlyPlatform(): Promise<TestResult> {
        try {
            console.log('Testing configuration-only platform...');

            // Create test configuration
            const config: PlatformConfig = {
                id: 'test-configuration-platform',
                name: 'Test Configuration Platform',
                display_name: 'Test Configuration Platform',
                base_url: 'https://test-configuration-platform.com',
                country: 'Test Country',
                language: 'en',
                is_active: true,
                version: '1.0.0',
                rate_limit: 100,
                delay_between_requests: 2000,
                max_concurrent_requests: 1,
                type: 'configuration',
                selectors: {
                    businessList: '.business-item',
                    businessName: '.business-name',
                    phone: '.phone-number',
                    email: '.email-address',
                    website: '.website-link',
                    address: '.address',
                    categories: '.categories',
                    socialMedia: '.social-links',
                    pagination: {
                        nextButton: '.next-page',
                        currentPage: '.current-page',
                        maxPages: '.total-pages'
                    }
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://test-configuration-platform.com/search?q={keywords}&location={location}&page={page}',
                    resultUrlPattern: 'https://test-configuration-platform.com/business/{id}',
                    supportedFeatures: [PlatformFeature.SEARCH, PlatformFeature.PAGINATION]
                },
                metadata: {
                    lastUpdated: new Date(),
                    version: '1.0.0',
                    category: 'Test',
                    tags: ['test', 'configuration'],
                    statistics: {
                        totalBusinesses: 0,
                        lastScraped: new Date(),
                        successRate: 0
                    }
                },
                description: 'Test configuration-only platform',
                maintainer: 'Test Team',
                documentation: 'https://test-docs.com'
            };

            // Register platform
            await this.platformRegistry.registerPlatform(config);

            // Create adapter
            const adapter = await this.platformFactory.createAdapter(config);

            // Validate adapter
            const validation = this.validateAdapter(adapter, config);

            // Test adapter functionality
            const functionalityTest = await this.testAdapterFunctionality(adapter);

            const success = validation.success && functionalityTest.success;

            return {
                success,
                message: success ? 'Configuration-only platform test passed' : 'Configuration-only platform test failed',
                details: {
                    validation,
                    functionalityTest
                }
            };

        } catch (error) {
            console.error('Configuration-only platform test failed:', error);
            return {
                success: false,
                message: `Configuration-only platform test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Test class-based platform
     */
    private async testClassBasedPlatform(): Promise<TestResult> {
        try {
            console.log('Testing class-based platform...');

            // Create test configuration
            const config: PlatformConfig = {
                id: 'test-class-based-platform',
                name: 'Test Class-Based Platform',
                display_name: 'Test Class-Based Platform',
                base_url: 'https://test-class-based-platform.com',
                country: 'Test Country',
                language: 'en',
                is_active: true,
                version: '1.0.0',
                rate_limit: 50,
                delay_between_requests: 3000,
                max_concurrent_requests: 1,
                type: 'class',
                class_name: 'ExampleClassBasedAdapter',
                module_path: './platforms/ExampleClassBasedAdapter',
                selectors: {
                    businessList: '.business-item',
                    businessName: '.business-name'
                },
                settings: {
                    requiresAuthentication: true,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://test-class-based-platform.com/search?q={keywords}&location={location}&page={page}',
                    resultUrlPattern: 'https://test-class-based-platform.com/business/{id}',
                    supportedFeatures: [PlatformFeature.SEARCH, PlatformFeature.PAGINATION, PlatformFeature.AUTHENTICATION, PlatformFeature.REVIEWS, PlatformFeature.RATINGS]
                },
                metadata: {
                    lastUpdated: new Date(),
                    version: '1.0.0',
                    category: 'Test',
                    tags: ['test', 'class-based'],
                    statistics: {
                        totalBusinesses: 0,
                        lastScraped: new Date(),
                        successRate: 0
                    }
                },
                description: 'Test class-based platform',
                maintainer: 'Test Team',
                documentation: 'https://test-docs.com'
            };

            // Register platform
            await this.platformRegistry.registerPlatform(config);

            // Create adapter
            const adapter = await this.platformFactory.createAdapter(config);

            // Validate adapter
            const validation = this.validateAdapter(adapter, config);

            // Test adapter functionality
            const functionalityTest = await this.testAdapterFunctionality(adapter);

            const success = validation.success && functionalityTest.success;

            return {
                success,
                message: success ? 'Class-based platform test passed' : 'Class-based platform test failed',
                details: {
                    validation,
                    functionalityTest
                }
            };

        } catch (error) {
            console.error('Class-based platform test failed:', error);
            return {
                success: false,
                message: `Class-based platform test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Test hybrid platform
     */
    private async testHybridPlatform(): Promise<TestResult> {
        try {
            console.log('Testing hybrid platform...');

            // Create test configuration
            const config: PlatformConfig = {
                id: 'test-hybrid-platform',
                name: 'Test Hybrid Platform',
                display_name: 'Test Hybrid Platform',
                base_url: 'https://test-hybrid-platform.com',
                country: 'Test Country',
                language: 'en',
                is_active: true,
                version: '1.0.0',
                rate_limit: 75,
                delay_between_requests: 2500,
                max_concurrent_requests: 1,
                type: 'hybrid',
                class_name: 'ExampleHybridAdapter',
                module_path: './platforms/ExampleHybridAdapter',
                selectors: {
                    businessList: '.business-item',
                    businessName: '.business-name',
                    phone: '.phone-number',
                    email: '.email-address'
                },
                custom_extractors: {
                    extractBusinessHours: 'customBusinessHoursExtractor',
                    extractRating: 'customRatingExtractor'
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://test-hybrid-platform.com/search?q={keywords}&location={location}&page={page}',
                    resultUrlPattern: 'https://test-hybrid-platform.com/business/{id}',
                    supportedFeatures: [PlatformFeature.SEARCH, PlatformFeature.PAGINATION]
                },
                metadata: {
                    lastUpdated: new Date(),
                    version: '1.0.0',
                    category: 'Test',
                    tags: ['test', 'hybrid'],
                    statistics: {
                        totalBusinesses: 0,
                        lastScraped: new Date(),
                        successRate: 0
                    }
                },
                description: 'Test hybrid platform',
                maintainer: 'Test Team',
                documentation: 'https://test-docs.com'
            };

            // Register platform
            await this.platformRegistry.registerPlatform(config);

            // Create adapter
            const adapter = await this.platformFactory.createAdapter(config);

            // Validate adapter
            const validation = this.validateAdapter(adapter, config);

            // Test adapter functionality
            const functionalityTest = await this.testAdapterFunctionality(adapter);

            const success = validation.success && functionalityTest.success;

            return {
                success,
                message: success ? 'Hybrid platform test passed' : 'Hybrid platform test failed',
                details: {
                    validation,
                    functionalityTest
                }
            };

        } catch (error) {
            console.error('Hybrid platform test failed:', error);
            return {
                success: false,
                message: `Hybrid platform test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Test integration between components
     */
    private async testIntegration(): Promise<TestResult> {
        try {
            console.log('Testing integration between components...');

            // Test platform registry functionality
            const registryTest = await this.testPlatformRegistry();

            // Test platform factory functionality
            const factoryTest = await this.testPlatformFactory();

            // Test dynamic loading
            const dynamicLoadingTest = await this.testDynamicLoading();

            const success = registryTest.success && factoryTest.success && dynamicLoadingTest.success;

            return {
                success,
                message: success ? 'Integration test passed' : 'Integration test failed',
                details: {
                    registryTest,
                    factoryTest,
                    dynamicLoadingTest
                }
            };

        } catch (error) {
            console.error('Integration test failed:', error);
            return {
                success: false,
                message: `Integration test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Test platform registry functionality
     */
    private async testPlatformRegistry(): Promise<TestResult> {
        try {
            // Test platform registration
            const platforms = this.platformRegistry.getAllPlatforms();
            const activePlatforms = this.platformRegistry.getActivePlatforms();
            const platformCount = this.platformRegistry.getAllPlatforms().length;

            // Test platform retrieval
            const testPlatform = this.platformRegistry.getPlatformConfig('test-configuration-platform');
            const hasPlatform = this.platformRegistry.hasPlatform('test-configuration-platform');

            const success = platforms.length > 0 && activePlatforms.length > 0 && 
                          platformCount > 0 && testPlatform !== null && hasPlatform;

            return {
                success,
                message: success ? 'Platform registry test passed' : 'Platform registry test failed',
                details: {
                    totalPlatforms: platforms.length,
                    activePlatforms: activePlatforms.length,
                    platformCount,
                    testPlatformFound: testPlatform !== null,
                    hasPlatform
                }
            };

        } catch (error) {
            return {
                success: false,
                message: `Platform registry test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Test platform factory functionality
     */
    private async testPlatformFactory(): Promise<TestResult> {
        try {
            // Test adapter creation
            const config = this.platformRegistry.getPlatformConfig('test-configuration-platform');
            if (!config) {
                throw new Error('Test platform configuration not found');
            }

            const adapter = await this.platformFactory.createAdapter(config);
            const hasAdapter = this.platformFactory.hasAdapter(config.id);
            const supportedPlatforms = this.platformFactory.getSupportedPlatforms();

            const success = adapter !== null && hasAdapter && supportedPlatforms.length > 0;

            return {
                success,
                message: success ? 'Platform factory test passed' : 'Platform factory test failed',
                details: {
                    adapterCreated: adapter !== null,
                    hasAdapter,
                    supportedPlatformsCount: supportedPlatforms.length
                }
            };

        } catch (error) {
            return {
                success: false,
                message: `Platform factory test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Test dynamic loading functionality
     */
    private async testDynamicLoading(): Promise<TestResult> {
        try {
            // Test that adapters can be created dynamically
            const configs = this.platformRegistry.getAllPlatforms();
            const adapters: IBasePlatformAdapter[] = [];

            for (const config of configs) {
                const adapter = await this.platformFactory.createAdapter(config);
                adapters.push(adapter);
            }

            const success = adapters.length === configs.length && 
                          adapters.every(adapter => adapter !== null);

            return {
                success,
                message: success ? 'Dynamic loading test passed' : 'Dynamic loading test failed',
                details: {
                    configsCount: configs.length,
                    adaptersCreated: adapters.length,
                    allAdaptersValid: adapters.every(adapter => adapter !== null)
                }
            };

        } catch (error) {
            return {
                success: false,
                message: `Dynamic loading test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Validate adapter against configuration
     */
    private validateAdapter(adapter: IBasePlatformAdapter, config: PlatformConfig): TestResult {
        try {
            const errors: string[] = [];

            // Check basic properties
            if (adapter.platformName !== config.name) {
                errors.push(`Platform name mismatch: expected ${config.name}, got ${adapter.platformName}`);
            }

            if (adapter.baseUrl !== config.base_url) {
                errors.push(`Base URL mismatch: expected ${config.base_url}, got ${adapter.baseUrl}`);
            }

            if (adapter.version !== config.version) {
                errors.push(`Version mismatch: expected ${config.version}, got ${adapter.version}`);
            }

            // Check configuration
            if (adapter.config.id !== config.id) {
                errors.push(`Config ID mismatch: expected ${config.id}, got ${adapter.config.id}`);
            }

            // Test method availability
            const requiredMethods = [
                'searchBusinesses', 'extractBusinessData', 'handlePagination',
                'applyCookies', 'getSelectors', 'getRateLimitingConfig',
                'getAuthenticationConfig', 'supportsAuthentication', 'supportsProxy',
                'supportsCookies', 'getSupportedFeatures', 'buildSearchUrl', 'validateConfig'
            ];

            for (const method of requiredMethods) {
                if (typeof (adapter as any)[method] !== 'function') {
                    errors.push(`Missing required method: ${method}`);
                }
            }

            const success = errors.length === 0;

            return {
                success,
                message: success ? 'Adapter validation passed' : 'Adapter validation failed',
                details: {
                    errors,
                    errorsCount: errors.length
                }
            };

        } catch (error) {
            return {
                success: false,
                message: `Adapter validation failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Test adapter functionality
     */
    private async testAdapterFunctionality(adapter: IBasePlatformAdapter): Promise<TestResult> {
        try {
            const errors: string[] = [];

            // Test getSelectors
            try {
                const selectors = adapter.getSelectors();
                if (!selectors) {
                    errors.push('getSelectors returned null or undefined');
                }
            } catch (error) {
                errors.push(`getSelectors failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Test getRateLimitingConfig
            try {
                const rateLimitConfig = adapter.getRateLimitingConfig();
                if (!rateLimitConfig) {
                    errors.push('getRateLimitingConfig returned null or undefined');
                }
            } catch (error) {
                errors.push(`getRateLimitingConfig failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Test getAuthenticationConfig
            try {
                const authConfig = adapter.getAuthenticationConfig();
                if (!authConfig) {
                    errors.push('getAuthenticationConfig returned null or undefined');
                }
            } catch (error) {
                errors.push(`getAuthenticationConfig failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Test buildSearchUrl
            try {
                const searchUrl = adapter.buildSearchUrl(['test'], 'test location', 1);
                if (!searchUrl || typeof searchUrl !== 'string') {
                    errors.push('buildSearchUrl returned invalid URL');
                }
            } catch (error) {
                errors.push(`buildSearchUrl failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Test validateConfig
            try {
                const validation = adapter.validateConfig();
                if (!validation || typeof validation.isValid !== 'boolean') {
                    errors.push('validateConfig returned invalid result');
                }
            } catch (error) {
                errors.push(`validateConfig failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            const success = errors.length === 0;

            return {
                success,
                message: success ? 'Adapter functionality test passed' : 'Adapter functionality test failed',
                details: {
                    errors,
                    errorsCount: errors.length
                }
            };

        } catch (error) {
            return {
                success: false,
                message: `Adapter functionality test failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Generate test summary
     */
    private generateTestSummary(results: any): string {
        const totalTests = Object.keys(results).length;
        const passedTests = Object.values(results).filter((result: any) => result.success).length;
        const failedTests = totalTests - passedTests;

        return `Test Summary: ${passedTests}/${totalTests} tests passed. ${failedTests} tests failed.`;
    }
}

/**
 * Test result interface
 */
interface TestResult {
    success: boolean;
    message: string;
    details?: any;
} 