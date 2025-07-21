import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { ScheduleExecutionLogEntity, ExecutionStatus, TriggerType } from "@/entity/ScheduleExecutionLog.entity";

export class ScheduleExecutionLogModel extends BaseDb {
    private repository: Repository<ScheduleExecutionLogEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(ScheduleExecutionLogEntity);
    }

    /**
     * Log a new execution
     * @param scheduleId The schedule ID
     * @param status The execution status
     * @param message The result or error message
     * @param duration The execution duration in milliseconds
     * @param parentExecutionId Optional parent execution ID for dependency chains
     * @param triggeredBy What triggered this execution
     * @param taskOutputId Optional reference to task output
     * @returns The ID of the created execution log
     */
    async logExecution(
        scheduleId: number, 
        status: ExecutionStatus, 
        message: string, 
        duration: number,
        parentExecutionId?: number,
        triggeredBy: TriggerType = TriggerType.CRON,
        taskOutputId?: number
    ): Promise<number> {
        const executionLog = new ScheduleExecutionLogEntity();
        executionLog.schedule_id = scheduleId;
        executionLog.parent_execution_id = parentExecutionId || null;
        executionLog.execution_time = new Date();
        executionLog.status = status;
        executionLog.result_message = message;
        executionLog.execution_duration = duration;
        executionLog.task_output_id = taskOutputId || null;
        executionLog.triggered_by = triggeredBy;
        executionLog.completion_time = status !== ExecutionStatus.RUNNING ? new Date() : null;
        executionLog.metadata = JSON.stringify({
            triggeredBy,
            parentExecutionId,
            taskOutputId
        });

        const savedLog = await this.repository.save(executionLog);
        return savedLog.id;
    }

    /**
     * Update execution status
     * @param executionId The execution log ID
     * @param status The new status
     * @param message Optional result message
     * @param duration Optional execution duration
     */
    async updateExecutionStatus(
        executionId: number, 
        status: ExecutionStatus, 
        message?: string,
        duration?: number
    ): Promise<void> {
        const updateData: any = { status };
        
        if (message !== undefined) {
            updateData.result_message = message;
        }
        
        if (duration !== undefined) {
            updateData.execution_duration = duration;
        }
        
        if (status !== ExecutionStatus.RUNNING) {
            updateData.completion_time = new Date();
        }

        await this.repository.update({ id: executionId }, updateData);
    }

    /**
     * Get execution history for a schedule
     * @param scheduleId The schedule ID
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @returns Array of execution log entities
     */
    async getExecutionHistory(scheduleId: number, page: number, size: number): Promise<ScheduleExecutionLogEntity[]> {
        return await this.repository.find({
            where: { schedule_id: scheduleId },
            order: { execution_time: 'DESC' },
            take: size,
            skip: page * size
        });
    }

    /**
     * Get total number of executions for a schedule
     * @param scheduleId The schedule ID
     * @returns Total count of executions
     */
    async getExecutionHistoryTotal(scheduleId: number): Promise<number> {
        return await this.repository.count({
            where: { schedule_id: scheduleId }
        });
    }

    /**
     * Get recent executions across all schedules
     * @param limit Maximum number of executions to return
     * @returns Array of recent execution log entities
     */
    async getRecentExecutions(limit: number): Promise<ScheduleExecutionLogEntity[]> {
        return await this.repository.find({
            order: { execution_time: 'DESC' },
            take: limit
        });
    }

    /**
     * Get failed executions for a schedule
     * @param scheduleId The schedule ID
     * @param limit Maximum number of executions to return
     * @returns Array of failed execution log entities
     */
    async getFailedExecutions(scheduleId: number, limit: number): Promise<ScheduleExecutionLogEntity[]> {
        return await this.repository.find({
            where: { 
                schedule_id: scheduleId,
                status: ExecutionStatus.FAILED
            },
            order: { execution_time: 'DESC' },
            take: limit
        });
    }

    /**
     * Get child executions for a parent execution
     * @param parentExecutionId The parent execution ID
     * @returns Array of child execution log entities
     */
    async getChildExecutions(parentExecutionId: number): Promise<ScheduleExecutionLogEntity[]> {
        return await this.repository.find({
            where: { parent_execution_id: parentExecutionId },
            order: { execution_time: 'ASC' }
        });
    }

    /**
     * Get execution chain starting from a specific execution
     * @param executionId The execution ID to start from
     * @returns Array of execution log entities in the chain
     */
    async getExecutionChain(executionId: number): Promise<ScheduleExecutionLogEntity[]> {
        const chain: ScheduleExecutionLogEntity[] = [];
        let currentId = executionId;

        while (currentId) {
            const execution = await this.repository.findOne({
                where: { id: currentId }
            });

            if (!execution) break;

            chain.unshift(execution);
            currentId = execution.parent_execution_id || 0;
        }

        return chain;
    }

    /**
     * Get executions by status
     * @param status The execution status to filter by
     * @param limit Maximum number of executions to return
     * @returns Array of execution log entities
     */
    async getExecutionsByStatus(status: ExecutionStatus, limit: number): Promise<ScheduleExecutionLogEntity[]> {
        return await this.repository.find({
            where: { status },
            order: { execution_time: 'DESC' },
            take: limit
        });
    }

    /**
     * Get executions by trigger type
     * @param triggeredBy The trigger type to filter by
     * @param limit Maximum number of executions to return
     * @returns Array of execution log entities
     */
    async getExecutionsByTriggerType(triggeredBy: TriggerType, limit: number): Promise<ScheduleExecutionLogEntity[]> {
        return await this.repository.find({
            where: { triggered_by: triggeredBy },
            order: { execution_time: 'DESC' },
            take: limit
        });
    }

    /**
     * Get execution statistics for a schedule
     * @param scheduleId The schedule ID
     * @returns Object with execution statistics
     */
    async getExecutionStatistics(scheduleId: number): Promise<{
        total: number;
        successful: number;
        failed: number;
        running: number;
        averageDuration: number;
        lastExecution: Date | null;
    }> {
        const total = await this.repository.count({
            where: { schedule_id: scheduleId }
        });

        const successful = await this.repository.count({
            where: { 
                schedule_id: scheduleId,
                status: ExecutionStatus.SUCCESS
            }
        });

        const failed = await this.repository.count({
            where: { 
                schedule_id: scheduleId,
                status: ExecutionStatus.FAILED
            }
        });

        const running = await this.repository.count({
            where: { 
                schedule_id: scheduleId,
                status: ExecutionStatus.RUNNING
            }
        });

        // Get average duration
        const avgDurationResult = await this.repository
            .createQueryBuilder('execution')
            .select('AVG(execution.execution_duration)', 'averageDuration')
            .where('execution.schedule_id = :scheduleId', { scheduleId })
            .andWhere('execution.execution_duration IS NOT NULL')
            .getRawOne();

        const averageDuration = avgDurationResult?.averageDuration || 0;

        // Get last execution time
        const lastExecution = await this.repository.findOne({
            where: { schedule_id: scheduleId },
            order: { execution_time: 'DESC' },
            select: ['execution_time']
        });

        return {
            total,
            successful,
            failed,
            running,
            averageDuration: Math.round(averageDuration),
            lastExecution: lastExecution?.execution_time || null
        };
    }

    /**
     * Get execution by ID
     * @param executionId The execution ID
     * @returns The execution log entity or null
     */
    async getExecutionById(executionId: number): Promise<ScheduleExecutionLogEntity | null> {
        return await this.repository.findOne({
            where: { id: executionId }
        });
    }

    /**
     * Get running executions
     * @returns Array of currently running execution log entities
     */
    async getRunningExecutions(): Promise<ScheduleExecutionLogEntity[]> {
        return await this.repository.find({
            where: { status: ExecutionStatus.RUNNING },
            order: { execution_time: 'ASC' }
        });
    }

    /**
     * Clean up old execution logs
     * @param daysToKeep Number of days to keep execution logs
     * @returns Number of deleted records
     */
    async cleanupOldExecutions(daysToKeep: number): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const result = await this.repository
            .createQueryBuilder()
            .delete()
            .where('execution_time < :cutoffDate', { cutoffDate })
            .execute();

        return result.affected || 0;
    }

    /**
     * Get executions within a date range
     * @param startDate Start date
     * @param endDate End date
     * @param scheduleId Optional schedule ID to filter by
     * @returns Array of execution log entities
     */
    async getExecutionsInDateRange(
        startDate: Date, 
        endDate: Date, 
        scheduleId?: number
    ): Promise<ScheduleExecutionLogEntity[]> {
        const queryBuilder = this.repository
            .createQueryBuilder('execution')
            .where('execution.execution_time >= :startDate', { startDate })
            .andWhere('execution.execution_time <= :endDate', { endDate })
            .orderBy('execution.execution_time', 'DESC');

        if (scheduleId) {
            queryBuilder.andWhere('execution.schedule_id = :scheduleId', { scheduleId });
        }

        return await queryBuilder.getMany();
    }

    /**
     * Truncate the database table
     */
    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 