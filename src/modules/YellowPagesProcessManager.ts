import { utilityProcess, MessageChannelMain } from 'electron';
import type { UtilityProcess } from 'electron';
import { YellowPagesTaskModel, YellowPagesTaskStatus } from "@/model/YellowPagesTask.model";
import { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import { PlatformRegistry } from "@/modules/PlatformRegistry";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { BaseModule } from "@/modules/baseModule";
import { ScrapingProgress } from "@/interfaces/IPCMessage";
import { WriteLog, getApplogspath, getRandomValues, getRecorddatetime } from "@/modules/lib/function";
import { USERLOGPATH, USEREMAIL } from '@/config/usersetting';
import { Token } from "@/modules/token";
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

interface ProcessInfo {
    taskId: number;
    process: UtilityProcess;
    startTime: Date;
    status: 'running' | 'completed' | 'failed' | 'stopped';
    progress?: ScrapingProgress;
    logFiles?: {
        runtimeLog: string;
        errorLog: string;
    };
}

interface TaskData {
    taskId: number;
    platform: string;
    keywords: string[];
    location: string;
    max_pages: number;
    delay_between_requests: number;
    account_id?: number;
    cookies?: any[];
    headless?: boolean;
    adapterClass?: {
        className: string;
        modulePath: string;
    };
}

interface PlatformInfo {
    id: number;
    name: string;
    display_name: string;
    base_url: string;
    settings: {
        searchUrlPattern?: string;
    };
    selectors: {
        businessList: string;
        businessName: string;
        email?: string;
        phone?: string;
        website?: string;
        address?: string;
        address_city?: string;
        address_state?: string;
        address_zip?: string;
        address_country?: string;
        socialMedia?: string;
        categories?: string;
        businessHours?: string;
        description?: string;
        rating?: string;
        reviewCount?: string;
        faxNumber?: string;
        contactPerson?: string;
        yearEstablished?: string;
        numberOfEmployees?: string;
        paymentMethods?: string;
        specialties?: string;
        searchForm?: {
            keywordInput?: string;
            locationInput?: string;
            searchButton?: string;
            formContainer?: string;
            categoryDropdown?: string;
            radiusDropdown?: string;
        };
        pagination?: {
            nextButton?: string;
            currentPage?: string;
            maxPages?: string;
            previousButton?: string;
            pageNumbers?: string;
            container?: string;
        };
    };
    adapterClass?: {
        className: string;
        modulePath: string;
    };
}

export class YellowPagesProcessManager extends BaseModule {
    private activeProcesses: Map<number, ProcessInfo> = new Map();
    private taskModel: YellowPagesTaskModel;
    private resultModel: YellowPagesResultModel;
    private platformRegistry: PlatformRegistry;
    private accountCookiesModule: AccountCookiesModule;

    constructor() {
        super();
        this.taskModel = new YellowPagesTaskModel(this.dbpath);
        this.resultModel = new YellowPagesResultModel(this.dbpath);
        this.platformRegistry = new PlatformRegistry();
        this.accountCookiesModule = new AccountCookiesModule();
    }

    /**
     * Get module path from a class constructor
     */
    private getModulePathFromClass(adapterClass: any): string {
        try {
            // Try to get the module path from the class
            if (adapterClass.__modulePath) {
                return adapterClass.__modulePath;
            }
            
            // Fallback: try to infer from the class name
            const className = adapterClass.name;
            if (className.includes('Adapter')) {
                // Convert class name to file name convention
                const fileName = className.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
                return `@/modules/platforms/${fileName}`;
            }
            
            // Default fallback
            return `@/modules/platforms/${adapterClass.name}`;
        } catch (error) {
            console.warn('Could not determine module path for adapter class:', error);
            return `@/modules/platforms/${adapterClass.name}`;
        }
    }

    /**
     * Spawn a child process for Yellow Pages scraping
     */
    async spawnScraperProcess(taskId: number): Promise<UtilityProcess> {
        try {
            console.log(`Spawning Yellow Pages scraper process for task ${taskId}`);

            // Check if process already exists
            if (this.activeProcesses.has(taskId)) {
                throw new Error(`Process for task ${taskId} already exists`);
            }

            // Get task details from database
            const task = await this.taskModel.getTaskById(taskId);
            if (!task) {
                throw new Error(`Task ${taskId} not found`);
            }

            // Get platform details from registry
            const platform = this.platformRegistry
                .getAllPlatforms()
                .find(p => p.id === task.platform || p.name === task.platform || p.display_name === task.platform);
            if (!platform) {
                throw new Error(`Platform ${task.platform} not found`);
            }

            // Parse keywords from JSON
            const keywords = JSON.parse(task.keywords);

            // Prepare task data for child process
            const taskData: TaskData = {
                taskId: taskId,
                platform: task.platform,
                keywords: keywords,
                location: task.location,
                max_pages: task.max_pages,
                delay_between_requests: task.delay_between_requests,
                account_id: task.account_id,
                headless: task.headless !== undefined ? task.headless : true // Use task configuration or default to headless
            };

            // Add adapter class information if available
            if (platform.adapter_class) {
                // Get the class name and module path from the adapter class
                const adapterClassName = platform.adapter_class.name;
                const modulePath = this.getModulePathFromClass(platform.adapter_class);
                
                taskData.adapterClass = {
                    className: adapterClassName,
                    modulePath: modulePath
                };
            }

            // Get cookies if account is specified
            if (task.account_id) {
                const accountCookies = await this.accountCookiesModule.getAccountCookies(task.account_id);
                if (accountCookies && accountCookies.cookies) {
                    taskData.cookies = JSON.parse(accountCookies.cookies);
                }
            }

            // Prepare platform info for child process
            const platformInfo: PlatformInfo = {
                id: Number(platform.id),
                name: platform.name,
                display_name: platform.display_name,
                base_url: platform.base_url,
                settings: platform.settings || {},
                selectors: {
                    businessList: platform.selectors?.businessList || '',
                    businessName: platform.selectors?.businessName || '',
                    email: platform.selectors?.email,
                    phone: platform.selectors?.phone,
                    website: platform.selectors?.website,
                    address: platform.selectors?.address,
                    address_city: platform.selectors?.address_city,
                    address_state: platform.selectors?.address_state,
                    address_zip: platform.selectors?.address_zip,
                    address_country: platform.selectors?.address_country,
                    socialMedia: platform.selectors?.socialMedia,
                    categories: platform.selectors?.categories,
                    businessHours: platform.selectors?.businessHours,
                    description: platform.selectors?.description,
                    rating: platform.selectors?.rating,
                    reviewCount: platform.selectors?.reviewCount,
                    faxNumber: platform.selectors?.faxNumber,
                    contactPerson: platform.selectors?.contactPerson,
                    yearEstablished: platform.selectors?.yearEstablished,
                    numberOfEmployees: platform.selectors?.numberOfEmployees,
                    paymentMethods: platform.selectors?.paymentMethods,
                    specialties: platform.selectors?.specialties,
                    searchForm: platform.selectors?.searchForm && typeof platform.selectors.searchForm === 'object' && 'keywordInput' in platform.selectors.searchForm ? platform.selectors.searchForm : undefined,
                    pagination: platform.selectors?.pagination && typeof platform.selectors.pagination === 'object' && 'nextButton' in platform.selectors.pagination ? platform.selectors.pagination : undefined
                },
                adapterClass: taskData.adapterClass
            };

            // Set up log files for the task
            const tokenService = new Token();
            let logpath = tokenService.getValue(USERLOGPATH);
            if (!logpath) {
                const useremail = tokenService.getValue(USEREMAIL);
                logpath = getApplogspath(useremail);
            }
            
            const uuid = uuidv4({ random: getRandomValues(new Uint8Array(16)) });
            const errorLogfile = path.join(logpath, 'yellowpages_' + taskId + '_' + uuid + '.error.log');
            const runLogfile = path.join(logpath, 'yellowpages_' + taskId + '_' + uuid + '.runtime.log');
            
            // Update task with log file paths
            await this.taskModel.updateTaskRunLog(taskId, runLogfile);
            await this.taskModel.updateTaskErrorLog(taskId, `Log files initialized - Runtime: ${runLogfile}, Error: ${errorLogfile}`);

            // Resolve scraper path and validate existence
            //const childPath = path.resolve(process.cwd(), 'dist/childprocess/yellowPagesScraper.js');
            const childPath = path.join(__dirname, 'yellowPagesScraper.js')
            if (!fs.existsSync(childPath)) {
                throw new Error(`Child process file not found at path: ${childPath}`);
            }

            // Create message channel for IPC communication
            const { port1, port2 } = new MessageChannelMain();

            // Fork the child process using Electron utilityProcess
            const childProcess = utilityProcess.fork(childPath, [], {
                stdio: 'pipe',
                execArgv: ["puppeteer-cluster:*"],
                env: {
                    ...process.env,
                    NODE_OPTIONS: ""
                }
            });

            // Set up process info
            const processInfo: ProcessInfo = {
                taskId,
                process: childProcess,
                startTime: new Date(),
                status: 'running',
                logFiles: {
                    runtimeLog: runLogfile,
                    errorLog: errorLogfile
                }
            };

            this.activeProcesses.set(taskId, processInfo);

            // Set up IPC handlers
            this.setupIPCHandlers(childProcess, taskId);

            // Set up error handlers
            this.setupErrorHandlers(childProcess, taskId);

            // Set up stdout handler
            childProcess.stdout?.on('data', (data) => {
                console.log(`Received stdout from task ${taskId}: ${data}`);
                // Write to runtime log file
                WriteLog(runLogfile, data.toString());
            });

            // Set up stderr handler
            childProcess.stderr?.on('data', (data) => {
                const ignoreStr = ["Debugger attached", "Waiting for the debugger to disconnect", "Most NODE_OPTIONs are not supported in packaged apps"];
                if (!ignoreStr.some((value) => data.includes(value))) {
                    console.log(`Received stderr from task ${taskId}: ${data}`);
                    // Write to error log file
                    WriteLog(errorLogfile, data.toString());
                    // Update task error log in database
                    this.taskModel.updateTaskErrorLog(taskId, `Stderr: ${data}`).catch(err => {
                        console.error(`Failed to update error log for task ${taskId}:`, err);
                    });
                }
            });

            // Send start message to child process when spawned
            childProcess.on('spawn', () => {
                console.log("child process satart, pid is" + childProcess.pid)
                // Update task status to in-progress
                this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.InProgress);
                
                // Send task data and platform info to child process
                childProcess.postMessage(JSON.stringify({ 
                    type: 'START', 
                    taskData, 
                    platformInfo 
                }), [port1]);
            });

            console.log(`Successfully spawned process for task ${taskId}`);
            return childProcess;

        } catch (error) {
            console.error(`Failed to spawn process for task ${taskId}:`, error);
            throw error;
        }
        
    }

    /**
     * Set up IPC message handlers
     */
    private setupIPCHandlers(childProcess: UtilityProcess, taskId: number): void {
        childProcess.on('message', (raw: unknown) => {
            let message: any;
            try {
                if (typeof raw === 'string') {
                    message = JSON.parse(raw);
                } else {
                    message = raw;
                }
            } catch (err) {
                console.error(`Failed to parse message from task ${taskId}:`, raw);
                return;
            }

            if (!message) return;
            console.log(`Received message from task ${taskId}:`, message);

            // Get log file paths for this task
            const processInfo = this.activeProcesses.get(taskId);
            if (processInfo?.logFiles) {
                // Log important messages to runtime log
                const logMessage = `[${new Date().toISOString()}] ${message.type}: ${JSON.stringify(message)}`;
                WriteLog(processInfo.logFiles.runtimeLog, logMessage);
            }

            switch (message.type) {
                case 'PROGRESS':
                    if (message.progress) {
                        this.handleProgressMessage(taskId, message.progress);
                    }
                    break;
                case 'COMPLETED':
                    this.handleCompletionMessage(taskId, message.results);
                    break;
                case 'ERROR':
                    this.handleErrorMessage(taskId, message.error || 'Unknown error');
                    break;
                case 'SCRAPING_STARTED':
                    console.log(`Scraping started for task ${taskId}`);
                    break;
                case 'SCRAPING_PAGE_COMPLETE':
                    if (message.page && message.totalPages) {
                        console.log(`Task ${taskId}: Completed page ${message.page}/${message.totalPages}`);
                    }
                    break;
                case 'SCRAPING_RESULT_FOUND':
                    if (message.result) {
                        console.log(`Task ${taskId}: Found result - ${message.result.businessName || 'Unknown business'}`);
                    }
                    break;
                case 'SCRAPING_RATE_LIMITED':
                    console.log(`Task ${taskId}: Rate limited, waiting before next request`);
                    break;
                case 'SCRAPING_CAPTCHA_DETECTED':
                    console.log(`Task ${taskId}: CAPTCHA detected, may need manual intervention`);
                    break;
                default:
                    console.log(`Unknown message type from task ${taskId}:`, message.type);
            }
        });
    }

    /**
     * Set up error handlers
     */
    private setupErrorHandlers(childProcess: UtilityProcess, taskId: number): void {
        childProcess.on('spawn', () => {
            console.log(`Process spawned for task ${taskId}`);
        });

        // Handle process exit - this ensures task status is properly updated in the database
        childProcess.on('exit', (code: number) => {
            console.log(`Process exited for task ${taskId}: code=${code}`);
            
            // Get process info for logging
            const processInfo = this.activeProcesses.get(taskId);
            
            // Log exit to appropriate log file
            if (processInfo?.logFiles) {
                if (code !== 0) {
                    const errorMessage = `[${new Date().toISOString()}] Process exited with code ${code}`;
                    WriteLog(processInfo.logFiles.errorLog, errorMessage);
                } else {
                    const successMessage = `[${new Date().toISOString()}] Process exited successfully with code ${code}`;
                    WriteLog(processInfo.logFiles.runtimeLog, successMessage);
                }
            }
            
            // Update task status based on exit code
            // Only update if the process is still in 'running' state to avoid overwriting
            // successful completion statuses that might have been set via IPC messages
            if (code !== 0) {
                console.error(`Child process exited with code ${code}`);
                // Only update status if not already completed or failed
                if (processInfo?.status === 'running') {
                    this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Failed).catch(err => {
                        console.error(`Failed to update task status for task ${taskId}:`, err);
                    });
                } else {
                    console.log(`Task ${taskId} already has status: ${processInfo?.status}, not updating to Failed`);
                }
            } else {
                console.log('Child process exited successfully');
                // Only update status if not already completed
                if (processInfo?.status === 'running') {
                    this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Completed).catch(err => {
                        console.error(`Failed to update task status for task ${taskId}:`, err);
                    });
                } else {
                    console.log(`Task ${taskId} already has status: ${processInfo?.status}, not updating to Completed`);
                }
            }
            
            // Handle process exit (cleanup, etc.)
            this.handleProcessExit(taskId, code, null);
        });
    }

    /**
     * Handle progress messages from child process
     */
    private handleProgressMessage(taskId: number, progress: ScrapingProgress): void {
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            processInfo.progress = progress;
            console.log(`Progress for task ${taskId}:`, progress);
            
            // Log progress to runtime log file
            if (processInfo.logFiles) {
                const progressMessage = `[${new Date().toISOString()}] Progress: ${JSON.stringify(progress)}`;
                WriteLog(processInfo.logFiles.runtimeLog, progressMessage);
            }
        }
    }

    /**
     * Handle completion messages from child process
     */
    private async handleCompletionMessage(taskId: number, results: any[]): Promise<void> {
        console.log(`Task ${taskId} completed successfully with ${results.length} results`);
        
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            processInfo.status = 'completed';
            
            // Log completion to runtime log file
            if (processInfo.logFiles) {
                const completionMessage = `[${new Date().toISOString()}] Task completed successfully with ${results.length} results`;
                WriteLog(processInfo.logFiles.runtimeLog, completionMessage);
            }
        }

        try {
            // Save results to database
            if (results && results.length > 0) {
                const resultIds = await this.resultModel.saveMultipleResults(
                    results.map(result => ({
                        ...result,
                        task_id: taskId,
                        platform: processInfo?.process ? 'yellowpages' : 'unknown'
                    }))
                );
                console.log(`Saved ${resultIds.length} results for task ${taskId}`);
                
                // Log results saved to runtime log file
                if (processInfo?.logFiles) {
                    const resultsMessage = `[${new Date().toISOString()}] Saved ${resultIds.length} results to database`;
                    WriteLog(processInfo.logFiles.runtimeLog, resultsMessage);
                }
            }

            // Update task status in database
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Completed);
            await this.taskModel.updateTaskCompletion(taskId);
        } catch (error) {
            console.error(`Failed to save results or update task ${taskId} status:`, error);
            // Update task status to failed if saving results fails
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Failed);
            await this.taskModel.updateTaskErrorLog(taskId, `Failed to save results: ${error}`);
            
            // Log error to error log file
            if (processInfo?.logFiles) {
                const errorMessage = `[${new Date().toISOString()}] Failed to save results: ${error}`;
                WriteLog(processInfo.logFiles.errorLog, errorMessage);
            }
        }

        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Handle error messages from child process
     */
    private async handleErrorMessage(taskId: number, error: string): Promise<void> {
        console.error(`Task ${taskId} failed:`, error);
        
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            processInfo.status = 'failed';
            
            // Log error to error log file
            if (processInfo.logFiles) {
                const errorMessage = `[${new Date().toISOString()}] Task failed: ${error}`;
                WriteLog(processInfo.logFiles.errorLog, errorMessage);
            }
        }

        // Update task status in database
        try {
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Failed);
            await this.taskModel.updateTaskErrorLog(taskId, error);
        } catch (dbError) {
            console.error(`Failed to update task ${taskId} error status:`, dbError);
            
            // Log database error to error log file
            if (processInfo?.logFiles) {
                const dbErrorMessage = `[${new Date().toISOString()}] Failed to update task error status: ${dbError}`;
                WriteLog(processInfo.logFiles.errorLog, dbErrorMessage);
            }
        }

        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Handle process exit
     */
    private handleProcessExit(taskId: number, code: number | null, signal: string | null): void {
        console.log(`Process exit for task ${taskId}: code=${code}, signal=${signal}`);
        
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            // Update local process status
            if (code === 0) {
                processInfo.status = 'completed';
            } else {
                processInfo.status = 'failed';
            }
            
            // Log final status to appropriate log file
            if (processInfo.logFiles) {
                const finalStatusMessage = `[${new Date().toISOString()}] Process final status: ${processInfo.status} (exit code: ${code}${signal ? `, signal: ${signal}` : ''})`;
                if (processInfo.status === 'completed') {
                    WriteLog(processInfo.logFiles.runtimeLog, finalStatusMessage);
                } else {
                    WriteLog(processInfo.logFiles.errorLog, finalStatusMessage);
                }
            }
        }

        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Handle process close
     */
    private handleProcessClose(taskId: number, code: number | null): void {
        console.log(`Process close for task ${taskId}: code=${code}`);
        
        // Clean up process
        this.cleanupProcess(taskId);
    }

    /**
     * Terminate a specific process
     */
    async terminateProcess(taskId: number): Promise<void> {
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            console.log(`Terminating process for task ${taskId}`);
            
            // Log termination to runtime log file
            if (processInfo.logFiles) {
                const terminationMessage = `[${new Date().toISOString()}] Process terminated by user`;
                WriteLog(processInfo.logFiles.runtimeLog, terminationMessage);
            }
            
            try {
                processInfo.process.kill();
                processInfo.status = 'stopped';
                
                // Update task status
                await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Paused);
                
                // Clean up after a short delay
                setTimeout(() => {
                    this.cleanupProcess(taskId);
                }, 1000);
                
            } catch (error) {
                console.error(`Failed to terminate process for task ${taskId}:`, error);
                
                // Log termination error to error log file
                if (processInfo.logFiles) {
                    const errorMessage = `[${new Date().toISOString()}] Failed to terminate process: ${error}`;
                    WriteLog(processInfo.logFiles.errorLog, errorMessage);
                }
            }
        } else {
            console.log(`No active process found for task ${taskId}`);
        }
    }

    /**
     * Get all active processes
     */
    getActiveProcesses(): Map<number, ProcessInfo> {
        return this.activeProcesses;
    }

    /**
     * Get process info for a specific task
     */
    getProcessInfo(taskId: number): ProcessInfo | undefined {
        return this.activeProcesses.get(taskId);
    }

    /**
     * Check if a process is running
     */
    isProcessRunning(taskId: number): boolean {
        const processInfo = this.activeProcesses.get(taskId);
        return processInfo?.status === 'running';
    }

    /**
     * Get process count
     */
    getProcessCount(): number {
        return this.activeProcesses.size;
    }

    /**
     * Clean up process resources
     */
    private cleanupProcess(taskId: number): void {
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            // Log cleanup to runtime log file
            if (processInfo.logFiles) {
                const cleanupMessage = `[${new Date().toISOString()}] Process cleanup completed`;
                WriteLog(processInfo.logFiles.runtimeLog, cleanupMessage);
            }
            
            // Remove from active processes
            this.activeProcesses.delete(taskId);
            console.log(`Cleaned up process for task ${taskId}`);
        }
    }

    /**
     * Terminate all active processes
     */
    async terminateAllProcesses(): Promise<void> {
        console.log('Terminating all active processes...');
        
        const promises = Array.from(this.activeProcesses.keys()).map(taskId =>
            this.terminateProcess(taskId)
        );
        
        await Promise.all(promises);
        console.log('All processes terminated');
    }

    /**
     * Health check for process isolation
     */
    async healthCheck(): Promise<{
        totalProcesses: number;
        runningProcesses: number;
        completedProcesses: number;
        failedProcesses: number;
        processIsolation: boolean;
    }> {
        const processes = Array.from(this.activeProcesses.values());
        const running = processes.filter(p => p.status === 'running').length;
        const completed = processes.filter(p => p.status === 'completed').length;
        const failed = processes.filter(p => p.status === 'failed').length;

        // Check process isolation by verifying each process has its own PID
        const pids = processes.map(p => p.process.pid);
        const uniquePids = new Set(pids);
        const processIsolation = uniquePids.size === pids.length;

        return {
            totalProcesses: processes.length,
            runningProcesses: running,
            completedProcesses: completed,
            failedProcesses: failed,
            processIsolation
        };
    }
} 