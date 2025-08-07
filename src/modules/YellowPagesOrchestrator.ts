import { BaseModule } from "@/modules/baseModule";
import { YellowPagesModule } from "@/modules/YellowPagesModule";
import { YellowPagesProcessManager } from "@/modules/YellowPagesProcessManager";
import { BrowserManager } from "@/modules/browserManager";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { YellowPagesTaskModel } from "@/model/YellowPagesTask.model";
import { YellowPagesPlatformModel } from "@/model/YellowPagesPlatform.model";
import { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import { YellowPagesInitModule } from "@/modules/YellowPagesInitModule";
import { YellowPagesHealthCheck } from "@/modules/YellowPagesHealthCheck";
import { ITaskManager, YellowPagesTaskData, TaskStatus } from "@/interfaces/ITaskManager";

/**
 * Yellow Pages Orchestrator - Main coordination layer
 * 
 * This class serves as the central orchestration point for all Yellow Pages scraping operations.
 * It coordinates between different modules and ensures proper initialization, execution, and cleanup.
 * 
 * Key Responsibilities:
 * - System initialization and health checks
 * - Task lifecycle management
 * - Resource coordination (browser, cookies, processes)
 * - Error handling and recovery
 * - Performance monitoring
 * 
 * @extends BaseModule
 * @implements ITaskManager
 */
export class YellowPagesOrchestrator extends BaseModule implements ITaskManager {
    private yellowPagesModule: YellowPagesModule;
    private processManager: YellowPagesProcessManager;
    private browserManager: BrowserManager;
    private accountCookiesModule: AccountCookiesModule;
    private taskModel: YellowPagesTaskModel;
    private platformModel: YellowPagesPlatformModel;
    private resultModel: YellowPagesResultModel;
    private initModule: YellowPagesInitModule;
    private healthCheck: YellowPagesHealthCheck;
    
    private isInitialized: boolean = false;
    private isShuttingDown: boolean = false;

    constructor() {
        super();
        
        // Initialize all modules
        this.yellowPagesModule = new YellowPagesModule();
        this.processManager = new YellowPagesProcessManager();
        this.browserManager = new BrowserManager();
        this.accountCookiesModule = new AccountCookiesModule();
        this.taskModel = new YellowPagesTaskModel(this.dbpath);
        this.platformModel = new YellowPagesPlatformModel(this.dbpath);
        this.resultModel = new YellowPagesResultModel(this.dbpath);
        this.initModule = new YellowPagesInitModule();
        this.healthCheck = new YellowPagesHealthCheck();
    }

    /**
     * Initialize the Yellow Pages system
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.log('Yellow Pages Orchestrator already initialized');
            return;
        }

        try {
            console.log('Initializing Yellow Pages Orchestrator...');

            // Step 1: Initialize the Yellow Pages system (platforms, etc.)
            await this.initModule.initializeYellowPagesSystem();

            // Step 2: Verify system health
            const systemStatus = await this.initModule.getSystemStatus();
            if (!systemStatus.initialized) {
                throw new Error('Yellow Pages system initialization failed');
            }

            // Step 3: Verify browser availability
            const browserInfo = await this.browserManager.getBrowserInfo();
            console.log('Browser info:', {
                executablePath: browserInfo.executablePath || 'bundled',
                buildId: browserInfo.buildId,
                isSystemBrowser: browserInfo.isSystemBrowser,
                isCachedBrowser: browserInfo.isCachedBrowser
            });

            // Step 4: Initialize health check monitoring
            await this.healthCheck.initialize();

            this.isInitialized = true;
            console.log('Yellow Pages Orchestrator initialized successfully');

        } catch (error) {
            console.error('Failed to initialize Yellow Pages Orchestrator:', error);
            throw error;
        }
    }

    /**
     * Shutdown the Yellow Pages system gracefully
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        try {
            console.log('Shutting down Yellow Pages Orchestrator...');
            this.isShuttingDown = true;

            // Stop all active processes
            await this.processManager.terminateAllProcesses();

            // Perform health check cleanup
            await this.healthCheck.cleanup();

            console.log('Yellow Pages Orchestrator shutdown complete');

        } catch (error) {
            console.error('Error during Yellow Pages Orchestrator shutdown:', error);
            throw error;
        }
    }

    /**
     * Create a new Yellow Pages scraping task
     */
    async createTask(taskData: YellowPagesTaskData): Promise<number> {
        await this.ensureInitialized();
        
        try {
            // Validate platform exists
            const platform = await this.platformModel.getPlatformByName(taskData.platform);
            if (!platform) {
                throw new Error(`Platform ${taskData.platform} is not supported or not active`);
            }

            // Validate account if specified
            if (taskData.account_id) {
                const cookies = await this.accountCookiesModule.getAccountCookies(taskData.account_id);
                if (!cookies) {
                    console.warn(`Account ${taskData.account_id} not found, task will run without cookies`);
                }
            }

            // Create task through the main module
            const taskId = await this.yellowPagesModule.createTask(taskData);

            console.log(`Orchestrator created task ${taskId} for platform ${taskData.platform}`);
            return taskId;

        } catch (error) {
            console.error('Failed to create task:', error);
            throw error;
        }
    }

    /**
     * Start a Yellow Pages task with full orchestration
     */
    async startTask(taskId: number): Promise<void> {
        await this.ensureInitialized();

        try {
            console.log(`Orchestrator starting task ${taskId}`);

            // Pre-flight checks
            await this.performPreflightChecks(taskId);

            // Start the task through the main module
            await this.yellowPagesModule.startTask(taskId);

            console.log(`Orchestrator successfully started task ${taskId}`);

        } catch (error) {
            console.error(`Failed to start task ${taskId}:`, error);
            
            // Attempt cleanup on failure
            try {
                await this.processManager.terminateProcess(taskId);
            } catch (cleanupError) {
                console.error(`Failed to cleanup after task start failure:`, cleanupError);
            }
            
            throw error;
        }
    }

    /**
     * Stop a Yellow Pages task
     */
    async stopTask(taskId: number): Promise<void> {
        return this.yellowPagesModule.stopTask(taskId);
    }

    /**
     * Pause a Yellow Pages task
     */
    async pauseTask(taskId: number): Promise<void> {
        return this.yellowPagesModule.pauseTask(taskId);
    }

    /**
     * Resume a Yellow Pages task
     */
    async resumeTask(taskId: number): Promise<void> {
        return this.yellowPagesModule.resumeTask(taskId);
    }

    /**
     * Get task status
     */
    async getTaskStatus(taskId: number): Promise<TaskStatus> {
        return this.yellowPagesModule.getTaskStatus(taskId);
    }

    /**
     * Get task progress
     */
    async getTaskProgress(taskId: number): Promise<any> {
        return this.yellowPagesModule.getTaskProgress(taskId);
    }

    /**
     * Get task results
     */
    async getTaskResults(taskId: number): Promise<any[]> {
        return this.yellowPagesModule.getTaskResults(taskId);
    }

    /**
     * List tasks
     */
    async listTasks(filters?: any): Promise<any[]> {
        return this.yellowPagesModule.listTasks(filters);
    }

    /**
     * Update task
     */
    async updateTask(taskId: number, updates: any): Promise<void> {
        return this.yellowPagesModule.updateTask(taskId, updates);
    }

    /**
     * Delete task
     */
    async deleteTask(taskId: number): Promise<void> {
        return this.yellowPagesModule.deleteTask(taskId);
    }

    /**
     * Get comprehensive system health status
     */
    async getSystemHealthStatus(): Promise<{
        orchestrator: any;
        modules: any;
        processes: any;
        browser: any;
        database: any;
        platforms: any;
        overall: 'healthy' | 'warning' | 'critical';
    }> {
        try {
            const [
                moduleHealth,
                processHealth,
                browserInfo,
                systemStatus,
                activePlatforms
            ] = await Promise.all([
                this.yellowPagesModule.getHealthStatus(),
                this.processManager.healthCheck(),
                this.browserManager.getBrowserInfo(),
                this.initModule.getSystemStatus(),
                this.platformModel.getActivePlatforms()
            ]);

            // Determine overall health
            let overall: 'healthy' | 'warning' | 'critical' = 'healthy';
            
            if (!this.isInitialized || !systemStatus.initialized) {
                overall = 'critical';
            } else if (moduleHealth.failedTasks > 0 || !processHealth.processIsolation) {
                overall = 'warning';
            }

            return {
                orchestrator: {
                    initialized: this.isInitialized,
                    shuttingDown: this.isShuttingDown,
                    uptime: process.uptime()
                },
                modules: moduleHealth,
                processes: processHealth,
                browser: browserInfo,
                database: {
                    connected: true, // Simplified check
                    path: this.dbpath
                },
                platforms: {
                    total: systemStatus.totalPlatforms,
                    active: systemStatus.activePlatforms,
                    available: activePlatforms.length
                },
                overall
            };

        } catch (error) {
            console.error('Failed to get system health status:', error);
            return {
                orchestrator: { initialized: false, shuttingDown: false, uptime: 0 },
                modules: null,
                processes: null,
                browser: null,
                database: null,
                platforms: null,
                overall: 'critical'
            };
        }
    }

    /**
     * Perform pre-flight checks before starting a task
     */
    private async performPreflightChecks(taskId: number): Promise<void> {
        console.log(`Performing pre-flight checks for task ${taskId}`);

        // Check system health
        const healthStatus = await this.getSystemHealthStatus();
        if (healthStatus.overall === 'critical') {
            throw new Error('System health is critical, cannot start task');
        }

        // Check if task exists and is in correct state
        const taskStatus = await this.getTaskStatus(taskId);
        if (taskStatus !== TaskStatus.Pending && taskStatus !== TaskStatus.Paused) {
            throw new Error(`Task ${taskId} is not in a startable state (current: ${TaskStatus[taskStatus]})`);
        }

        // Check if process is already running for this task
        if (this.processManager.isProcessRunning(taskId)) {
            throw new Error(`Task ${taskId} is already running`);
        }

        // Check browser availability
        try {
            await this.browserManager.getBrowserInfo();
        } catch (error) {
            throw new Error(`Browser not available: ${error.message}`);
        }

        console.log(`Pre-flight checks passed for task ${taskId}`);
    }

    /**
     * Ensure the orchestrator is initialized
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    /**
     * Get module instances (for advanced usage)
     */
    getModules() {
        return {
            yellowPages: this.yellowPagesModule,
            processManager: this.processManager,
            browserManager: this.browserManager,
            accountCookies: this.accountCookiesModule,
            taskModel: this.taskModel,
            platformModel: this.platformModel,
            resultModel: this.resultModel,
            initModule: this.initModule,
            healthCheck: this.healthCheck
        };
    }
}