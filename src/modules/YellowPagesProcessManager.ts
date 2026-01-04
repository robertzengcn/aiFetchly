import { utilityProcess, MessageChannelMain, app } from 'electron';
import type { UtilityProcess } from 'electron';
import { YellowPagesTaskModel, YellowPagesTaskStatus } from "@/model/YellowPagesTask.model";
import { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import { PlatformRegistry } from "@/modules/PlatformRegistry";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { BaseModule } from "@/modules/baseModule";
import { ScrapingProgress } from "@/modules/interface/IPCMessage";
import { 
    BackgroundProcessMessage, 
    StartTaskMessage, 
    ProgressMessage, 
    CompletedMessage, 
    ErrorMessage,
    ScrapingStartedMessage,
    ScrapingPageCompleteMessage,
    ScrapingResultFoundMessage,
    ScrapingRateLimitedMessage,
    ScrapingCaptchaDetectedMessage,
    ScrapingCloudflareDetectedMessage,
    ScrapingPausedCloudflareMessage,
    ScrapingRobotVerificationDetectedMessage,
    PauseTaskMessage,
    ResumeTaskMessage,
    TaskPausedMessage,
    TaskResumedMessage,
    ExitTaskMessage,
    isStartTaskMessage,
    isProgressMessage,
    isCompletedMessage,
    isErrorMessage
} from "@/modules/interface/BackgroundProcessMessages";
import { WriteLog, getApplogspath, getRandomValues, getRecorddatetime, sendSystemMessage } from "@/modules/lib/function";
import { USERLOGPATH, USEREMAIL } from '@/config/usersetting';
import { Token } from "@/modules/token";
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { YellowPagesTaskEntity } from "@/entity/YellowPagesTask.entity";

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



type TaskData = StartTaskMessage['taskData'];
type PlatformInfo = StartTaskMessage['platformInfo'];

/**
 * Yellow Pages Process Manager
 * 
 * Manages child processes for Yellow Pages scraping tasks.
 * Handles process spawning, termination, and IPC communication.
 * 
 * Implemented as a Singleton to ensure:
 * - Single instance across the application
 * - Shared process state and management
 * - Consistent process lifecycle control
 * - Centralized process resource management
 */
export class YellowPagesProcessManager extends BaseModule {
    private static instance: YellowPagesProcessManager | null = null;
    
    private activeProcesses: Map<number, ProcessInfo> = new Map();
    private taskModel: YellowPagesTaskModel;
    private resultModel: YellowPagesResultModel;
    private platformRegistry: PlatformRegistry;
    private accountCookiesModule: AccountCookiesModule;

    /**
     * Private constructor to prevent direct instantiation
     * Use getInstance() method to access the singleton instance
     */
    private constructor() {
        super();
        this.taskModel = new YellowPagesTaskModel(this.dbpath);
        this.resultModel = new YellowPagesResultModel(this.dbpath);
        this.platformRegistry = new PlatformRegistry();
        this.accountCookiesModule = new AccountCookiesModule();
    }

    /**
     * Get the singleton instance of YellowPagesProcessManager
     * Creates a new instance if one doesn't exist
     * @returns The singleton instance of YellowPagesProcessManager
     */
    public static getInstance(): YellowPagesProcessManager {
        if (YellowPagesProcessManager.instance === null) {
            YellowPagesProcessManager.instance = new YellowPagesProcessManager();
        }
        return YellowPagesProcessManager.instance;
    }

    /**
     * Reset the singleton instance (useful for testing or cleanup)
     * @private - Use with caution, mainly for testing purposes
     */
    public static resetInstance(): void {
        YellowPagesProcessManager.instance = null;
    }

    /**
     * Check if a singleton instance exists
     * @returns true if an instance exists, false otherwise
     */
    public static hasInstance(): boolean {
        return YellowPagesProcessManager.instance !== null;
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
                location: task.location || '',
                max_pages: task.max_pages,
                delay_between_requests: task.delay_between_requests,
                account_id: task.account_id,
                headless: task.headless !== undefined ? task.headless : true, // Use task configuration or default to headless
                userDataPath: app.getPath('userData') // Add user data path for child process
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
                    businessItem: platform.selectors?.businessItem || '',
                    businessName: platform.selectors?.businessName || '',
                    detailPageLink: platform.selectors?.detailPageLink,
                    phone: platform.selectors?.phone,
                    email: platform.selectors?.email,
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
                    logo: platform.selectors?.logo,
                    photos: platform.selectors?.photos,
                    businessImage: platform.selectors?.businessImage,
                    businessUrl: platform.selectors?.businessUrl,
                    map: platform.selectors?.map,
                    status: platform.selectors?.status,
                    priceRange: platform.selectors?.priceRange,
                    certifications: platform.selectors?.certifications,
                    licenses: platform.selectors?.licenses,
                    insurance: platform.selectors?.insurance,
                    associations: platform.selectors?.associations,
                    awards: platform.selectors?.awards,
                    hours: platform.selectors?.hours && typeof platform.selectors.hours === 'object' && 'container' in platform.selectors.hours ? platform.selectors.hours : undefined,
                    services: platform.selectors?.services,
                    products: platform.selectors?.products,
                    team: platform.selectors?.team,
                    testimonials: platform.selectors?.testimonials,
                    reviews: platform.selectors?.reviews && typeof platform.selectors.reviews === 'object' && 'container' in platform.selectors.reviews ? platform.selectors.reviews : undefined,
                    events: platform.selectors?.events,
                    news: platform.selectors?.news,
                    blog: platform.selectors?.blog,
                    gallery: platform.selectors?.gallery,
                    videos: platform.selectors?.videos,
                    contactForm: platform.selectors?.contactForm,
                    appointmentBooking: platform.selectors?.appointmentBooking,
                    onlineOrdering: platform.selectors?.onlineOrdering,
                    paymentOptions: platform.selectors?.paymentOptions,
                    accessibility: platform.selectors?.accessibility,
                    parking: platform.selectors?.parking,
                    wifi: platform.selectors?.wifi,
                    petPolicy: platform.selectors?.petPolicy,
                    smokingPolicy: platform.selectors?.smokingPolicy,
                    dressCode: platform.selectors?.dressCode,
                    ageRestrictions: platform.selectors?.ageRestrictions,
                    searchForm: platform.selectors?.searchForm && typeof platform.selectors.searchForm === 'object' && 'keywordInput' in platform.selectors.searchForm ? platform.selectors.searchForm : undefined,
                    pagination: platform.selectors?.pagination && typeof platform.selectors.pagination === 'object' && 'nextButton' in platform.selectors.pagination ? platform.selectors.pagination : undefined,
                    navigation: platform.selectors?.navigation && typeof platform.selectors.navigation === 'object' && 'detailLink' in platform.selectors.navigation ? platform.selectors.navigation : undefined
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
                
                // Save the process PID to database for future management
                if (childProcess.pid) {
                    this.taskModel.updateTaskPID(taskId, childProcess.pid).catch(err => {
                        console.error(`Failed to update PID for task ${taskId}:`, err);
                    });
                }
                
                // Update task status to in-progress
                this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.InProgress);
                
                // Send task data and platform info to child process
                const startMessage: StartTaskMessage = {
                    type: 'START',
                    taskId,
                    taskData,
                    platformInfo
                };
                childProcess.postMessage(JSON.stringify(startMessage), [port1]);
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
            let message: BackgroundProcessMessage;
            try {
                if (typeof raw === 'string') {
                    message = JSON.parse(raw);
                } else {
                    message = raw as BackgroundProcessMessage;
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
                    if (isProgressMessage(message)) {
                        this.handleProgressMessage(taskId, message.progress);
                    }
                    break;
                case 'COMPLETED':
                    if (isCompletedMessage(message)) {
                        this.handleCompletionMessage(taskId, message.results);
                    }
                    break;
                case 'ERROR':
                    if (isErrorMessage(message)) {
                        this.handleErrorMessage(taskId, message.error);
                    }
                    break;
                case 'SCRAPING_STARTED':
                    console.log(`Scraping started for task ${taskId}`);
                    break;
                case 'SCRAPING_PAGE_COMPLETE':
                    if (message.type === 'SCRAPING_PAGE_COMPLETE' && message.page && message.totalPages) {
                        console.log(`Task ${taskId}: Completed page ${message.page}/${message.totalPages}`);
                    }
                    break;
                case 'SCRAPING_RESULT_FOUND':
                    if (message.type === 'SCRAPING_RESULT_FOUND' && message.result) {
                        console.log(`Task ${taskId}: Found result - ${message.result.businessName || 'Unknown business'}`);
                    }
                    break;
                case 'SCRAPING_RATE_LIMITED':
                    console.log(`Task ${taskId}: Rate limited, waiting before next request`);
                    break;
                case 'SCRAPING_CAPTCHA_DETECTED':
                    console.log(`Task ${taskId}: CAPTCHA detected, may need manual intervention`);
                    // Send system message to frontend to notify user
                    sendSystemMessage({
                        status: true,
                        data: {
                            title: 'CAPTCHA Detected',
                            content: `Yellow Pages task ${taskId} has detected a CAPTCHA challenge. Manual intervention may be required to continue scraping.`
                        }
                    });
                    // Log to error log for user notification
                    if (processInfo?.logFiles) {
                        const captchaMessage = `[${new Date().toISOString()}] CAPTCHA DETECTED: Task ${taskId} has detected a CAPTCHA challenge. Manual intervention may be required.`;
                        WriteLog(processInfo.logFiles.errorLog, captchaMessage);
                    }
                    break;
                case 'SCRAPING_CLOUDFLARE_DETECTED':
                    if (message.type === 'SCRAPING_CLOUDFLARE_DETECTED') {
                        const contentMessage = message.content || `Cloudflare protection detected at ${message.details?.url || 'unknown URL'}`;
                        console.log(`Task ${taskId}: ${contentMessage}`);
                        console.log(`Additional info: ${message.details?.additionalInfo || 'No additional info available'}`);
                        
                        // Send system message to frontend to notify user
                        sendSystemMessage({
                            status: true,
                            data: {
                                title: 'Cloudflare Protection Detected',
                                content: `Yellow Pages task ${taskId} has detected Cloudflare protection. This may temporarily block scraping. URL: ${message.details?.url || 'unknown'}`
                            }
                        });
                        
                        // Log to error log for user notification
                        if (processInfo?.logFiles) {
                            const cloudflareMessage = `[${new Date().toISOString()}] CLOUDFLARE DETECTED: ${contentMessage}. URL: ${message.details?.url || 'unknown'}, Timestamp: ${message.details?.timestamp || 'unknown'}, Info: ${message.details?.additionalInfo || 'No additional info'}`;
                            WriteLog(processInfo.logFiles.errorLog, cloudflareMessage);
                        }
                    }
                    break;
                case 'SCRAPING_PAUSED_CLOUDFLARE':
                    const pauseContentMessage = message.content || 'Scraping paused due to Cloudflare protection';
                    console.log(`Task ${taskId}: ${pauseContentMessage}`);
                    
                    // Send system message to frontend to notify user
                    sendSystemMessage({
                        status: true,
                        data: {
                            title: 'Scraping Paused - Cloudflare Protection',
                            content: `Yellow Pages task ${taskId} has been paused due to Cloudflare protection. The task will remain paused until manually resumed.`
                        }
                    });
                    
                    // Log to error log for user notification
                    if (processInfo?.logFiles) {
                        const cloudflarePauseMessage = `[${new Date().toISOString()}] CLOUDFLARE PAUSE: ${pauseContentMessage}`;
                        WriteLog(processInfo.logFiles.errorLog, cloudflarePauseMessage);
                    }
                    
                    // Update task status to paused due to Cloudflare protection
                    this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Paused).catch(err => {
                        console.error(`Failed to update task status to paused for task ${taskId}:`, err);
                    });
                    
                    // Update task error log with Cloudflare pause information
                    const cloudflarePauseErrorLog = `Scraping paused due to Cloudflare protection. Manual intervention required - wait 15-30 minutes before retrying.`;
                    this.taskModel.updateTaskErrorLog(taskId, cloudflarePauseErrorLog).catch(err => {
                        console.error(`Failed to update error log for task ${taskId}:`, err);
                    });
                    break;
                case 'SCRAPING_ROBOT_VERIFICATION_DETECTED':
                    if (message.type === 'SCRAPING_ROBOT_VERIFICATION_DETECTED') {
                        const robotContentMessage = message.content || `Robot verification challenge detected at ${message.details?.url || 'unknown URL'}`;
                        console.log(`Task ${taskId}: ${robotContentMessage}`);
                        console.log(`Additional info: ${message.details?.additionalInfo || 'No additional info available'}`);
                        
                        // Send system message to frontend to notify user
                        sendSystemMessage({
                            status: true,
                            data: {
                                title: 'Robot Verification Challenge Detected',
                                content: `Yellow Pages task ${taskId} has detected a robot verification challenge. The task has been paused and requires manual intervention to complete the verification. URL: ${message.details?.url || 'unknown'}`
                            }
                        });
                        
                        // Log to error log for user notification
                        if (processInfo?.logFiles) {
                            const robotVerificationMessage = `[${new Date().toISOString()}] ROBOT VERIFICATION DETECTED: ${robotContentMessage}. URL: ${message.details?.url || 'unknown'}, Timestamp: ${message.details?.timestamp || 'unknown'}, Info: ${message.details?.additionalInfo || 'No additional info'}`;
                            WriteLog(processInfo.logFiles.errorLog, robotVerificationMessage);
                        }
                        
                        // Update task status to paused due to robot verification challenge
                        this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Paused).catch(err => {
                            console.error(`Failed to update task status to paused for task ${taskId}:`, err);
                        });
                        
                        // Update task error log with robot verification pause information
                        const robotVerificationPauseErrorLog = `Scraping paused due to robot verification challenge. Manual intervention required - complete the verification and resume the task.`;
                        this.taskModel.updateTaskErrorLog(taskId, robotVerificationPauseErrorLog).catch(err => {
                            console.error(`Failed to update error log for task ${taskId}:`, err);
                        });
                    }
                    break;
                case 'TASK_PAUSED':
                    const pausedMessage = message.content || `Task ${taskId} paused successfully`;
                    console.log(pausedMessage);
                    
                    // Update task status to paused
                    this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Paused).catch(err => {
                        console.error(`Failed to update task status to paused for task ${taskId}:`, err);
                    });
                    
                    // Send system message to frontend to notify user
                    sendSystemMessage({
                        status: true,
                        data: {
                            title: 'Task Paused',
                            content: message.content || `Yellow Pages task ${taskId} has been paused successfully.`
                        }
                    });
                    break;
                case 'TASK_RESUMED':
                    const resumedMessage = message.content || `Task ${taskId} resumed successfully`;
                    console.log(resumedMessage);
                    
                    // Update task status to in-progress
                    this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.InProgress).catch(err => {
                        console.error(`Failed to update task status to in-progress for task ${taskId}:`, err);
                    });
                    
                    // Send system message to frontend to notify user
                    sendSystemMessage({
                        status: true,
                        data: {
                            title: 'Task Resumed',
                            content: message.content || `Yellow Pages task ${taskId} has been resumed successfully.`
                        }
                    });
                    break;
                case 'EXIT':
                    console.log(`Task ${taskId} received exit request`);
                    // The child process should handle this and exit gracefully
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
            
            // Only update task status if not already handled by IPC messages
            // This prevents overwriting successful completion statuses set via COMPLETED messages
            if (processInfo?.status === 'running') {
                if (code !== 0) {
                    console.error(`Child process exited with code ${code} - updating task status to Failed`);
                    this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Failed).catch(err => {
                        console.error(`Failed to update task status for task ${taskId}:`, err);
                    });
                } else {
                    console.log(`Child process exited successfully - updating task status to Completed`);
                    this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Completed).catch(err => {
                        console.error(`Failed to update task status for task ${taskId}:`, err);
                    });
                }
            } else {
                console.log(`Task ${taskId} already has status: ${processInfo?.status}, not updating from exit code`);
            }
            
            // Log the final process status for debugging
            console.log(`Final process status for task ${taskId}: ${processInfo?.status}, exit code: ${code}`);
            
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
                const saveResult = await this.resultModel.saveMultipleResults(
                    results.map(result => ({
                        ...result,
                        task_id: taskId,
                        platform: processInfo?.process ? 'yellowpages' : 'unknown'
                    }))
                );
                console.log(`Saved ${saveResult.createdIds.length} results for task ${taskId} (${saveResult.duplicateCount} duplicates found)`);
                
                // Log results saved to runtime log file
                if (processInfo?.logFiles) {
                    const resultsMessage = `[${new Date().toISOString()}] Saved ${saveResult.createdIds.length} results to database (${saveResult.duplicateCount} duplicates found)`;
                    WriteLog(processInfo.logFiles.runtimeLog, resultsMessage);
                }
            }

            // Update task status in database
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Completed);
            await this.taskModel.updateTaskCompletion(taskId);
            
            // Clear the PID since task is completed
            await this.taskModel.clearTaskPID(taskId);
            
            console.log(`Task ${taskId} status updated to Completed in database`);
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

        // Terminate the child process gracefully after completion
        if (processInfo?.process) {
            try {
                console.log(`Terminating completed child process for task ${taskId}`);
                
                // First try to send an exit message for graceful shutdown
                await this.requestProcessExit(taskId);
                
                // Wait a moment for graceful exit, then force kill if needed
                setTimeout(() => {
                    console.log(`Force killing process for task ${taskId}`);
                    processInfo.process.kill();
                    
                    // Clean up after termination
                    setTimeout(() => {
                        this.cleanupProcess(taskId);
                    }, 500);
                }, 2000);
                
            } catch (terminateError) {
                console.error(`Failed to terminate completed process for task ${taskId}:`, terminateError);
                // Clean up immediately if termination fails
                this.cleanupProcess(taskId);
            }
        } else {
            // Clean up immediately if no process info
            this.cleanupProcess(taskId);
        }
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
            
            // Clear the PID since task is failed
            await this.taskModel.clearTaskPID(taskId);
            
            console.log(`Task ${taskId} status updated to Failed in database`);
        } catch (dbError) {
            console.error(`Failed to update task ${taskId} error status:`, dbError);
            
            // Log database error to error log file
            if (processInfo?.logFiles) {
                const dbErrorMessage = `[${new Date().toISOString()}] Failed to update task error status: ${dbError}`;
                WriteLog(processInfo.logFiles.errorLog, dbErrorMessage);
            }
        }

        // Terminate the child process gracefully after error handling
        if (processInfo?.process) {
            try {
                console.log(`Terminating failed child process for task ${taskId}`);
                
                // First try to send an exit message for graceful shutdown
                await this.requestProcessExit(taskId);
                
                // Wait a moment for graceful exit, then force kill if needed
                setTimeout(() => {
                    console.log(`Force killing failed process for task ${taskId}`);
                    processInfo.process.kill();
                    
                    // Clean up after termination
                    setTimeout(() => {
                        this.cleanupProcess(taskId);
                    }, 500);
                }, 2000);
                
            } catch (terminateError) {
                console.error(`Failed to terminate failed process for task ${taskId}:`, terminateError);
                // Clean up immediately if termination fails
                this.cleanupProcess(taskId);
            }
        } else {
            // Clean up immediately if no process info
            this.cleanupProcess(taskId);
        }
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
    async terminateProcess(taskId: number): Promise<boolean> {
        const processInfo = this.activeProcesses.get(taskId);
        if (processInfo) {
            console.log(`Terminating process for task ${taskId}`);
            
            // Log termination to runtime log file
            if (processInfo.logFiles) {
                const terminationMessage = `[${new Date().toISOString()}] Process terminated by user`;
                WriteLog(processInfo.logFiles.runtimeLog, terminationMessage);
            }
            
            try {
                const killResult = processInfo.process.kill();
                console.log(`killResult: ${killResult}`);
                if (killResult) {
                    console.log(`Process for task ${taskId} terminated successfully`);
                    processInfo.status = 'stopped';
                    
                    // Update task status
                    await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Paused);
                    
                    // Clear the PID since process is terminated
                    await this.taskModel.clearTaskPID(taskId);
                    
                    // Clean up after a short delay
                    setTimeout(() => {
                        this.cleanupProcess(taskId);
                    }, 1000);
                    
                    // Send success notification to frontend
                    sendSystemMessage({
                        status: true,
                        data: {
                            title: 'Process Terminated',
                            content: `Process for Yellow Pages task ${taskId} has been terminated successfully.`
                        }
                    });
                    return true;
                } else {
                    console.warn(`Process kill() returned false for task ${taskId} - process may not have been terminated`);
                    
                    // Log warning to error log file
                    if (processInfo.logFiles) {
                        const warningMessage = `[${new Date().toISOString()}] Process kill() returned false - process termination may have failed`;
                        WriteLog(processInfo.logFiles.errorLog, warningMessage);
                    }
                    
                    // Send warning notification to frontend
                    sendSystemMessage({
                        status: false,
                        data: {
                            title: 'Process Termination Warning',
                            content: `Process termination for Yellow Pages task ${taskId} may not have completed successfully.`
                        }
                    });
                    return false;
                }
                
            } catch (error) {
                console.error(`Failed to terminate process for task ${taskId}:`, error);
                
                // Log termination error to error log file
                if (processInfo.logFiles) {
                    const errorMessage = `[${new Date().toISOString()}] Failed to terminate process: ${error}`;
                    WriteLog(processInfo.logFiles.errorLog, errorMessage);
                }
                
                // Send error notification to frontend
                sendSystemMessage({
                    status: false,
                    data: {
                        title: 'Process Termination Failed',
                        content: `Failed to terminate process for Yellow Pages task ${taskId}: ${error instanceof Error ? error.message : 'Unknown error'}`
                    }
                });
                return false;
            }
        } else {
            console.log(`No active process found for task ${taskId}`);
            return false;
        }
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
     * Check if a task has been completed via IPC messages
     */
    isTaskCompleted(taskId: number): boolean {
        const processInfo = this.activeProcesses.get(taskId);
        return processInfo?.status === 'completed';
    }

    /**
     * Check if a task has failed via IPC messages
     */
    isTaskFailed(taskId: number): boolean {
        const processInfo = this.activeProcesses.get(taskId);
        return processInfo?.status === 'failed';
    }

    /**
     * Get process count
     */
    getProcessCount(): number {
        return this.activeProcesses.size;
    }

    /**
     * Find task by process ID
     * @param pid The process ID
     * @returns The task entity or null
     * 
     * @example
     * // Find a task by its process ID
     * const task = await processManager.getTaskByPID(12345);
     * if (task) {
     *   console.log(`Found task: ${task.name} (ID: ${task.id})`);
     * }
     */
    async getTaskByPID(pid: number): Promise<YellowPagesTaskEntity | null> {
        return await this.taskModel.getTaskByPID(pid);
    }

    /**
     * Terminate a process by PID
     * @param pid The process ID to terminate
     * @returns Success status
     * 
     * @example
     * // Terminate a process by PID
     * const success = await processManager.terminateProcessByPID(12345);
     * if (success) {
     *   console.log('Process terminated successfully');
     * }
     */
    async terminateProcessByPID(pid: number): Promise<boolean> {
        try {
            // Find the task associated with this PID
            const task = await this.taskModel.getTaskByPID(pid);
            if (!task) {
                console.log(`No task found for PID ${pid}`);
                return false;
            }

            // Terminate the process using the task ID
            await this.terminateProcess(task.id);
            return true;
        } catch (error) {
            console.error(`Failed to terminate process with PID ${pid}:`, error);
            return false;
        }
    }

    /**
     * Check if a process is still running by PID
     * @param pid The process ID to check
     * @returns Process status information
     * 
     * @example
     * // Check if a process is still running
     * const status = await processManager.checkProcessStatusByPID(12345);
     * if (status.isRunning) {
     *   console.log(`Process ${status.taskId} is still running`);
     * } else {
     *   console.log(`Process status: ${status.status || status.error}`);
     * }
     */
    async checkProcessStatusByPID(pid: number): Promise<{
        isRunning: boolean;
        taskId?: number;
        status?: string;
        error?: string;
    }> {
        try {
            // Find the task associated with this PID
            const task = await this.taskModel.getTaskByPID(pid);
            if (!task) {
                return { isRunning: false, error: 'No task found for this PID' };
            }

            // Check if the process is in our active processes map
            const processInfo = this.activeProcesses.get(task.id);
            if (!processInfo) {
                return { 
                    isRunning: false, 
                    taskId: task.id, 
                    status: 'Process not in active processes map' 
                };
            }

            // Check if the process is actually running
            const isRunning = processInfo.status === 'running';
            
            return {
                isRunning,
                taskId: task.id,
                status: processInfo.status
            };
        } catch (error) {
            return { 
                isRunning: false, 
                error: `Error checking process status: ${error}` 
            };
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

    /**
     * Pause a specific Yellow Pages task
     * @param taskId ID of the task to pause
     * @returns Promise that resolves when the task is paused
     */
    async pauseTask(taskId: number): Promise<void> {
        try {
            console.log(`Pausing Yellow Pages task ${taskId}`);
            
            const processInfo = this.activeProcesses.get(taskId);
            if (!processInfo) {
                // Check if the task exists and what its current status is
                try {
                    const task = await this.taskModel.getTaskById(taskId);
                    if (!task) {
                        throw new Error(`Task ${taskId} not found`);
                    }
                    
                    if (task.status === YellowPagesTaskStatus.Completed) {
                        throw new Error(`Cannot pause task ${taskId} - task is already completed`);
                    } else if (task.status === YellowPagesTaskStatus.Failed) {
                        throw new Error(`Cannot pause task ${taskId} - task has failed and cannot be paused`);
                    } else {
                        throw new Error(`No active process found for task ${taskId} (status: ${task.status}). The task may have been terminated or crashed.`);
                    }
                } catch (statusError) {
                    throw new Error(`No active process found for task ${taskId}: ${statusError instanceof Error ? statusError.message : String(statusError)}`);
                }
            }

            // Send pause message to child process
            const pauseMessage: PauseTaskMessage = {
                type: 'PAUSE',
                taskId: taskId
            };
            
            processInfo.process.postMessage(JSON.stringify(pauseMessage));
            
            // Update task status to paused
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.Paused);
            
            console.log(`Successfully paused Yellow Pages task ${taskId}`);
            
        } catch (error) {
            console.error(`Failed to pause Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Resume a specific Yellow Pages task
     * @param taskId ID of the task to resume
     * @returns Promise that resolves when the task resumes
     */
    async resumeTask(taskId: number): Promise<void> {
        try {
            console.log(`Resuming Yellow Pages task ${taskId}`);
            
            const processInfo = this.activeProcesses.get(taskId);
            if (!processInfo) {
                console.log(`No active process found for task ${taskId}, attempting to restart the task`);
                
                // Check task status to ensure it can be resumed
                try {
                    const task = await this.taskModel.getTaskById(taskId);
                    if (!task) {
                        throw new Error(`Task ${taskId} not found`);
                    }
                    
                    // Only restart if task is in a resumable state
                    if (task.status === YellowPagesTaskStatus.Paused || 
                        task.status === YellowPagesTaskStatus.Failed || 
                        task.status === YellowPagesTaskStatus.InProgress) {
                        
                        console.log(`Task ${taskId} is in resumable state (${task.status}), restarting...`);
                        
                        // Try to restart the task by spawning a new process
                        await this.spawnScraperProcess(taskId);
                        console.log(`Successfully restarted Yellow Pages task ${taskId}`);
                        return;
                    } else {
                        throw new Error(`Task ${taskId} is in state '${task.status}' which cannot be resumed`);
                    }
                } catch (restartError) {
                    console.error(`Failed to restart task ${taskId}:`, restartError);
                    throw new Error(`No active process found for task ${taskId} and failed to restart: ${restartError instanceof Error ? restartError.message : String(restartError)}`);
                }
            }

            // Send resume message to child process
            const resumeMessage: ResumeTaskMessage = {
                type: 'RESUME',
                taskId: taskId
            };
            
            processInfo.process.postMessage(JSON.stringify(resumeMessage));
            
            // Update task status to in-progress
            await this.taskModel.updateTaskStatus(taskId, YellowPagesTaskStatus.InProgress);
            
            console.log(`Successfully resumed Yellow Pages task ${taskId}`);
            
        } catch (error) {
            console.error(`Failed to resume Yellow Pages task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Send exit message to child process to request graceful shutdown
     * @param taskId ID of the task to exit
     * @returns Promise that resolves when the exit message is sent
     */
    async requestProcessExit(taskId: number): Promise<void> {
        try {
            console.log(`Requesting graceful exit for task ${taskId}`);
            
            const processInfo = this.activeProcesses.get(taskId);
            if (!processInfo) {
                console.log(`No active process found for task ${taskId}`);
                return;
            }

            // Send exit message to child process
            const exitMessage: ExitTaskMessage = {
                type: 'EXIT',
                taskId: taskId,
                reason: 'Task completed successfully'
            };
            
            processInfo.process.postMessage(JSON.stringify(exitMessage));
            
            console.log(`Exit message sent to task ${taskId}`);
            
        } catch (error) {
            console.error(`Failed to send exit message for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Check for orphaned processes on application startup
     * This method should be called when the application starts to identify
     * tasks that were running before a restart/crash and mark them as failed
     */
    async checkForOrphanedProcesses(): Promise<{
        totalChecked: number;
        orphanedFound: number;
        failedUpdates: number;
    }> {
        try {
            console.log('Checking for orphaned Yellow Pages processes...');
            
            // Get all tasks with status "InProgress" that have PIDs
            const runningTasks = await this.taskModel.getTasksByStatus(YellowPagesTaskStatus.InProgress);
            console.log(`Running tasks: ${runningTasks.length}`);
            
            // Separate tasks by PID status
            const tasksWithValidPID = runningTasks.filter(task => task.pid !== undefined && task.pid !== null && task.pid > 0);
            const tasksWithZeroPID = runningTasks.filter(task => task.pid === 0);
            const tasksWithInvalidPID = runningTasks.filter(task => task.pid === undefined || task.pid === null);
            
            console.log(`Found ${tasksWithValidPID.length} tasks with valid PIDs to check`);
            console.log(`Found ${tasksWithZeroPID.length} tasks with PID = 0 to handle`);
            console.log(`Found ${tasksWithInvalidPID.length} tasks with undefined/null PID to handle`);
            
            let orphanedFound = 0;
            let failedUpdates = 0;
            
            // Handle tasks with undefined/null PID - mark them as failed directly
            for (const task of tasksWithInvalidPID) {
                try {
                    console.log(`Task ${task.id} has undefined/null PID, marking as failed directly`);
                    
                    // Mark task as failed
                    await this.taskModel.updateTaskStatus(task.id, YellowPagesTaskStatus.Failed);
                    
                    // Clear the PID since it's invalid
                    await this.taskModel.clearTaskPID(task.id);
                    
                    // Add error log entry
                    const errorMessage = `Task marked as failed due to missing PID (PID is undefined/null). This indicates a task state corruption or initialization failure.`;
                    await this.taskModel.updateTaskErrorLog(task.id, errorMessage);
                    
                    orphanedFound++;
                    
                    // Send system notification
                    sendSystemMessage({
                        status: true,
                        data: {
                            title: 'Missing PID Process Detected',
                            content: `Task "${task.name}" (ID: ${task.id}) was marked as failed due to missing PID (undefined/null).`
                        }
                    });
                } catch (error) {
                    console.error(`Failed to update task ${task.id} with undefined/null PID:`, error);
                    failedUpdates++;
                }
            }
            
            // Handle tasks with PID = 0 - mark them as failed directly
            for (const task of tasksWithZeroPID) {
                try {
                    console.log(`Task ${task.id} has PID = 0, marking as failed directly`);
                    
                    // Mark task as failed
                    await this.taskModel.updateTaskStatus(task.id, YellowPagesTaskStatus.Failed);
                    
                    // Clear the PID since it's invalid
                    await this.taskModel.clearTaskPID(task.id);
                    
                    // Add error log entry
                    const errorMessage = `Task marked as failed due to invalid PID (PID = 0). This indicates a process initialization failure.`;
                    await this.taskModel.updateTaskErrorLog(task.id, errorMessage);
                    
                    orphanedFound++;
                    
                    // Send system notification
                    sendSystemMessage({
                        status: true,
                        data: {
                            title: 'Invalid PID Process Detected',
                            content: `Task "${task.name}" (ID: ${task.id}) was marked as failed due to invalid PID (PID = 0).`
                        }
                    });
                } catch (error) {
                    console.error(`Failed to update task ${task.id} with PID = 0:`, error);
                    failedUpdates++;
                }
            }
            
            // Handle tasks with valid PIDs - check if they're still running
            for (const task of tasksWithValidPID) {
                try {
                    // Type guard to ensure PID is defined
                    if (task.pid === undefined || task.pid === null) {
                        console.warn(`Task ${task.id} has undefined/null PID, skipping`);
                        continue;
                    }
                    
                    // Check if the process is still running
                    const isRunning = await this.checkProcessStatusByPID(task.pid);
                    
                    if (!isRunning.isRunning) {
                        console.log(`Task ${task.id} (PID: ${task.pid}) process is no longer running, marking as failed`);
                        
                        // Mark task as failed
                        await this.taskModel.updateTaskStatus(task.id, YellowPagesTaskStatus.Failed);
                        
                        // Clear the PID since process is dead
                        await this.taskModel.clearTaskPID(task.id);
                        
                        // Add error log entry
                        const errorMessage = `Process terminated unexpectedly (likely due to application restart/crash). PID: ${task.pid}`;
                        await this.taskModel.updateTaskErrorLog(task.id, errorMessage);
                        
                        orphanedFound++;
                        
                        // Send system notification
                        sendSystemMessage({
                            status: true,
                            data: {
                                title: 'Orphaned Process Detected',
                                content: `Task "${task.name}" (ID: ${task.id}) was marked as failed due to unexpected process termination.`
                            }
                        });
                    }
                } catch (error) {
                    console.error(`Failed to check process ${task.pid} for task ${task.id}:`, error);
                    failedUpdates++;
                }
            }
            
            const result = {
                totalChecked: tasksWithValidPID.length + tasksWithZeroPID.length + tasksWithInvalidPID.length,
                orphanedFound,
                failedUpdates
            };
            
            console.log(`Orphaned process check completed:`, result);
            return result;
            
        } catch (error) {
            console.error('Failed to check for orphaned processes:', error);
            throw error;
        }
    }


}