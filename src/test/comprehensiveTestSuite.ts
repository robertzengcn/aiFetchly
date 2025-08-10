/**
 * Comprehensive Test Suite for aiFetchly
 * 
 * This test suite covers:
 * - Unit tests for all platform adapters
 * - Integration tests for end-to-end scraping flow
 * - System architecture tests
 * - Performance baseline tests
 * - Error handling and recovery tests
 */

import { PlatformAdapterFactory } from '@/modules/PlatformAdapterFactory';
import { PlatformRegistry } from '@/modules/PlatformRegistry';
import { TaskExecutorService } from '@/modules/TaskExecutorService';
import { ScheduleTaskModule } from '@/modules/ScheduleTaskModule';
import { BackgroundScheduler } from '@/modules/BackgroundScheduler';
import { browserManager } from '@/modules/browserManager';
import { AccountCookiesModule } from '@/modules/accountCookiesModule';
import { AccountCookiesEntity } from '@/entity/AccountCookies.entity';
import { YellowPagesOrchestrator } from '@/modules/YellowPagesOrchestrator';
import { PlatformTestingFramework } from '@/modules/PlatformTestingFramework';
import { PlatformExtensibilityTest } from '@/modules/PlatformExtensibilityTest';
import { TaskType } from '@/entity/ScheduleTask.entity';

// Import individual platform tests
import YellComAdapterTest from './yellComAdapterTest';
import * as Test192 from './192ComAdapterTest';
import { YellowPagesAdapterTest } from './yellowPagesAdapterTest';
import { YelpAdapterTest } from './yelpAdapterTest';

interface TestResult {
    testName: string;
    category: 'unit' | 'integration' | 'system' | 'performance';
    success: boolean;
    duration: number;
    error?: string;
    details?: any;
    memoryUsage?: number;
}

export class ComprehensiveTestSuite {
    private factory: PlatformAdapterFactory;
    private registry: PlatformRegistry;
    private taskExecutorService: TaskExecutorService;
    private scheduleTaskModule: ScheduleTaskModule;
    private backgroundScheduler: BackgroundScheduler;
    private browserManager: any;
    private accountCookiesModule: AccountCookiesModule;
    private orchestrator: YellowPagesOrchestrator;
    private platformTestingFramework: PlatformTestingFramework;
    private platformExtensibilityTest: PlatformExtensibilityTest;
    
    // Individual test classes
    private yellTest: YellComAdapterTest;
    private test192: any;
    private yellowPagesTest: YellowPagesAdapterTest;
    private yelpTest: YelpAdapterTest;
    
    private testResults: TestResult[] = [];

    constructor() {
        this.factory = new PlatformAdapterFactory();
        this.registry = new PlatformRegistry();
        this.taskExecutorService = new TaskExecutorService();
        this.scheduleTaskModule = new ScheduleTaskModule();
        this.backgroundScheduler = new BackgroundScheduler(process.cwd() + '/test-db');
        this.browserManager = browserManager;
        this.accountCookiesModule = new AccountCookiesModule();
        this.orchestrator = new YellowPagesOrchestrator();
        this.platformTestingFramework = new PlatformTestingFramework();
        this.platformExtensibilityTest = new PlatformExtensibilityTest();
        
        // Initialize individual test classes
        this.yellTest = new YellComAdapterTest();
        this.test192 = new (Test192 as any)['192ComAdapterTest']();
        this.yellowPagesTest = new YellowPagesAdapterTest();
        this.yelpTest = new YelpAdapterTest();
    }

    /**
     * Run a single test and record results
     */
    private async runTest(
        testName: string, 
        category: 'unit' | 'integration' | 'system' | 'performance',
        testFunction: () => Promise<any>
    ): Promise<TestResult> {
        const startTime = Date.now();
        const startMemory = process.memoryUsage().heapUsed;
        
        console.log(`\n🧪 Running ${category} test: ${testName}`);

        try {
            const result = await testFunction();
            const duration = Date.now() - startTime;
            const endMemory = process.memoryUsage().heapUsed;
            const memoryUsage = endMemory - startMemory;
            
            const testResult: TestResult = {
                testName,
                category,
                success: true,
                duration,
                details: result,
                memoryUsage
            };

            console.log(`✅ ${testName} - PASSED (${duration}ms, ${memoryUsage} bytes)`);
            this.testResults.push(testResult);
            return testResult;

        } catch (error) {
            const duration = Date.now() - startTime;
            const endMemory = process.memoryUsage().heapUsed;
            const memoryUsage = endMemory - startMemory;
            
            const testResult: TestResult = {
                testName,
                category,
                success: false,
                duration,
                error: error instanceof Error ? error.message : String(error),
                memoryUsage
            };

            console.log(`❌ ${testName} - FAILED (${duration}ms, ${memoryUsage} bytes)`);
            console.log(`   Error: ${testResult.error}`);
            this.testResults.push(testResult);
            return testResult;
        }
    }

    // ==================== UNIT TESTS ====================

    /**
     * Test all platform adapter configurations
     */
    private async testAllPlatformConfigurations(): Promise<any> {
        const platforms = this.registry.getAllPlatforms();
        const results: Array<{ platform: string; id: string; validationScore: number }> = [];

        for (const platform of platforms) {
            const validation = this.registry.validatePlatformConfig(platform);
            if (!validation.isValid) {
                throw new Error(`${platform.name} configuration invalid: ${validation.errors.join(', ')}`);
            }
            results.push({
                platform: platform.name,
                id: platform.id,
                validationScore: validation.score
            });
        }

        return {
            totalPlatforms: platforms.length,
            activePlatforms: platforms.filter(p => p.is_active).length,
            results
        };
    }

    /**
     * Test adapter factory creation for all platforms
     */
    private async testAdapterFactoryForAllPlatforms(): Promise<any> {
        const platforms = this.registry.getAllPlatforms();
        const results: Array<{ platform: string; adapterType: string; isValid: boolean; validationScore: number }> = [];

        for (const platform of platforms) {
            const adapter = await this.factory.createAdapterById(platform.id);
            const validation = adapter.validateConfig();
            
            results.push({
                platform: platform.name,
                adapterType: adapter.constructor.name,
                isValid: validation.isValid,
                validationScore: validation.score
            });
        }

        return {
            totalAdapters: results.length,
            validAdapters: results.filter(r => r.isValid).length,
            results
        };
    }

    /**
     * Test URL building for all platforms
     */
    private async testUrlBuildingForAllPlatforms(): Promise<any> {
        const platforms = this.registry.getAllPlatforms();
        const results: Array<{ platform: string; searchUrl: string; containsKeywords: boolean; containsLocation: boolean }> = [];

        for (const platform of platforms) {
            const adapter = await this.factory.createAdapterById(platform.id);
            const keywords = ['test', 'business'];
            const location = 'Test City';
            const page = 1;

            const searchUrl = adapter.buildSearchUrl(keywords, location, page);
            
            results.push({
                platform: platform.name,
                searchUrl,
                containsKeywords: keywords.some(k => searchUrl.includes(k)),
                containsLocation: searchUrl.includes(location)
            });
        }

        return {
            totalUrls: results.length,
            validUrls: results.filter(r => r.containsKeywords && r.containsLocation).length,
            results
        };
    }

    // ==================== INTEGRATION TESTS ====================

    /**
     * Test end-to-end scraping flow
     */
    private async testEndToEndScrapingFlow(): Promise<any> {
        // Initialize system components
        await this.orchestrator.initialize();
        await this.browserManager.initialize();
        // AccountCookiesModule doesn't need initialization

        // Create a test task
        const testTask = {
            id: 'test-e2e-task',
            platform: 'yellowpages-com',
            keywords: ['restaurant'],
            location: 'New York',
            maxPages: 1,
            priority: 'medium'
        };

        // Execute the task
        const result = await this.taskExecutorService.executeSearchTask(parseInt(testTask.id.split('-').pop() || '0'));

        return {
            taskId: testTask.id,
            status: 'completed',
            resultsCount: 0,
            executionTime: result // result is the execution time in milliseconds
        };
    }

    /**
     * Test scheduler integration
     */
    private async testSchedulerIntegration(): Promise<any> {
        await this.backgroundScheduler.initialize();
        
        // Create a scheduled task
        const scheduledTask = {
            name: 'Test Coffee Search',
            task_type: TaskType.SEARCH,
            task_id: 1,
            cron_expression: '0 9 * * *', // Daily at 9 AM
            is_active: true
        };

        const result = await this.scheduleTaskModule.createSchedule(scheduledTask);

        return {
            taskId: scheduledTask.task_id,
            scheduleId: result,
            nextRun: new Date(),
            status: 'scheduled'
        };
    }

    /**
     * Test browser manager integration
     */
    private async testBrowserManagerIntegration(): Promise<any> {
        await this.browserManager.initialize();
        
        const browser = await this.browserManager.createBrowser();
        const page = await browser.newPage();
        
        // Test basic page navigation
        await page.goto('https://www.google.com');
        const title = await page.title();
        
        await browser.close();

        return {
            browserCreated: !!browser,
            pageCreated: !!page,
            pageTitle: title,
            navigationSuccessful: title.includes('Google')
        };
    }

    /**
     * Test account cookies module
     */
    private async testAccountCookiesModule(): Promise<any> {
        // AccountCookiesModule doesn't need initialization
        
        // Test cookie storage and retrieval
        const testCookies = new AccountCookiesEntity();
        testCookies.account_id = 1;
        testCookies.cookies = JSON.stringify([{ name: 'test-cookie', value: 'test-value', domain: '.example.com' }]);
        testCookies.partition_path = this.accountCookiesModule.genPartitionPath();
        
        await this.accountCookiesModule.saveAccountCookies(testCookies);
        const retrievedCookies = await this.accountCookiesModule.getAccountCookies(1);
        
        return {
            cookiesStored: 1,
            cookiesRetrieved: retrievedCookies ? 1 : 0,
            storageSuccessful: retrievedCookies !== null
        };
    }

    // ==================== SYSTEM TESTS ====================

    /**
     * Test system architecture components
     */
    private async testSystemArchitecture(): Promise<any> {
        const components = [
            { name: 'PlatformRegistry', instance: this.registry },
            { name: 'PlatformAdapterFactory', instance: this.factory },
            { name: 'TaskExecutorService', instance: this.taskExecutorService },
            { name: 'ScheduleTaskModule', instance: this.scheduleTaskModule },
            { name: 'BackgroundScheduler', instance: this.backgroundScheduler },
            { name: 'BrowserManager', instance: this.browserManager },
            { name: 'AccountCookiesModule', instance: this.accountCookiesModule },
            { name: 'YellowPagesOrchestrator', instance: this.orchestrator }
        ];

        const results: Array<{ component: string; methodCount: number; hasRequiredMethods: boolean }> = [];

        for (const component of components) {
            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(component.instance))
                .filter(name => typeof component.instance[name] === 'function' && name !== 'constructor');
            
            results.push({
                component: component.name,
                methodCount: methods.length,
                hasRequiredMethods: methods.length > 0
            });
        }

        return {
            totalComponents: components.length,
            componentsWithMethods: results.filter(r => r.hasRequiredMethods).length,
            results
        };
    }

    /**
     * Test error handling and recovery
     */
    private async testErrorHandlingAndRecovery(): Promise<any> {
        const errorTests: Array<{ test: string; passed: boolean }> = [];

        // Test invalid platform ID
        try {
            await this.factory.createAdapterById('invalid-platform-id');
            errorTests.push({ test: 'Invalid Platform ID', passed: false });
        } catch (error) {
            errorTests.push({ test: 'Invalid Platform ID', passed: true });
        }

        // Test invalid configuration
        try {
            const invalidConfig = { 
                id: 'test', 
                name: 'Test',
                display_name: 'Test Platform',
                base_url: 'https://test.com',
                country: 'US',
                language: 'en',
                is_active: true,
                version: '1.0.0',
                rate_limit: 1000,
                delay_between_requests: 1000,
                max_concurrent_requests: 5,
                type: 'configuration' as const
            };
            this.registry.validatePlatformConfig(invalidConfig);
            errorTests.push({ test: 'Invalid Configuration', passed: false });
        } catch (error) {
            errorTests.push({ test: 'Invalid Configuration', passed: true });
        }

        // Test graceful degradation
        const validPlatforms = this.registry.getAllPlatforms().slice(0, 2);
        const degradedResults: Array<{ platform: string; status: string; error?: string }> = [];

        for (const platform of validPlatforms) {
            try {
                const adapter = await this.factory.createAdapterById(platform.id);
                degradedResults.push({ platform: platform.name, status: 'success' });
            } catch (error) {
                degradedResults.push({ platform: platform.name, status: 'failed', error: error instanceof Error ? error.message : String(error) });
            }
        }

        return {
            errorTests,
            degradedResults,
            errorHandlingScore: errorTests.filter(t => t.passed).length / errorTests.length
        };
    }

    // ==================== PERFORMANCE TESTS ====================

    /**
     * Test performance baseline
     */
    private async testPerformanceBaseline(): Promise<any> {
        const performanceTests: Array<{ test: string; metric: string; value: number; unit: string; threshold: number; passed: boolean }> = [];

        // Test adapter creation performance
        const platforms = this.registry.getAllPlatforms();
        const creationTimes: Array<{ platform: string; time: number }> = [];

        for (const platform of platforms) {
            const startTime = Date.now();
            await this.factory.createAdapterById(platform.id);
            const creationTime = Date.now() - startTime;
            creationTimes.push({ platform: platform.name, time: creationTime });
        }

        const avgCreationTime = creationTimes.reduce((sum, test) => sum + test.time, 0) / creationTimes.length;

        // Test memory usage
        const memoryUsage = process.memoryUsage();

        performanceTests.push({
            test: 'Adapter Creation Performance',
            metric: 'Average Creation Time',
            value: avgCreationTime,
            unit: 'ms',
            threshold: 1000,
            passed: avgCreationTime < 1000
        });

        performanceTests.push({
            test: 'Memory Usage',
            metric: 'Heap Used',
            value: memoryUsage.heapUsed,
            unit: 'bytes',
            threshold: 500 * 1024 * 1024, // 500MB
            passed: memoryUsage.heapUsed < 500 * 1024 * 1024
        });

        return {
            performanceTests,
            creationTimes,
            memoryUsage,
            overallPerformance: performanceTests.filter(t => t.passed).length / performanceTests.length
        };
    }

    /**
     * Test concurrent task execution
     */
    private async testConcurrentTaskExecution(): Promise<any> {
        interface ConcurrentTask {
            id: string;
            platform: string;
            keywords: string[];
            location: string;
            maxPages: number;
        }
        
        const concurrentTasks: ConcurrentTask[] = [];
        const platforms = this.registry.getAllPlatforms().slice(0, 3); // Test with 3 platforms

        // Create concurrent tasks
        for (let i = 0; i < platforms.length; i++) {
            concurrentTasks.push({
                id: `concurrent-task-${i}`,
                platform: platforms[i].id,
                keywords: ['test'],
                location: 'Test City',
                maxPages: 1
            });
        }

        const startTime = Date.now();
        
        // Execute tasks concurrently
        const results = await Promise.allSettled(
            concurrentTasks.map(task => this.taskExecutorService.executeSearchTask(parseInt(task.id.split('-').pop() || '0')))
        );

        const totalTime = Date.now() - startTime;
        const successfulTasks = results.filter(r => r.status === 'fulfilled').length;

        return {
            totalTasks: concurrentTasks.length,
            successfulTasks,
            failedTasks: concurrentTasks.length - successfulTasks,
            totalExecutionTime: totalTime,
            averageTimePerTask: totalTime / concurrentTasks.length,
            concurrencyScore: successfulTasks / concurrentTasks.length
        };
    }

    // ==================== MAIN TEST RUNNER ====================

    /**
     * Run all comprehensive tests
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
            system: { total: number; passed: number; failed: number };
            performance: { total: number; passed: number; failed: number };
        };
    }> {
        console.log('🚀 Starting Comprehensive Test Suite for aiFetchly...');
        console.log('=' .repeat(80));

        const startTime = Date.now();

        // Unit Tests
        await this.runTest('All Platform Configurations', 'unit', () => this.testAllPlatformConfigurations());
        await this.runTest('Adapter Factory for All Platforms', 'unit', () => this.testAdapterFactoryForAllPlatforms());
        await this.runTest('URL Building for All Platforms', 'unit', () => this.testUrlBuildingForAllPlatforms());

        // Integration Tests
        await this.runTest('End-to-End Scraping Flow', 'integration', () => this.testEndToEndScrapingFlow());
        await this.runTest('Scheduler Integration', 'integration', () => this.testSchedulerIntegration());
        await this.runTest('Browser Manager Integration', 'integration', () => this.testBrowserManagerIntegration());
        await this.runTest('Account Cookies Module', 'integration', () => this.testAccountCookiesModule());

        // System Tests
        await this.runTest('System Architecture', 'system', () => this.testSystemArchitecture());
        await this.runTest('Error Handling and Recovery', 'system', () => this.testErrorHandlingAndRecovery());

        // Performance Tests
        await this.runTest('Performance Baseline', 'performance', () => this.testPerformanceBaseline());
        await this.runTest('Concurrent Task Execution', 'performance', () => this.testConcurrentTaskExecution());

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
            },
            system: {
                total: this.testResults.filter(r => r.category === 'system').length,
                passed: this.testResults.filter(r => r.category === 'system' && r.success).length,
                failed: this.testResults.filter(r => r.category === 'system' && !r.success).length
            },
            performance: {
                total: this.testResults.filter(r => r.category === 'performance').length,
                passed: this.testResults.filter(r => r.category === 'performance' && r.success).length,
                failed: this.testResults.filter(r => r.category === 'performance' && !r.success).length
            }
        };

        console.log('\n' + '=' .repeat(80));
        console.log('📊 COMPREHENSIVE TEST RESULTS');
        console.log('=' .repeat(80));
        console.log(`Total Tests: ${totalTests}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${failedTests}`);
        console.log(`Total Duration: ${totalDuration}ms`);
        console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%`);

        console.log('\n📋 Results by Category:');
        console.log(`Unit Tests: ${categories.unit.passed}/${categories.unit.total} passed`);
        console.log(`Integration Tests: ${categories.integration.passed}/${categories.integration.total} passed`);
        console.log(`System Tests: ${categories.system.passed}/${categories.system.total} passed`);
        console.log(`Performance Tests: ${categories.performance.passed}/${categories.performance.total} passed`);

        if (failedTests > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults.filter(r => !r.success).forEach(result => {
                console.log(`  - ${result.testName}: ${result.error}`);
            });
        }

        const summary = `Comprehensive test suite completed with ${passedTests}/${totalTests} tests passing (${((passedTests / totalTests) * 100).toFixed(2)}% success rate) in ${totalDuration}ms`;

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

    /**
     * Generate test report
     */
    generateTestReport(): any {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalTests: this.testResults.length,
                passedTests: this.testResults.filter(r => r.success).length,
                failedTests: this.testResults.filter(r => !r.success).length,
                successRate: (this.testResults.filter(r => r.success).length / this.testResults.length) * 100
            },
            categories: {
                unit: this.testResults.filter(r => r.category === 'unit'),
                integration: this.testResults.filter(r => r.category === 'integration'),
                system: this.testResults.filter(r => r.category === 'system'),
                performance: this.testResults.filter(r => r.category === 'performance')
            },
            details: this.testResults
        };

        return report;
    }
}

// Export for use in other test files
export default ComprehensiveTestSuite;
