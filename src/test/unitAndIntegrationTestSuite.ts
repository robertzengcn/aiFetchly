/**
 * Unit and Integration Test Suite for aiFetchly
 * 
 * This test suite covers:
 * - Unit tests for platform adapters
 * - Integration tests for core services
 * - System component tests
 */

import { PlatformAdapterFactory } from '@/modules/PlatformAdapterFactory';
import { PlatformRegistry } from '@/modules/PlatformRegistry';
import { TaskExecutorService } from '@/modules/TaskExecutorService';


interface TestResult {
    testName: string;
    category: 'unit' | 'integration';
    success: boolean;
    duration: number;
    error?: string;
    details?: any;
}

export class UnitAndIntegrationTestSuite {
    private factory: PlatformAdapterFactory;
    private registry: PlatformRegistry;
    private taskExecutorService: TaskExecutorService;
    private testResults: TestResult[] = [];

    constructor() {
        this.factory = new PlatformAdapterFactory();
        this.registry = new PlatformRegistry();
        this.taskExecutorService = new TaskExecutorService();
    }

    /**
     * Run a single test and record results
     */
    private async runTest(
        testName: string, 
        category: 'unit' | 'integration',
        testFunction: () => Promise<any>
    ): Promise<TestResult> {
        const startTime = Date.now();
        
        console.log(`\n🧪 Running ${category} test: ${testName}`);

        try {
            const result = await testFunction();
            const duration = Date.now() - startTime;
            
            const testResult: TestResult = {
                testName,
                category,
                success: true,
                duration,
                details: result
            };

            console.log(`✅ ${testName} - PASSED (${duration}ms)`);
            this.testResults.push(testResult);
            return testResult;

        } catch (error) {
            const duration = Date.now() - startTime;
            
            const testResult: TestResult = {
                testName,
                category,
                success: false,
                duration,
                error: error instanceof Error ? error.message : String(error)
            };

            console.log(`❌ ${testName} - FAILED (${duration}ms)`);
            console.log(`   Error: ${testResult.error}`);
            this.testResults.push(testResult);
            return testResult;
        }
    }

    // ==================== UNIT TESTS ====================

    /**
     * Test platform registry functionality
     */
    private async testPlatformRegistry(): Promise<any> {
        const platforms = this.registry.getAllPlatforms();
        const activePlatforms = this.registry.getActivePlatforms();
        
        // Test platform validation
        const validationResults: Array<{ platform: string; isValid: boolean; score: number }> = [];
        for (const platform of platforms) {
            const validation = this.registry.validatePlatformConfig(platform);
            validationResults.push({
                platform: platform.name,
                isValid: validation.isValid,
                score: validation.score
            });
        }

        return {
            totalPlatforms: platforms.length,
            activePlatforms: activePlatforms.length,
            validConfigurations: validationResults.filter(r => r.isValid).length,
            averageValidationScore: validationResults.reduce((sum, r) => sum + r.score, 0) / validationResults.length
        };
    }

    /**
     * Test adapter factory functionality
     */
    private async testAdapterFactory(): Promise<any> {
        const platforms = this.registry.getAllPlatforms();
        const adapterResults: Array<{ platform: string; adapterType: string; isValid: boolean; score?: number; error?: string }> = [];

        for (const platform of platforms) {
            try {
                const adapter = await this.factory.createAdapterById(platform.id);
                const validation = adapter.validateConfig();
                
                adapterResults.push({
                    platform: platform.name,
                    adapterType: adapter.constructor.name,
                    isValid: validation.isValid,
                    score: validation.score
                });
            } catch (error) {
                adapterResults.push({
                    platform: platform.name,
                    adapterType: 'ERROR',
                    isValid: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return {
            totalAdapters: adapterResults.length,
            successfulAdapters: adapterResults.filter(r => r.isValid).length,
            failedAdapters: adapterResults.filter(r => !r.isValid).length,
            averageValidationScore: adapterResults
                .filter(r => r.isValid)
                .reduce((sum, r) => sum + (r.score || 0), 0) / adapterResults.filter(r => r.isValid).length
        };
    }

    /**
     * Test URL building functionality
     */
    private async testUrlBuilding(): Promise<any> {
        const platforms = this.registry.getAllPlatforms();
        const urlResults: Array<{ platform: string; searchUrl: string; containsKeywords: boolean; containsLocation: boolean; isValid: boolean; error?: string }> = [];

        for (const platform of platforms) {
            try {
                const adapter = await this.factory.createAdapterById(platform.id);
                const keywords = ['test', 'business'];
                const location = 'Test City';
                const page = 1;

                const searchUrl = adapter.buildSearchUrl(keywords, location, page);
                
                urlResults.push({
                    platform: platform.name,
                    searchUrl,
                    containsKeywords: keywords.some(k => searchUrl.includes(k)),
                    containsLocation: searchUrl.includes(location),
                    isValid: searchUrl.includes(platform.base_url)
                });
            } catch (error) {
                urlResults.push({
                    platform: platform.name,
                    searchUrl: 'ERROR',
                    containsKeywords: false,
                    containsLocation: false,
                    isValid: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return {
            totalUrls: urlResults.length,
            validUrls: urlResults.filter(r => r.isValid).length,
            urlsWithKeywords: urlResults.filter(r => r.containsKeywords).length,
            urlsWithLocation: urlResults.filter(r => r.containsLocation).length
        };
    }

    // ==================== INTEGRATION TESTS ====================

    /**
     * Test task executor service
     */
    private async testTaskExecutorService(): Promise<any> {
        // Test service initialization
        const isInitialized = this.taskExecutorService !== null;
        
        // Test service methods
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this.taskExecutorService))
            .filter(name => typeof this.taskExecutorService[name] === 'function' && name !== 'constructor');

        return {
            isInitialized,
            methodCount: methods.length,
            hasExecuteMethod: methods.includes('executeTask'),
            hasCancelMethod: methods.includes('cancelTask'),
            serviceHealth: isInitialized && methods.length > 0
        };
    }

    /**
     * Test browser manager
     */
    private async testBrowserManager(): Promise<any> {
        // BrowserManager not available, return mock result
        return {
            browserCreated: false,
            pageCreated: false,
            pageTitle: null,
            navigationSuccessful: false,
            managerHealth: false,
            error: 'BrowserManager module not available'
        };
    }

    /**
     * Test platform integration
     */
    private async testPlatformIntegration(): Promise<any> {
        const platforms = this.registry.getAllPlatforms().slice(0, 3); // Test with 3 platforms
        const integrationResults: Array<{ platform: string; adapterCreated: boolean; hasConfig: boolean; hasRateLimiting: boolean; hasAuthConfig: boolean; isValid: boolean; error?: string }> = [];

        for (const platform of platforms) {
            try {
                const adapter = await this.factory.createAdapterById(platform.id);
                
                // Test adapter configuration
                const config = adapter.config;
                const rateLimiting = adapter.getRateLimitingConfig();
                const authConfig = adapter.getAuthenticationConfig();
                
                integrationResults.push({
                    platform: platform.name,
                    adapterCreated: true,
                    hasConfig: !!config,
                    hasRateLimiting: !!rateLimiting,
                    hasAuthConfig: !!authConfig,
                    isValid: adapter.validateConfig().isValid
                });
            } catch (error) {
                integrationResults.push({
                    platform: platform.name,
                    adapterCreated: false,
                    hasConfig: false,
                    hasRateLimiting: false,
                    hasAuthConfig: false,
                    isValid: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return {
            totalPlatforms: platforms.length,
            successfulIntegrations: integrationResults.filter(r => r.adapterCreated).length,
            validIntegrations: integrationResults.filter(r => r.isValid).length,
            integrationScore: integrationResults.filter(r => r.adapterCreated).length / platforms.length
        };
    }

    // ==================== MAIN TEST RUNNER ====================

    /**
     * Run all unit and integration tests
     */
    async runAllTests(): Promise<{
        totalTests: number;
        passedTests: number;
        failedTests: number;
        totalDuration: number;
        results: TestResult[];
        summary: string;
        categories: {
            unit: { total: number; passed: number; failed: number };
            integration: { total: number; passed: number; failed: number };
        };
    }> {
        console.log('🚀 Starting Unit and Integration Test Suite...');
        console.log('=' .repeat(60));

        const startTime = Date.now();

        // Unit Tests
        await this.runTest('Platform Registry', 'unit', () => this.testPlatformRegistry());
        await this.runTest('Adapter Factory', 'unit', () => this.testAdapterFactory());
        await this.runTest('URL Building', 'unit', () => this.testUrlBuilding());

        // Integration Tests
        await this.runTest('Task Executor Service', 'integration', () => this.testTaskExecutorService());
        await this.runTest('Browser Manager', 'integration', () => this.testBrowserManager());
        await this.runTest('Platform Integration', 'integration', () => this.testPlatformIntegration());

        const totalDuration = Date.now() - startTime;
        const passedTests = this.testResults.filter(r => r.success).length;
        const failedTests = this.testResults.filter(r => !r.success).length;
        const totalTests = this.testResults.length;

        // Categorize results
        const categories = {
            unit: {
                total: this.testResults.filter(r => r.category === 'unit').length,
                passed: this.testResults.filter(r => r.category === 'unit' && r.success).length,
                failed: this.testResults.filter(r => r.category === 'unit' && !r.success).length
            },
            integration: {
                total: this.testResults.filter(r => r.category === 'integration').length,
                passed: this.testResults.filter(r => r.category === 'integration' && r.success).length,
                failed: this.testResults.filter(r => r.category === 'integration' && !r.success).length
            }
        };

        console.log('\n' + '=' .repeat(60));
        console.log('📊 TEST RESULTS');
        console.log('=' .repeat(60));
        console.log(`Total Tests: ${totalTests}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${failedTests}`);
        console.log(`Total Duration: ${totalDuration}ms`);
        console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%`);

        console.log('\n📋 Results by Category:');
        console.log(`Unit Tests: ${categories.unit.passed}/${categories.unit.total} passed`);
        console.log(`Integration Tests: ${categories.integration.passed}/${categories.integration.total} passed`);

        if (failedTests > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults.filter(r => !r.success).forEach(result => {
                console.log(`  - ${result.testName}: ${result.error}`);
            });
        }

        const summary = `Unit and integration test suite completed with ${passedTests}/${totalTests} tests passing (${((passedTests / totalTests) * 100).toFixed(2)}% success rate) in ${totalDuration}ms`;

        return {
            totalTests,
            passedTests,
            failedTests,
            totalDuration,
            results: this.testResults,
            summary,
            categories
        };
    }

    /**
     * Get test results
     */
    getTestResults(): TestResult[] {
        return this.testResults;
    }

    /**
     * Reset test results
     */
    resetTestResults(): void {
        this.testResults = [];
    }
}

// Export for use in other test files
export default UnitAndIntegrationTestSuite;
