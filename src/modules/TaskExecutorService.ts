//import { BaseDb } from "@/model/Basedb";
import { ScheduleTaskEntity, TaskType } from "@/entity/ScheduleTask.entity";
//import { SearchTaskModel } from "@/model/SearchTask.model";
//import { EmailMarketingTaskModel } from "@/model/EmailMarketingTask.model";
//import { BuckEmailTaskModel } from "@/model/BuckEmailTask.model";
//import { VideoDownloadTaskModel } from "@/model/VideoDownloadTask.model";
//import { SocialTaskModel } from "@/model/SocialTask.model";
import { TaskStatus } from "@/entityTypes/commonType";
import { SearchModule } from "@/modules/searchModule";
import {SearchTaskModule} from "@/modules/SearchTaskModule"
import {EmailMarketingTaskModule} from "@/modules/EmailMarketingTaskModule"
import {BuckEmailTaskModule} from "@/modules/buckEmailTaskModule"
import {VideoDownloadTaskModule} from "@/modules/VideoDownloadTaskModule"
import { EmailSearchTaskModule } from "./EmailSearchTaskModule";
//import {getStatusName} from "@/modules/lib/function"
// export enum TaskStatus {
//     PENDING = 'pending',
//     RUNNING = 'running',
//     COMPLETED = 'completed',
//     FAILED = 'failed',
//     CANCELLED = 'cancelled'
// }

export class TaskExecutorService {
    private searchTaskModel: SearchTaskModule;
    //private emailMarketingTaskModel: EmailMarketingTaskModule;
    private buckEmailTaskModel: BuckEmailTaskModule;    
    private videoDownloadTaskModel: VideoDownloadTaskModule;
    private searchModel: SearchModule;
    private emailSeachTaskModule:EmailSearchTaskModule
    //private socialTaskModel: SocialTaskModel;

    constructor() {
        //super();
        this.searchTaskModel = new SearchTaskModule();
        //this.emailMarketingTaskModel = new EmailMarketingTaskModule();
        this.buckEmailTaskModel = new BuckEmailTaskModule();
        this.videoDownloadTaskModel = new VideoDownloadTaskModule();
        this.searchModel = new SearchModule();
        this.emailSeachTaskModule=new EmailSearchTaskModule()

        //this.socialTaskModel = new SocialTaskModel(filepath);
    }

    /**
     * Execute a scheduled task based on its type
     * @param schedule The schedule entity to execute
     * @param parentExecutionId Optional parent execution ID for dependency chains
     * @returns The task output ID
     */
    async executeScheduledTask(schedule: ScheduleTaskEntity, parentExecutionId?: number): Promise<number> {
        try {
            console.log(`Executing scheduled task ${schedule.id} of type ${schedule.task_type}`);

            let taskOutputId: number;

            switch (schedule.task_type) {
                case TaskType.SEARCH:
                    taskOutputId = await this.executeSearchTask(schedule.task_id);
                    break;
                case TaskType.EMAIL_EXTRACT:
                    taskOutputId = await this.executeEmailExtractionTask(schedule.task_id);
                    break;
                case TaskType.BUCK_EMAIL:
                    taskOutputId = await this.executeBuckEmailTask(schedule.task_id);
                    break;
                case TaskType.VIDEO_DOWNLOAD:
                    taskOutputId = await this.executeVideoDownloadTask(schedule.task_id);
                    break;
                // case TaskType.SOCIAL_TASK:
                //     taskOutputId = await this.executeSocialTask(schedule.task_id);
                //     break;
                default:
                    throw new Error(`Unsupported task type: ${schedule.task_type}`);
            }

            console.log(`Task ${schedule.id} executed successfully with output ID: ${taskOutputId}`);
            return taskOutputId;

        } catch (error) {
            console.error(`Failed to execute scheduled task ${schedule.id}:`, error);
            throw error;
        }
    }

    /**
     * Execute a search task
     * @param taskId The search task ID
     * @returns The task output ID
     */
    async executeSearchTask(taskId: number): Promise<number> {
        try {
            console.log(`Executing search task ${taskId}`);

            // Get the search task entity
            const searchTask = await this.searchTaskModel.read(taskId);
            if (!searchTask) {
                throw new Error(`Search task ${taskId} not found`);
            }

            // Update task status to running
            await this.searchTaskModel.updateTaskStatus(taskId, 'running' as any);

            // Execute the search task using the existing search functionality
            // This would integrate with the existing search scraper system
            //const searchScraper = require('@/childprocess/searchScraper');
            await this.searchModel.runSearchTask(taskId)
            return taskId;
            // Start the search execution
            //const result = await searchScraper.executeSearchTask(searchTask);
            // const result = await this.searchModel.runSearchTask(taskId);
            // // Update task status based on result
            // const status = result.success ? 'completed' : 'failed';
            // await this.searchTaskModel.updateTaskStatus(taskId, status as any);

            // console.log(`Search task ${taskId} executed with status: ${status}`);
            // return result.outputId || taskId; // Return output ID or task ID as fallback

        } catch (error) {
            console.error(`Failed to execute search task ${taskId}:`, error);
            
            // Update task status to failed
            try {
                await this.searchTaskModel.updateTaskStatus(taskId, 'failed' as any);
            } catch (updateError) {
                console.error('Failed to update search task status:', updateError);
            }
            
            throw error;
        }
    }

    /**
     * Execute an email marketing task
     * @param taskId The email marketing task ID
     * @returns The task output ID
     */
    async executeEmailExtractionTask(taskId: number): Promise<number> {
        try {
            console.log(`Executing email marketing task ${taskId}`);

            // Get the email marketing task entity
            const emailTask = await this.emailSeachTaskModule.getTaskDetail(taskId);
            if (!emailTask) {
                throw new Error(`Email marketing task ${taskId} not found`);
            }
            await this.emailSeachTaskModule.searchEmail(taskId)

            // Execute the email marketing task using the existing email functionality
            // This would integrate with the existing email marketing system
            //const emailService = require('@/modules/lib/emailService');
            //await this.emailMarketingTaskModel.runEmailMarketingTask(taskId)
            // Start the email marketing execution
            //const result = await emailService.executeEmailMarketingTask(emailTask);
            return taskId;
            // console.log(`Email marketing task ${taskId} executed successfully`);
            // return result.outputId || taskId; // Return output ID or task ID as fallback

        } catch (error) {
            console.error(`Failed to execute email marketing task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Execute a bulk email task
     * @param taskId The bulk email task ID
     * @returns The task output ID
     */
    async executeBuckEmailTask(taskId: number): Promise<number> {
        try {
            console.log(`Executing bulk email task ${taskId}`);

            // Get the bulk email task entity
            const buckEmailTask = await this.buckEmailTaskModel.read(taskId);
            if (!buckEmailTask) {
                throw new Error(`Bulk email task ${taskId} not found`);
            }
            await this.buckEmailTaskModel.buckEmailsend(taskId)

            // Execute the bulk email task using the existing buck email functionality
            // This would integrate with the existing buck email system
            // const buckEmailService = require('@/modules/lib/emailService');
            
            // // Start the bulk email execution
            // const result = await buckEmailService.executeBuckEmailTask(buckEmailTask);
            
            // console.log(`Bulk email task ${taskId} executed successfully`);
            // return result.outputId || taskId; // Return output ID or task ID as fallback
            return taskId;
        } catch (error) {
            console.error(`Failed to execute bulk email task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Execute a video download task
     * @param taskId The video download task ID
     * @returns The task output ID
     */
    async executeVideoDownloadTask(taskId: number): Promise<number> {
        try {
            console.log(`Executing video download task ${taskId}`);

            // Get the video download task entity
            const videoTask = await this.videoDownloadTaskModel.getVideoDownloadTask(taskId);
            if (!videoTask) {
                throw new Error(`Video download task ${taskId} not found`);
            }

            // Execute the video download task using the existing video download functionality
            // This would integrate with the existing video download system
           // const videoDownloadService = require('@/modules/videodownload/VideoDownloadFactory');
            
            // Start the video download execution
            await this.videoDownloadTaskModel.processDownloadVideo(taskId)
            
            console.log(`Video download task ${taskId} executed successfully`);
            return taskId; // Return output ID or task ID as fallback

        } catch (error) {
            console.error(`Failed to execute video download task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Execute a social task
     * @param taskId The social task ID
     * @returns The task output ID
     */
    // async executeSocialTask(taskId: number): Promise<number> {
    //     try {
    //         console.log(`Executing social task ${taskId}`);

    //         // Get the social task entity
    //         // const socialTask = await this.socialTaskModel.getTaskById(taskId);
    //         // if (!socialTask) {
    //         //     throw new Error(`Social task ${taskId} not found`);
    //         // }

    //         // Execute the social task using the existing social functionality
    //         // This would integrate with the existing social task system
    //         const socialTaskService = require('@/modules/socialTask');
            
    //         // Start the social task execution
    //         const result = await socialTaskService.executeSocialTask(socialTask);
            
    //         console.log(`Social task ${taskId} executed successfully`);
    //         return result.outputId || taskId; // Return output ID or task ID as fallback

    //     } catch (error) {
    //         console.error(`Failed to execute social task ${taskId}:`, error);
    //         throw error;
    //     }
    // }

    /**
     * Get the status of a task
     * @param taskId The task ID
     * @param taskType The task type
     * @returns The task status
     */
    async getTaskStatus(taskId: number, taskType: TaskType): Promise<TaskStatus|undefined> {
        try {
            let status: TaskStatus|undefined;

            switch (taskType) {
                case TaskType.SEARCH:
                    const searchTask = await this.searchTaskModel.read(taskId);
                    status = searchTask?.status || undefined;
                    break;
                case TaskType.EMAIL_EXTRACT:
                    const emailTask = await this.emailSeachTaskModule.getTaskDetail(taskId);
                    status = emailTask?.status || undefined;
                    break;
                case TaskType.BUCK_EMAIL:
                    const buckEmailTask = await this.buckEmailTaskModel.read(taskId);
                    status = buckEmailTask?.status || undefined;
                    break;
                case TaskType.VIDEO_DOWNLOAD:
                    const videoTask = await this.videoDownloadTaskModel.getVideoDownloadTask(taskId);
                    status = videoTask?.status || undefined;
                    break;
                // case TaskType.SOCIAL_TASK:
                //     const socialTask = await this.socialTaskModel.getTaskById(taskId);
                //     status = socialTask?.status || 'unknown';
                //     break;
                default:
                    throw new Error(`Unsupported task type: ${taskType}`);
            }
            return status;
            // return getStatusName(status as TaskStatus);
            // Map the status to TaskStatus enum
            // switch (status) {
            //     case 'pending':
            //     case 'waiting':
            //         return TaskStatus.PENDING;
            //     case 'running':
            //     case 'processing':
            //         return TaskStatus.RUNNING;
            //     case 'completed':
            //     case 'success':
            //     case 'finished':
            //         return TaskStatus.COMPLETED;
            //     case 'failed':
            //     case 'error':
            //         return TaskStatus.FAILED;
            //     case 'cancelled':
            //     case 'stopped':
            //         return TaskStatus.CANCELLED;
            //     default:
            //         return TaskStatus.PENDING;
            // }

        } catch (error) {
            console.error(`Failed to get task status for ${taskType} task ${taskId}:`, error);
            return TaskStatus.Error;
        }
    }

    /**
     * Cancel a running task
     * @param taskId The task ID
     * @param taskType The task type
     */
    async cancelTask(taskId: number, taskType: TaskType): Promise<void> {
        try {
            console.log(`Cancelling ${taskType} task ${taskId}`);

            switch (taskType) {
                case TaskType.SEARCH:
                    await this.searchTaskModel.updateTaskStatus(taskId, 'cancelled' as any);
                    break;
                case TaskType.EMAIL_EXTRACT:
                    // Update email marketing task status
                    const emailTask = await this.emailSeachTaskModule.getTaskDetail(taskId);
                    if (emailTask) {
                        emailTask.status = TaskStatus.Cancel;
                        await this.emailSeachTaskModule.updateTaskStatus(taskId, emailTask.status);
                    }
                    break;
                case TaskType.BUCK_EMAIL:
                    // Update bulk email task status
                    const buckEmailTask = await this.buckEmailTaskModel.read(taskId);
                    if (buckEmailTask) {
                        buckEmailTask.status = TaskStatus.Cancel;
                        await this.buckEmailTaskModel.updateTaskStatus(taskId, buckEmailTask.status);
                    }
                    break;
                case TaskType.VIDEO_DOWNLOAD:
                    // Update video download task status
                    const videoTask = await this.videoDownloadTaskModel.getVideoDownloadTask(taskId);
                    if (videoTask) {
                        videoTask.status = TaskStatus.Cancel;
                        await this.videoDownloadTaskModel.updateVideoDownloadTaskStatus(taskId, videoTask.status);
                    }
                    break;
                //case TaskType.SOCIAL_TASK:
                    // Update social task status
                    // const socialTask = await this.socialTaskModel.getTaskById(taskId);
                    // if (socialTask) {
                    //     socialTask.status = 'cancelled';
                    //     await this.socialTaskModel.updateTask(taskId, socialTask);
                    // }
                    //break;
                default:
                    throw new Error(`Unsupported task type: ${taskType}`);
            }

            console.log(`Task ${taskId} cancelled successfully`);

        } catch (error) {
            console.error(`Failed to cancel ${taskType} task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Execute a dependency chain starting from a schedule
     * @param scheduleId The schedule ID to start from
     * @param parentExecutionId Optional parent execution ID
     */
    async executeDependencyChain(scheduleId: number, parentExecutionId?: number): Promise<void> {
        try {
            console.log(`Executing dependency chain starting from schedule ${scheduleId}`);

            // Get the schedule
            const schedule = await this.searchTaskModel.read(scheduleId);
            if (!schedule) {
                throw new Error(`Schedule ${scheduleId} not found`);
            }

            // Execute the main task
            const taskOutputId = await this.executeScheduledTask(schedule as any, parentExecutionId);

            console.log(`Dependency chain execution completed for schedule ${scheduleId}`);

        } catch (error) {
            console.error(`Failed to execute dependency chain for schedule ${scheduleId}:`, error);
            throw error;
        }
    }

    /**
     * Get task execution statistics
     * @param taskType Optional task type to filter by
     * @returns Task execution statistics
     */
    async getTaskExecutionStatistics(taskType?: TaskType): Promise<{
        total: number;
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
        averageExecutionTime: number;
    }> {
        try {
            // This would aggregate statistics from all task types
            // For now, return a basic structure
            return {
                total: 0,
                running: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
                averageExecutionTime: 0
            };
        } catch (error) {
            console.error('Failed to get task execution statistics:', error);
            throw error;
        }
    }

    /**
     * Validate task configuration
     * @param taskId The task ID
     * @param taskType The task type
     * @returns Validation result
     */
    async validateTaskConfiguration(taskId: number, taskType: TaskType): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }> {
        try {
            const errors: string[] = [];
            const warnings: string[] = [];

            // Validate task exists
            let taskExists = false;
            switch (taskType) {
                case TaskType.SEARCH:
                    const searchTask = await this.searchTaskModel.read(taskId);
                    taskExists = !!searchTask;
                    break;
                case TaskType.EMAIL_EXTRACT:
                    const emailTask = await this.emailSeachTaskModule.getTaskDetail(taskId);
                    taskExists = !!emailTask;
                    break;
                case TaskType.BUCK_EMAIL:
                    const buckEmailTask = await this.buckEmailTaskModel.read(taskId);
                    taskExists = !!buckEmailTask;
                    break;
                case TaskType.VIDEO_DOWNLOAD:
                    const videoTask = await this.videoDownloadTaskModel.getVideoDownloadTask(taskId);
                    taskExists = !!videoTask;
                    break;
                // case TaskType.SOCIAL_TASK:
                //     const socialTask = await this.socialTaskModel.getTaskById(taskId);
                //     taskExists = !!socialTask;
                //     break;
            }

            if (!taskExists) {
                errors.push(`Task ${taskId} of type ${taskType} not found`);
            }

            return {
                isValid: errors.length === 0,
                errors,
                warnings
            };

        } catch (error) {
            console.error(`Failed to validate task configuration for ${taskType} task ${taskId}:`, error);
            return {
                isValid: false,
                errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
                warnings: []
            };
        }
    }
} 