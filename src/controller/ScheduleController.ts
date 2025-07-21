import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { ScheduleExecutionLogModel } from "@/model/ScheduleExecutionLog.model";
import { ScheduleDependencyModel } from "@/model/ScheduleDependency.model";
import { ScheduleManager } from "@/modules/ScheduleManager";
import { TaskExecutorService } from "@/modules/TaskExecutorService";
import {ScheduleTaskModule} from "@/modules/ScheduleTaskModule";
import { ScheduleTaskModuleInterface } from "@/modules/interface/ScheduleTaskModuleInterface";

import { 
    ScheduleCreateRequest, 
    ScheduleUpdateRequest, 
    ScheduleListResponse, 
    ScheduleDetailResponse, 
    ExecutionHistoryResponse, 
    DependencyCreateRequest, 
    DependencyGraphResponse, 
    DependencyValidationResponse,
    SchedulerStatus,
    SchedulerStatusResponse
} from "@/entityTypes/schedule-type";
import { SortBy } from "@/entityTypes/commonType";
import { ScheduleTaskEntity, TaskType, ScheduleStatus, TriggerType, DependencyCondition } from "@/entity/ScheduleTask.entity";
import { ExecutionStatus } from "@/entity/ScheduleExecutionLog.entity";
//import { USERDBPATH } from "@/config/usersetting";
import { ScheduleDependencyModule } from "@/modules/ScheduleDependencyModule";
import { DependencyValidationResult, ScheduleDependencyInterface } from "@/modules/interface/ScheduleDependencyInterface";
import { ScheduleExecutionLogModule } from "@/modules/ScheduleExecutionLogModule";
export class ScheduleController {
    private scheduleTaskModule: ScheduleTaskModule;
    private scheduleExecutionLogModule: ScheduleExecutionLogModule;
    private scheduleDependencyModule: ScheduleDependencyModule;
    private scheduleManager: ScheduleManager;
    private taskExecutorService: TaskExecutorService;
    constructor() {
        this.scheduleTaskModule = new ScheduleTaskModule();
        this.scheduleExecutionLogModule = new ScheduleExecutionLogModule();
        this.scheduleDependencyModule = new ScheduleDependencyModule();
        this.scheduleManager = ScheduleManager.getInstance();
        this.taskExecutorService = new TaskExecutorService();
        this.scheduleDependencyModule = new ScheduleDependencyModule();
    }

    /**
     * Create a new schedule
     * @param scheduleData The schedule creation data
     * @returns The ID of the created schedule
     */
    public async createSchedule(scheduleData: ScheduleCreateRequest): Promise<number> {
        try {
            // Validate cron expression if it's a cron-based schedule
            if (scheduleData.trigger_type === TriggerType.CRON || !scheduleData.trigger_type) {
                if (!this.scheduleManager.validateCronExpression(scheduleData.cron_expression)) {
                    throw new Error('Invalid cron expression');
                }
            }

            // Check for circular dependencies if parent schedule is specified
            if (scheduleData.parent_schedule_id) {
                const hasCircular = await this.scheduleDependencyModule.checkCircularDependency(
                    scheduleData.parent_schedule_id, 
                    0 // We'll check this after creation
                );
                if (hasCircular) {
                    throw new Error('Circular dependency detected');
                }
            }

            // Create the schedule
            const scheduleId = await this.scheduleTaskModule.createSchedule(scheduleData);

            // Add to scheduler if active
            if (scheduleData.is_active !== false) {
                const schedule = await this.scheduleTaskModule.getScheduleById(scheduleId);
                if (schedule) {
                    await this.scheduleManager.addSchedule(schedule);
                }
            }

            return scheduleId;
        } catch (error) {
            console.error('Failed to create schedule:', error);
            throw error;
        }
    }

    /**
     * Update an existing schedule
     * @param id The schedule ID
     * @param scheduleData The update data
     */
    public async updateSchedule(id: number, scheduleData: ScheduleUpdateRequest): Promise<void> {
        try {
            // Validate cron expression if it's being updated
            if (scheduleData.cron_expression) {
                if (!this.scheduleManager.validateCronExpression(scheduleData.cron_expression)) {
                    throw new Error('Invalid cron expression');
                }
            }

            // Get current schedule to check for changes
            const currentSchedule = await this.scheduleTaskModule.getScheduleById(id);
            if (!currentSchedule) {
                throw new Error(`Schedule ${id} not found`);
            }

            // Update the schedule
            await this.scheduleTaskModule.updateSchedule(id, scheduleData);

            // Update in scheduler Manager
            const updatedSchedule = await this.scheduleTaskModule.getScheduleById(id);
            if (updatedSchedule) {
                await this.scheduleManager.updateSchedule(updatedSchedule);
            }
        } catch (error) {
            console.error(`Failed to update schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Delete a schedule
     * @param id The schedule ID
     */
    public async deleteSchedule(id: number): Promise<void> {
        try {
            // Remove from scheduler first
            await this.scheduleManager.removeSchedule(id);

            // Delete the schedule
            await this.scheduleTaskModule.deleteSchedule(id);

            // Clean up dependencies
            await this.scheduleDependencyModule.deleteDependencyByParentChild(0, id); // Remove as child
            await this.scheduleDependencyModule.deleteDependencyByParentChild(id, 0); // Remove as parent
        } catch (error) {
            console.error(`Failed to delete schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Enable a schedule
     * @param id The schedule ID
     */
    public async enableSchedule(id: number): Promise<void> {
        try {
            await this.scheduleTaskModule.enableSchedule(id);
            
            const schedule = await this.scheduleTaskModule.getScheduleById(id);
            if (schedule) {
                await this.scheduleManager.addSchedule(schedule);
            }
        } catch (error) {
            console.error(`Failed to enable schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Disable a schedule
     * @param id The schedule ID
     */
    public async disableSchedule(id: number): Promise<void> {
        try {
            await this.scheduleTaskModule.disableSchedule(id);
            await this.scheduleManager.removeSchedule(id);
        } catch (error) {
            console.error(`Failed to disable schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Pause a schedule
     * @param id The schedule ID
     */
    public async pauseSchedule(id: number): Promise<void> {
        try {
            await this.scheduleManager.pauseSchedule(id);
        } catch (error) {
            console.error(`Failed to pause schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Resume a schedule
     * @param id The schedule ID
     */
    public async resumeSchedule(id: number): Promise<void> {
        try {
            await this.scheduleManager.resumeSchedule(id);
        } catch (error) {
            console.error(`Failed to resume schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Run a schedule immediately
     * @param id The schedule ID
     */
    public async runScheduleNow(id: number): Promise<void> {
        try {
            await this.scheduleManager.executeSchedule(id);
        } catch (error) {
            console.error(`Failed to run schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Get schedule list with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters
     * @returns Schedule list response
     */
    public async getScheduleList(page: number, size: number, sort?: SortBy): Promise<ScheduleListResponse> {
        try {
            const schedules = await this.scheduleTaskModule.listSchedules(page, size, sort);
            const total = await this.scheduleTaskModule.getScheduleTotal();

            return {
                schedules: schedules.records.map(schedule => this.mapScheduleToResponse(schedule)),
                total,
                page,
                size
            };
        } catch (error) {
            console.error('Failed to get schedule list:', error);
            throw error;
        }
    }

    /**
     * Get schedule by ID with detailed information
     * @param id The schedule ID
     * @returns Schedule detail response
     */
    public async getScheduleById(id: number): Promise<ScheduleDetailResponse> {
        try {
            const schedule = await this.scheduleTaskModule.getScheduleById(id);
            if (!schedule) {
                throw new Error(`Schedule ${id} not found`);
            }

            // Get execution history
            const executionHistory = await this.scheduleExecutionLogModule.getExecutionHistory(id, 0, 10);

            // Get dependencies
            const childDependencies = await this.scheduleDependencyModule.getDependenciesByParent(id);
            const parentDependencies = await this.scheduleDependencyModule.getDependenciesByChild(id);

            return {
                schedule: this.mapScheduleToResponse(schedule),
                execution_history: executionHistory.records.map(exec => this.mapExecutionToResponse(exec)),
                dependencies: {
                    children: childDependencies.map(dep => this.mapDependencyToResponse(dep)),
                    parents: parentDependencies.map(dep => this.mapDependencyToResponse(dep))
                }
            };
        } catch (error) {
            console.error(`Failed to get schedule ${id}:`, error);
            throw error;
        }
    }

    /**
     * Get execution history for a schedule
     * @param scheduleId The schedule ID
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @returns Execution history response
     */
    public async getExecutionHistory(scheduleId: number, page: number, size: number): Promise<ExecutionHistoryResponse> {
        try {
            const executions = await this.scheduleExecutionLogModule.getExecutionHistory(scheduleId, page, size);
            const total = await this.scheduleExecutionLogModule.getExecutionHistoryTotal(scheduleId);

            return {
                executions: executions.records.map(exec => this.mapExecutionToResponse(exec)),
                total,
                page,
                size
            };
        } catch (error) {
            console.error(`Failed to get execution history for schedule ${scheduleId}:`, error);
            throw error;
        }
    }

    /**
     * Add a dependency between schedules
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @param dependencyData The dependency data
     * @returns The ID of the created dependency
     */
    public async addDependency(parentId: number, childId: number, dependencyData: DependencyCreateRequest): Promise<number> {
        try {
            // Validate that both schedules exist
            const parentSchedule = await this.scheduleTaskModule.getScheduleById(parentId);
            const childSchedule = await this.scheduleTaskModule.getScheduleById(childId);

            if (!parentSchedule) {
                throw new Error(`Parent schedule ${parentId} not found`);
            }
            if (!childSchedule) {
                throw new Error(`Child schedule ${childId} not found`);
            }

            // Check for circular dependencies
            const hasCircular = await this.scheduleDependencyModule.checkCircularDependency(parentId, childId);
            if (hasCircular) {
                throw new Error('Circular dependency detected');
            }

            // Create the dependency
            const dependencyId = await this.scheduleDependencyModule.createDependency(
                parentId,
                childId,
                dependencyData.dependency_condition,
                dependencyData.delay_minutes || 0,
                dependencyData.notes
            );

            return dependencyId;
        } catch (error) {
            console.error(`Failed to add dependency ${parentId} -> ${childId}:`, error);
            throw error;
        }
    }

    /**
     * Remove a dependency between schedules
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     */
    public async removeDependency(parentId: number, childId: number): Promise<void> {
        try {
            await this.scheduleDependencyModule.deleteDependencyByParentChild(parentId, childId);
        } catch (error) {
            console.error(`Failed to remove dependency ${parentId} -> ${childId}:`, error);
            throw error;
        }
    }

    /**
     * Get dependency graph for a schedule
     * @param scheduleId The schedule ID
     * @returns Dependency graph response
     */
    public async getDependencyGraph(scheduleId: number): Promise<DependencyGraphResponse> {
        try {
            const schedule = await this.scheduleTaskModule.getScheduleById(scheduleId);
            if (!schedule) {
                throw new Error(`Schedule ${scheduleId} not found`);
            }

            // Get all dependencies in the chain
            const dependencyChain = await this.scheduleDependencyModule.getDependencyChain(scheduleId);
            
            // Build nodes and edges
            const nodes: any[] = [];
            const edges: any[] = [];
            const visited = new Set<number>();

            // Add the target schedule
            nodes.push({
                id: scheduleId,
                name: schedule.name,
                type: 'schedule',
                status: schedule.status
            });
            visited.add(scheduleId);

            // Add all related schedules
            for (const dependency of dependencyChain) {
                if (!visited.has(dependency.parent_schedule_id)) {
                    const parentSchedule = await this.scheduleTaskModule.getScheduleById(dependency.parent_schedule_id);
                    if (parentSchedule) {
                        nodes.push({
                            id: dependency.parent_schedule_id,
                            name: parentSchedule.name,
                            type: 'schedule',
                            status: parentSchedule.status
                        });
                        visited.add(dependency.parent_schedule_id);
                    }
                }

                if (!visited.has(dependency.child_schedule_id)) {
                    const childSchedule = await this.scheduleTaskModule.getScheduleById(dependency.child_schedule_id);
                    if (childSchedule) {
                        nodes.push({
                            id: dependency.child_schedule_id,
                            name: childSchedule.name,
                            type: 'schedule',
                            status: childSchedule.status
                        });
                        visited.add(dependency.child_schedule_id);
                    }
                }

                // Add edge
                edges.push({
                    from: dependency.parent_schedule_id,
                    to: dependency.child_schedule_id,
                    condition: dependency.dependency_condition,
                    delay: dependency.delay_minutes
                });
            }

            return { nodes, edges };
        } catch (error) {
            console.error(`Failed to get dependency graph for schedule ${scheduleId}:`, error);
            throw error;
        }
    }

    /**
     * Validate dependencies for a schedule
     * @param scheduleId The schedule ID
     * @returns Dependency validation response
     */
    public async validateDependencies(scheduleId: number): Promise<DependencyValidationResult> {
        try {
            const validation = await this.scheduleDependencyModule.validateDependencies(scheduleId);
            return validation;
        } catch (error) {
            console.error(`Failed to validate dependencies for schedule ${scheduleId}:`, error);
            throw error;
        }
    }

    /**
     * Get scheduler status
     * @returns Current scheduler status
     */
    public getSchedulerStatus(): SchedulerStatusResponse {
        try {
            const status = this.scheduleManager.getSchedulerStatus();
            console.log('Scheduler status:', status);
            return {
                isRunning: status.isRunning,
                activeSchedules: status.activeSchedules,
                totalSchedules: status.totalSchedules,
                lastCheckTime: status.lastCheckTime,
                nextCheckTime: status.nextCheckTime
            };
        } catch (error) {
            console.error('Failed to get scheduler status:', error);
            throw error;
        }
    }

    /**
     * Start the scheduler
     */
    public async startScheduler(): Promise<void> {
        try {
            await this.scheduleManager.start();
        } catch (error) {
            console.error('Failed to start scheduler:', error);
            throw error;
        }
    }

    /**
     * Stop the scheduler
     */
    public async stopScheduler(): Promise<void> {
        try {
            await this.scheduleManager.stop();
        } catch (error) {
            console.error('Failed to stop scheduler:', error);
            throw error;
        }
    }

    /**
     * Get schedules by task type
     * @param taskType The task type to filter by
     * @returns Array of schedule entities
     */
    public async getSchedulesByTaskType(taskType: TaskType): Promise<ScheduleTaskEntity[]> {
        try {
            return await this.scheduleTaskModule.getSchedulesByTaskType(taskType);
        } catch (error) {
            console.error(`Failed to get schedules by task type ${taskType}:`, error);
            throw error;
        }
    }

    /**
     * Get recent executions across all schedules
     * @param limit Maximum number of executions to return
     * @returns Array of recent execution log entities
     */
    public async getRecentExecutions(limit: number): Promise<any[]> {
        try {
            const executions = await this.scheduleExecutionLogModule.getRecentExecutions(limit);
            return executions.map(exec => this.mapExecutionToResponse(exec));
        } catch (error) {
            console.error('Failed to get recent executions:', error);
            throw error;
        }
    }

    /**
     * Get execution statistics for a schedule
     * @param scheduleId The schedule ID
     * @returns Execution statistics
     */
    public async getExecutionStatistics(scheduleId: number): Promise<any> {
        try {
            return await this.scheduleExecutionLogModule.getExecutionStatistics(scheduleId);
        } catch (error) {
            console.error(`Failed to get execution statistics for schedule ${scheduleId}:`, error);
            throw error;
        }
    }

    /**
     * Calculate the next run time for a cron expression
     * @param cronExpression The cron expression
     * @returns The next run time
     */
    public calculateNextRunTime(cronExpression: string): Date {
        try {
            return this.scheduleManager.calculateNextRunTime(cronExpression);
        } catch (error) {
            console.error('Failed to calculate next run time:', error);
            // Return a default time (1 hour from now) if calculation fails
            const defaultTime = new Date();
            defaultTime.setHours(defaultTime.getHours() + 1);
            return defaultTime;
        }
    }

    /**
     * Map schedule entity to response format
     * @param schedule The schedule entity
     * @returns Mapped schedule object
     */
    private mapScheduleToResponse(schedule: ScheduleTaskEntity): any {
        return {
            id: schedule.id,
            name: schedule.name,
            description: schedule.description,
            task_type: schedule.task_type,
            task_id: schedule.task_id,
            cron_expression: schedule.cron_expression,
            is_active: schedule.is_active,
            last_run_time: schedule.last_run_time,
            next_run_time: schedule.next_run_time,
            status: schedule.status,
            execution_count: schedule.execution_count,
            failure_count: schedule.failure_count,
            last_error_message: schedule.last_error_message,
            trigger_type: schedule.trigger_type,
            parent_schedule_id: schedule.parent_schedule_id,
            dependency_condition: schedule.dependency_condition,
            delay_minutes: schedule.delay_minutes,
            created_at: schedule.createdAt,
            updated_at: schedule.updatedAt
        };
    }

    /**
     * Map execution log entity to response format
     * @param execution The execution log entity
     * @returns Mapped execution object
     */
    private mapExecutionToResponse(execution: any): any {
        return {
            id: execution.id,
            schedule_id: execution.schedule_id,
            parent_execution_id: execution.parent_execution_id,
            execution_time: execution.execution_time,
            status: execution.status,
            result_message: execution.result_message,
            execution_duration: execution.execution_duration,
            task_output_id: execution.task_output_id,
            triggered_by: execution.triggered_by,
            completion_time: execution.completion_time,
            created_at: execution.createdAt
        };
    }

    /**
     * Map dependency entity to response format
     * @param dependency The dependency entity
     * @returns Mapped dependency object
     */
    private mapDependencyToResponse(dependency: any): any {
        return {
            id: dependency.id,
            parent_schedule_id: dependency.parent_schedule_id,
            child_schedule_id: dependency.child_schedule_id,
            dependency_condition: dependency.dependency_condition,
            delay_minutes: dependency.delay_minutes,
            is_active: dependency.is_active,
            notes: dependency.notes,
            created_at: dependency.createdAt,
            updated_at: dependency.updatedAt
        };
    }
} 