import { BaseModule } from "@/modules/baseModule";
import { ScheduleExecutionLogModel } from "@/model/ScheduleExecutionLog.model";
import { ScheduleExecutionLogEntity } from "@/entity/ScheduleExecutionLog.entity";
import { ExecutionStatus, TriggerType } from "@/entity/ScheduleExecutionLog.entity";
import { SortBy, ListData } from "@/entityTypes/commonType";
import { ScheduleExecutionLogInterface, ExecutionStatistics } from "@/modules/interface/ScheduleExecutionLogInterface";

export class ScheduleExecutionLogModule extends BaseModule implements ScheduleExecutionLogInterface {
    private scheduleExecutionLogModel: ScheduleExecutionLogModel;

    constructor() {
        super();
        this.scheduleExecutionLogModel = new ScheduleExecutionLogModel(this.dbpath);
    }

    async logExecution(
        scheduleId: number, 
        status: ExecutionStatus, 
        message: string, 
        duration: number,
        parentExecutionId?: number,
        triggeredBy: TriggerType = TriggerType.CRON,
        taskOutputId?: number
    ): Promise<number> {
        try {
            return await this.scheduleExecutionLogModel.logExecution(
                scheduleId,
                status,
                message,
                duration,
                parentExecutionId,
                triggeredBy,
                taskOutputId
            );
        } catch (error) {
            console.error('Error logging execution:', error);
            throw error;
        }
    }

    async updateExecutionStatus(
        executionId: number, 
        status: ExecutionStatus, 
        message?: string,
        duration?: number
    ): Promise<void> {
        try {
            await this.scheduleExecutionLogModel.updateExecutionStatus(
                executionId,
                status,
                message,
                duration
            );
        } catch (error) {
            console.error('Error updating execution status:', error);
            throw error;
        }
    }

    async getExecutionById(executionId: number): Promise<ScheduleExecutionLogEntity | null> {
        try {
            return await this.scheduleExecutionLogModel.getExecutionById(executionId);
        } catch (error) {
            console.error('Error getting execution by ID:', error);
            throw error;
        }
    }

    async getExecutionHistory(scheduleId: number, page: number, size: number): Promise<ListData<ScheduleExecutionLogEntity>> {
        try {
            const records = await this.scheduleExecutionLogModel.getExecutionHistory(scheduleId, page, size);
            const num = await this.scheduleExecutionLogModel.getExecutionHistoryTotal(scheduleId);
            return { records, num };
        } catch (error) {
            console.error('Error getting execution history:', error);
            throw error;
        }
    }

    async getExecutionHistoryTotal(scheduleId: number): Promise<number> {
        try {
            return await this.scheduleExecutionLogModel.getExecutionHistoryTotal(scheduleId);
        } catch (error) {
            console.error('Error getting execution history total:', error);
            throw error;
        }
    }

    async getRecentExecutions(limit: number): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getRecentExecutions(limit);
        } catch (error) {
            console.error('Error getting recent executions:', error);
            throw error;
        }
    }

    async getFailedExecutions(scheduleId: number, limit: number): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getFailedExecutions(scheduleId, limit);
        } catch (error) {
            console.error('Error getting failed executions:', error);
            throw error;
        }
    }

    async getChildExecutions(parentExecutionId: number): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getChildExecutions(parentExecutionId);
        } catch (error) {
            console.error('Error getting child executions:', error);
            throw error;
        }
    }

    async getExecutionChain(executionId: number): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getExecutionChain(executionId);
        } catch (error) {
            console.error('Error getting execution chain:', error);
            throw error;
        }
    }

    async getExecutionsByStatus(status: ExecutionStatus, limit: number): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getExecutionsByStatus(status, limit);
        } catch (error) {
            console.error('Error getting executions by status:', error);
            throw error;
        }
    }

    async getExecutionsByTriggerType(triggeredBy: TriggerType, limit: number): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getExecutionsByTriggerType(triggeredBy, limit);
        } catch (error) {
            console.error('Error getting executions by trigger type:', error);
            throw error;
        }
    }

    async getExecutionStatistics(scheduleId: number): Promise<ExecutionStatistics> {
        try {
            return await this.scheduleExecutionLogModel.getExecutionStatistics(scheduleId);
        } catch (error) {
            console.error('Error getting execution statistics:', error);
            throw error;
        }
    }

    async getRunningExecutions(): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getRunningExecutions();
        } catch (error) {
            console.error('Error getting running executions:', error);
            throw error;
        }
    }

    async cleanupOldExecutions(daysToKeep: number): Promise<number> {
        try {
            return await this.scheduleExecutionLogModel.cleanupOldExecutions(daysToKeep);
        } catch (error) {
            console.error('Error cleaning up old executions:', error);
            throw error;
        }
    }

    async getExecutionsInDateRange(
        startDate: Date, 
        endDate: Date, 
        scheduleId?: number
    ): Promise<ScheduleExecutionLogEntity[]> {
        try {
            return await this.scheduleExecutionLogModel.getExecutionsInDateRange(startDate, endDate, scheduleId);
        } catch (error) {
            console.error('Error getting executions in date range:', error);
            throw error;
        }
    }

    async listExecutions(
        page: number, 
        size: number, 
        scheduleId?: number,
        status?: ExecutionStatus,
        triggeredBy?: TriggerType,
        sort?: SortBy
    ): Promise<ListData<ScheduleExecutionLogEntity>> {
        try {
            // This method needs to be implemented in the model
            // For now, we'll use a simple approach with the existing methods
            let executions: ScheduleExecutionLogEntity[] = [];
            
            if (scheduleId) {
                const history = await this.getExecutionHistory(scheduleId, page, size);
                executions = history.records;
            } else {
                executions = await this.getRecentExecutions(size);
            }

            // Apply filters
            if (status) {
                executions = executions.filter(exec => exec.status === status);
            }
            if (triggeredBy) {
                executions = executions.filter(exec => exec.triggered_by === triggeredBy);
            }

            // Apply sorting
            if (sort) {
                executions.sort((a, b) => {
                    const aValue = a[sort.key as keyof ScheduleExecutionLogEntity];
                    const bValue = b[sort.key as keyof ScheduleExecutionLogEntity];
                    
                    // Handle null/undefined values
                    if (aValue == null && bValue == null) return 0;
                    if (aValue == null) return sort.order === 'ASC' ? -1 : 1;
                    if (bValue == null) return sort.order === 'ASC' ? 1 : -1;
                    
                    if (sort.order === 'ASC') {
                        return aValue > bValue ? 1 : -1;
                    } else {
                        return aValue < bValue ? 1 : -1;
                    }
                });
            }

            const total = await this.getExecutionsTotal(scheduleId, status, triggeredBy);
            
            return {
                records: executions,
                num: total
            };
        } catch (error) {
            console.error('Error listing executions:', error);
            throw error;
        }
    }

    async getExecutionsTotal(
        scheduleId?: number,
        status?: ExecutionStatus,
        triggeredBy?: TriggerType
    ): Promise<number> {
        try {
            if (scheduleId) {
                return await this.getExecutionHistoryTotal(scheduleId);
            }
            
            // For now, return a reasonable estimate
            // This could be enhanced with a more sophisticated query
            const recentExecutions = await this.getRecentExecutions(1000);
            let filtered = recentExecutions;
            
            if (status) {
                filtered = filtered.filter(exec => exec.status === status);
            }
            if (triggeredBy) {
                filtered = filtered.filter(exec => exec.triggered_by === triggeredBy);
            }
            
            return filtered.length;
        } catch (error) {
            console.error('Error getting executions total:', error);
            throw error;
        }
    }

    async deleteExecution(executionId: number): Promise<void> {
        try {
            // This method needs to be implemented in the model
            // For now, we'll throw an error indicating it's not implemented
            throw new Error('Delete execution method not implemented in model yet');
        } catch (error) {
            console.error('Error deleting execution:', error);
            throw error;
        }
    }

    async deleteExecutionsBySchedule(scheduleId: number): Promise<number> {
        try {
            // This method needs to be implemented in the model
            // For now, we'll throw an error indicating it's not implemented
            throw new Error('Delete executions by schedule method not implemented in model yet');
        } catch (error) {
            console.error('Error deleting executions by schedule:', error);
            throw error;
        }
    }

    async truncatedb(): Promise<void> {
        try {
            await this.scheduleExecutionLogModel.truncatedb();
        } catch (error) {
            console.error('Error truncating database:', error);
            throw error;
        }
    }
} 