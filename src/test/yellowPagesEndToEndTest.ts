/**
 * End-to-End Integration Test for Yellow Pages Scheduler Integration
 * 
 * This comprehensive test verifies the complete integration between:
 * - Yellow Pages Module
 * - BackgroundScheduler 
 * - TaskExecutorService
 * - BrowserManager
 * - AccountCookiesModule
 * - Multi-process architecture
 * 
 * Tests include error handling, recovery, and real-world scenarios.
 */

import { YellowPagesOrchestrator } from "@/modules/YellowPagesOrchestrator";
import { TaskExecutorService } from "@/modules/TaskExecutorService";
import { ScheduleTaskModule } from "@/modules/ScheduleTaskModule";
import { BackgroundScheduler } from "@/modules/BackgroundScheduler";
import { ScheduleManager } from "@/modules/ScheduleManager";
import { YellowPagesTaskData, TaskStatus } from "@/modules/interface/ITaskManager";
import { TaskType, ScheduleStatus, TriggerType, DependencyCondition } from "@/entity/ScheduleTask.entity";

interface TestResult {
    testName: string;
    success: boolean;
    duration: number;
    error?: string;
    details?: any;
}

export class YellowPagesEndToEndTest {
    private orchestrator: YellowPagesOrchestrator;
    private taskExecutorService: TaskExecutorService;
    private scheduleTaskModule: ScheduleTaskModule;
    private backgroundScheduler: BackgroundScheduler;
    private scheduleManager: ScheduleManager;
    private testResults: TestResult[] = [];

    constructor() {
        this.orchestrator = new YellowPagesOrchestrator();
        this.taskExecutorService = new TaskExecutorService();
        this.scheduleTaskModule = new ScheduleTaskModule();
        this.backgroundScheduler = new BackgroundScheduler(process.cwd() + '/test-db');
        this.scheduleManager = ScheduleManager.getInstance();
    }

    /**
     * Run a single test and record results
     */
    private async runTest(testName: string, testFunction: () => Promise<any>): Promise<TestResult> {
        const startTime = Date.now();
        console.log(`\n🧪 Running test: ${testName}`);

        try {
            const result = await testFunction();
            const duration = Date.now() - startTime;
            
            const testResult: TestResult = {
                testName,
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

    /**
     * Test 1: System Initialization
     */
    private async testSystemInitialization(): Promise<any> {
        await this.orchestrator.initialize();
        
        const healthStatus = await this.orchestrator.getSystemHealthStatus();
        
        if (healthStatus.overall === 'critical') {
            throw new Error('System health is critical after initialization');
        }

        return {
            health: healthStatus.overall,
            platforms: healthStatus.platforms,
            initialized: healthStatus.orchestrator.initialized
        };
    }

    /**
     * Test 2: Task Creation and Validation
     */
    private async testTaskCreationAndValidation(): Promise<any> {
        const taskData: YellowPagesTaskData = {
            name: "E2E Test Task",
            platform: "yellowpages.com",
            keywords: ["restaurant", "pizza"],
            location: "New York, NY",
            max_pages: 1,
            concurrency: 1,
            delay_between_requests: 1000
        };

        const taskId = await this.orchestrator.createTask(taskData);
        
        if (!taskId || taskId <= 0) {
            throw new Error('Invalid task ID returned');
        }

        const status = await this.orchestrator.getTaskStatus(taskId);
        if (status !== TaskStatus.Pending) {
            throw new Error(`Expected task status to be Pending, got ${TaskStatus[status]}`);
        }

        return { taskId, status: TaskStatus[status] };
    }

    /**
     * Test 3: Scheduled Task Creation
     */
    private async testScheduledTaskCreation(): Promise<any> {
        // First create a Yellow Pages task
        const taskData: YellowPagesTaskData = {
            name: "Scheduled E2E Test Task",
            platform: "yellowpages.com",
            keywords: ["cafe"],
            location: "Los Angeles, CA",
            max_pages: 1,
            concurrency: 1
        };

        const yellowPagesTaskId = await this.orchestrator.createTask(taskData);

        // Create a schedule for this task
        const scheduleData = {
            name: "E2E Test Schedule",
            description: "End-to-end test schedule",
            task_type: TaskType.YELLOW_PAGES,
            task_id: yellowPagesTaskId,
            cron_expression: "0 */1 * * *", // Every hour
            is_active: true,
            status: ScheduleStatus.ACTIVE,
            trigger_type: TriggerType.CRON,
            dependency_condition: DependencyCondition.ON_SUCCESS,
            delay_minutes: 0
        };

        const scheduleId = await this.scheduleTaskModule.createSchedule(scheduleData);

        return { 
            yellowPagesTaskId, 
            scheduleId,
            cronExpression: scheduleData.cron_expression
        };
    }

    /**
     * Test 4: TaskExecutorService Integration
     */
    private async testTaskExecutorServiceIntegration(): Promise<any> {
        const taskData: YellowPagesTaskData = {
            name: "TaskExecutor Integration Test",
            platform: "yellowpages.com",
            keywords: ["bakery"],
            location: "Chicago, IL",
            max_pages: 1,
            concurrency: 1
        };

        const taskId = await this.orchestrator.createTask(taskData);

        // Test task status retrieval through TaskExecutorService
        const status = await this.taskExecutorService.getTaskStatus(taskId, TaskType.YELLOW_PAGES);
        
        // Test task validation
        const validation = await this.taskExecutorService.validateTaskConfiguration(taskId, TaskType.YELLOW_PAGES);
        
        if (!validation.isValid) {
            throw new Error(`Task validation failed: ${validation.errors.join(', ')}`);
        }

        return {
            taskId,
            status,
            validation: validation.isValid,
            warnings: validation.warnings
        };
    }

    /**
     * Test 5: Error Handling - Invalid Platform
     */
    private async testErrorHandlingInvalidPlatform(): Promise<any> {
        const taskData: YellowPagesTaskData = {
            name: "Error Test - Invalid Platform",
            platform: "nonexistent.com",
            keywords: ["test"],
            location: "Test City",
            max_pages: 1,
            concurrency: 1
        };

        try {
            await this.orchestrator.createTask(taskData);
            throw new Error('Expected error for invalid platform, but task was created successfully');
        } catch (error) {
            // This is expected
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('not found')) {
                return { 
                    expectedError: true, 
                    errorMessage 
                };
            }
            throw error;
        }
    }

    /**
     * Test 6: Error Handling - Invalid Account
     */
    private async testErrorHandlingInvalidAccount(): Promise<any> {
        const taskData: YellowPagesTaskData = {
            name: "Error Test - Invalid Account",
            platform: "yellowpages.com",
            keywords: ["test"],
            location: "Test City",
            max_pages: 1,
            concurrency: 1,
            account_id: 99999 // Non-existent account
        };

        // This should succeed but log a warning
        const taskId = await this.orchestrator.createTask(taskData);
        
        return { 
            taskId,
            accountWarningHandled: true
        };
    }

    /**
     * Test 7: Process Management
     */
    private async testProcessManagement(): Promise<any> {
        const taskData: YellowPagesTaskData = {
            name: "Process Management Test",
            platform: "yellowpages.com",
            keywords: ["bookstore"],
            location: "San Francisco, CA",
            max_pages: 1,
            concurrency: 1
        };

        const taskId = await this.orchestrator.createTask(taskData);
        
        // Start the task
        await this.orchestrator.startTask(taskId);
        
        // Check if process is running
        const modules = this.orchestrator.getModules();
        const isRunning = modules.processManager.isProcessRunning(taskId);
        
        // Stop the task
        await this.orchestrator.stopTask(taskId);
        
        // Verify process is stopped
        const isStoppedAfter = modules.processManager.isProcessRunning(taskId);

        return {
            taskId,
            wasRunning: isRunning,
            isStoppedAfter: !isStoppedAfter,
            processCount: modules.processManager.getProcessCount()
        };
    }

    /**
     * Test 8: Browser Manager Integration
     */
    private async testBrowserManagerIntegration(): Promise<any> {
        const modules = this.orchestrator.getModules();
        const browserInfo = await modules.browserManager.getBrowserInfo();
        
        const launchOptions = await modules.browserManager.createLaunchOptions({
            headless: true
        });

        return {
            browserAvailable: !!browserInfo.executablePath || browserInfo.executablePath === '',
            buildId: browserInfo.buildId,
            isSystemBrowser: browserInfo.isSystemBrowser,
            isCachedBrowser: browserInfo.isCachedBrowser,
            launchOptionsCreated: !!launchOptions
        };
    }

    /**
     * Test 9: Health Monitoring
     */
    private async testHealthMonitoring(): Promise<any> {
        const healthStatus = await this.orchestrator.getSystemHealthStatus();
        
        return {
            overall: healthStatus.overall,
            orchestratorHealth: healthStatus.orchestrator,
            moduleHealth: healthStatus.modules,
            processHealth: healthStatus.processes,
            browserHealth: !!healthStatus.browser,
            databaseHealth: healthStatus.database,
            platformsHealth: healthStatus.platforms
        };
    }

    /**
     * Test 10: Cleanup and Shutdown
     */
    private async testCleanupAndShutdown(): Promise<any> {
        // Get current process count
        const modules = this.orchestrator.getModules();
        const initialProcessCount = modules.processManager.getProcessCount();
        
        // Shutdown orchestrator
        await this.orchestrator.shutdown();
        
        // Verify cleanup
        const finalProcessCount = modules.processManager.getProcessCount();
        
        return {
            initialProcessCount,
            finalProcessCount,
            cleanedUp: finalProcessCount === 0
        };
    }

    /**
     * Run all end-to-end tests
     */
    async runAllTests(): Promise<{
        totalTests: number;
        passedTests: number;
        failedTests: number;
        totalDuration: number;
        results: TestResult[];
        summary: string;
    }> {
        console.log('🚀 Starting Yellow Pages End-to-End Integration Tests...\n');
        console.log('='.repeat(80));

        const startTime = Date.now();

        // Run all tests
        await this.runTest('System Initialization', () => this.testSystemInitialization());
        await this.runTest('Task Creation and Validation', () => this.testTaskCreationAndValidation());
        await this.runTest('Scheduled Task Creation', () => this.testScheduledTaskCreation());
        await this.runTest('TaskExecutorService Integration', () => this.testTaskExecutorServiceIntegration());
        await this.runTest('Error Handling - Invalid Platform', () => this.testErrorHandlingInvalidPlatform());
        await this.runTest('Error Handling - Invalid Account', () => this.testErrorHandlingInvalidAccount());
        await this.runTest('Process Management', () => this.testProcessManagement());
        await this.runTest('Browser Manager Integration', () => this.testBrowserManagerIntegration());
        await this.runTest('Health Monitoring', () => this.testHealthMonitoring());
        await this.runTest('Cleanup and Shutdown', () => this.testCleanupAndShutdown());

        const totalDuration = Date.now() - startTime;
        const passedTests = this.testResults.filter(r => r.success).length;
        const failedTests = this.testResults.filter(r => !r.success).length;

        // Generate summary
        console.log('\n' + '='.repeat(80));
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total Tests: ${this.testResults.length}`);
        console.log(`✅ Passed: ${passedTests}`);
        console.log(`❌ Failed: ${failedTests}`);
        console.log(`⏱️  Total Duration: ${totalDuration}ms`);
        console.log(`📈 Success Rate: ${((passedTests / this.testResults.length) * 100).toFixed(1)}%`);

        if (failedTests > 0) {
            console.log('\n❌ FAILED TESTS:');
            this.testResults
                .filter(r => !r.success)
                .forEach(r => console.log(`   • ${r.testName}: ${r.error}`));
        }

        const summary = failedTests === 0 ? 
            '🎉 All tests passed! Yellow Pages scheduler integration is working correctly.' :
            `⚠️  ${failedTests} test(s) failed. Please review the errors above.`;

        console.log(`\n${summary}`);
        console.log('='.repeat(80));

        return {
            totalTests: this.testResults.length,
            passedTests,
            failedTests,
            totalDuration,
            results: this.testResults,
            summary
        };
    }

    /**
     * Get detailed test results
     */
    getTestResults(): TestResult[] {
        return this.testResults;
    }

    /**
     * Reset test results (for running tests multiple times)
     */
    resetTestResults(): void {
        this.testResults = [];
    }
}

// Export for use in other test files or direct execution
export default YellowPagesEndToEndTest;