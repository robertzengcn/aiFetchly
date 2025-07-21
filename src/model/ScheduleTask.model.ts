import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { ScheduleTaskEntity, TaskType, ScheduleStatus, TriggerType, DependencyCondition } from "@/entity/ScheduleTask.entity";
import { ScheduleCreateRequest, ScheduleUpdateRequest } from "@/entityTypes/schedule-type";
import { SortBy } from "@/entityTypes/commonType";

export class ScheduleTaskModel extends BaseDb {
    private repository: Repository<ScheduleTaskEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(ScheduleTaskEntity);
    }

    /**
     * Create a new schedule
     * @param scheduleData The schedule creation data
     * @returns The ID of the created schedule
     */
    async createSchedule(scheduleData: ScheduleCreateRequest): Promise<number> {
        const scheduleEntity = new ScheduleTaskEntity();
        scheduleEntity.name = scheduleData.name;
        scheduleEntity.description = scheduleData.description || '';
        scheduleEntity.task_type = scheduleData.task_type;
        scheduleEntity.task_id = scheduleData.task_id;
        scheduleEntity.cron_expression = scheduleData.cron_expression;
        scheduleEntity.is_active = scheduleData.is_active !== undefined ? scheduleData.is_active : true;
        scheduleEntity.trigger_type = scheduleData.trigger_type || TriggerType.CRON;
        scheduleEntity.parent_schedule_id = scheduleData.parent_schedule_id || null;
        scheduleEntity.dependency_condition = scheduleData.dependency_condition ? scheduleData.dependency_condition.toString() : null;
        scheduleEntity.delay_minutes = scheduleData.delay_minutes || 0;
        scheduleEntity.status = ScheduleStatus.ACTIVE;
        scheduleEntity.execution_count = 0;
        scheduleEntity.failure_count = 0;
        scheduleEntity.last_modified = new Date();

        const savedSchedule = await this.repository.save(scheduleEntity);
        return savedSchedule.id;
    }

    /**
     * Update an existing schedule
     * @param id The schedule ID
     * @param scheduleData The update data
     */
    async updateSchedule(id: number, scheduleData: ScheduleUpdateRequest): Promise<void> {
        const updateData: any = {};
        
        if (scheduleData.name !== undefined) updateData.name = scheduleData.name;
        if (scheduleData.description !== undefined) updateData.description = scheduleData.description;
        if (scheduleData.task_type !== undefined) updateData.task_type = scheduleData.task_type;
        if (scheduleData.task_id !== undefined) updateData.task_id = scheduleData.task_id;
        if (scheduleData.cron_expression !== undefined) updateData.cron_expression = scheduleData.cron_expression;
        if (scheduleData.is_active !== undefined) updateData.is_active = scheduleData.is_active;
        if (scheduleData.trigger_type !== undefined) updateData.trigger_type = scheduleData.trigger_type;
        if (scheduleData.parent_schedule_id !== undefined) updateData.parent_schedule_id = scheduleData.parent_schedule_id;
        if (scheduleData.dependency_condition !== undefined) updateData.dependency_condition = scheduleData.dependency_condition;
        if (scheduleData.delay_minutes !== undefined) updateData.delay_minutes = scheduleData.delay_minutes;
        if (scheduleData.status !== undefined) updateData.status = scheduleData.status;
        
        updateData.last_modified = new Date();

        await this.repository.update({ id }, updateData);
    }

    /**
     * Delete a schedule
     * @param id The schedule ID
     */
    async deleteSchedule(id: number): Promise<void> {
        await this.repository.delete({ id });
    }

    /**
     * Get schedule by ID
     * @param id The schedule ID
     * @returns The schedule entity or null
     */
    async getScheduleById(id: number): Promise<ScheduleTaskEntity | null> {
        return await this.repository.findOne({
            where: { id }
        });
    }

    /**
     * List schedules with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters
     * @returns Array of schedule entities
     */
    async listSchedules(page: number, size: number, sort?: SortBy): Promise<ScheduleTaskEntity[]> {
        const allowedSortKeys = ['id', 'name', 'task_type', 'status', 'last_run_time', 'next_run_time', 'createdAt'];
        const allowedSortOrders = ['ASC', 'DESC'];
        
        let orderOptions: any = { id: 'DESC' };
        
        if (sort && sort.key && sort.order) {
            const sortKey = sort.key.toLowerCase();
            const sortOrder = sort.order.toUpperCase();
            
            if (!allowedSortKeys.includes(sortKey)) {
                throw new Error("Not allowed sort key");
            }
            
            if (!allowedSortOrders.includes(sortOrder)) {
                throw new Error("Not allowed sort order");
            }
            
            orderOptions = { [sortKey]: sortOrder };
        }
        
        return await this.repository.find({
            order: orderOptions,
            take: size,
            skip: page * size
        });
    }

    /**
     * Get total number of schedules
     * @returns Total count of schedules
     */
    async getScheduleTotal(): Promise<number> {
        return await this.repository.count();
    }

    /**
     * Get active schedules
     * @returns Array of active schedule entities
     */
    async getActiveSchedules(): Promise<ScheduleTaskEntity[]> {
        return await this.repository.find({
            where: { is_active: true },
            order: { next_run_time: 'ASC' }
        });
    }

    /**
     * Get schedules ready to execute (next_run_time <= now)
     * @returns Array of schedules ready to execute
     */
    async getSchedulesReadyToExecute(): Promise<ScheduleTaskEntity[]> {
        const now = new Date();
        return await this.repository
            .createQueryBuilder('schedule')
            .where('schedule.is_active = :isActive', { isActive: true })
            .andWhere('schedule.next_run_time <= :now', { now })
            .andWhere('schedule.trigger_type = :triggerType', { triggerType: TriggerType.CRON })
            .orderBy('schedule.next_run_time', 'ASC')
            .getMany();
    }

    /**
     * Update next run time for a schedule
     * @param id The schedule ID
     * @param nextRunTime The new next run time
     */
    async updateNextRunTime(id: number, nextRunTime: Date): Promise<void> {
        await this.repository.update(
            { id },
            { 
                next_run_time: nextRunTime,
                last_modified: new Date()
            }
        );
    }

    /**
     * Update last run time for a schedule
     * @param id The schedule ID
     * @param lastRunTime The new last run time
     */
    async updateLastRunTime(id: number, lastRunTime: Date): Promise<void> {
        await this.repository.update(
            { id },
            { 
                last_run_time: lastRunTime,
                last_modified: new Date()
            }
        );
    }

    /**
     * Increment execution count for a schedule
     * @param id The schedule ID
     * @param success Whether the execution was successful
     */
    async incrementExecutionCount(id: number, success: boolean): Promise<void> {
        const updateData: any = {
            last_modified: new Date()
        };

        if (success) {
            updateData.execution_count = () => 'execution_count + 1';
        } else {
            updateData.failure_count = () => 'failure_count + 1';
        }

        await this.repository.update({ id }, updateData);
    }

    /**
     * Update last error message for a schedule
     * @param id The schedule ID
     * @param errorMessage The error message
     */
    async updateLastErrorMessage(id: number, errorMessage: string): Promise<void> {
        await this.repository.update(
            { id },
            { 
                last_error_message: errorMessage,
                last_modified: new Date()
            }
        );
    }

    /**
     * Get child schedules for a parent schedule
     * @param parentId The parent schedule ID
     * @returns Array of child schedule entities
     */
    async getChildSchedules(parentId: number): Promise<ScheduleTaskEntity[]> {
        return await this.repository.find({
            where: { parent_schedule_id: parentId },
            order: { delay_minutes: 'ASC' }
        });
    }

    /**
     * Get parent schedule for a child schedule
     * @param childId The child schedule ID
     * @returns The parent schedule entity or null
     */
    async getParentSchedule(childId: number): Promise<ScheduleTaskEntity | null> {
        const child = await this.repository.findOne({
            where: { id: childId }
        });

        if (!child || !child.parent_schedule_id) {
            return null;
        }

        return await this.repository.findOne({
            where: { id: child.parent_schedule_id }
        });
    }

    /**
     * Get dependency chain for a schedule
     * @param scheduleId The schedule ID
     * @returns Array of schedule entities in the dependency chain
     */
    async getDependencyChain(scheduleId: number): Promise<ScheduleTaskEntity[]> {
        const chain: ScheduleTaskEntity[] = [];
        let currentId = scheduleId;

        while (currentId) {
            const schedule = await this.repository.findOne({
                where: { id: currentId }
            });

            if (!schedule) break;

            chain.unshift(schedule);
            currentId = schedule.parent_schedule_id || 0;
        }

        return chain;
    }

    /**
     * Check for circular dependencies
     * @param scheduleId The schedule ID to check
     * @returns True if circular dependency is detected
     */
    async checkCircularDependencies(scheduleId: number): Promise<boolean> {
        const visited = new Set<number>();
        const recursionStack = new Set<number>();

        const hasCycle = async (id: number): Promise<boolean> => {
            if (recursionStack.has(id)) {
                return true; // Circular dependency detected
            }

            if (visited.has(id)) {
                return false; // Already processed
            }

            visited.add(id);
            recursionStack.add(id);

            const schedule = await this.repository.findOne({
                where: { id }
            });

            if (schedule && schedule.parent_schedule_id) {
                const hasCircular = await hasCycle(schedule.parent_schedule_id);
                if (hasCircular) return true;
            }

            recursionStack.delete(id);
            return false;
        };

        return await hasCycle(scheduleId);
    }

    /**
     * Get schedules by task type
     * @param taskType The task type to filter by
     * @returns Array of schedule entities
     */
    async getSchedulesByTaskType(taskType: TaskType): Promise<ScheduleTaskEntity[]> {
        return await this.repository.find({
            where: { task_type: taskType },
            order: { createdAt: 'DESC' }
        });
    }

    /**
     * Get schedules by trigger type
     * @param triggerType The trigger type to filter by
     * @returns Array of schedule entities
     */
    async getSchedulesByTriggerType(triggerType: TriggerType): Promise<ScheduleTaskEntity[]> {
        return await this.repository.find({
            where: { trigger_type: triggerType },
            order: { createdAt: 'DESC' }
        });
    }

    /**
     * Enable a schedule
     * @param id The schedule ID
     */
    async enableSchedule(id: number): Promise<void> {
        await this.repository.update(
            { id },
            { 
                is_active: true,
                status: ScheduleStatus.ACTIVE,
                last_modified: new Date()
            }
        );
    }

    /**
     * Disable a schedule
     * @param id The schedule ID
     */
    async disableSchedule(id: number): Promise<void> {
        await this.repository.update(
            { id },
            { 
                is_active: false,
                status: ScheduleStatus.INACTIVE,
                last_modified: new Date()
            }
        );
    }

    /**
     * Pause a schedule
     * @param id The schedule ID
     */
    async pauseSchedule(id: number): Promise<void> {
        await this.repository.update(
            { id },
            { 
                status: ScheduleStatus.PAUSED,
                last_modified: new Date()
            }
        );
    }

    /**
     * Resume a schedule
     * @param id The schedule ID
     */
    async resumeSchedule(id: number): Promise<void> {
        await this.repository.update(
            { id },
            { 
                status: ScheduleStatus.ACTIVE,
                last_modified: new Date()
            }
        );
    }

    /**
     * Truncate the database table
     */
    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 