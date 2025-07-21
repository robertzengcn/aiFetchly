import { BaseModule } from "@/modules/baseModule";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";
import { ScheduleCreateRequest, ScheduleUpdateRequest, ScheduleDetailResponse, DependencyValidationResponse } from "@/entityTypes/schedule-type";
import { SortBy, ListData } from "@/entityTypes/commonType";
import { TaskType, ScheduleStatus, TriggerType, DependencyCondition } from "@/entity/ScheduleTask.entity";
import { ScheduleTaskModuleInterface } from "@/modules/interface/ScheduleTaskModuleInterface";
import * as cron from 'cron-validator';

export class ScheduleTaskModule extends BaseModule implements ScheduleTaskModuleInterface {
    private scheduleTaskModel: ScheduleTaskModel;

    constructor() {
        super();
        this.scheduleTaskModel = new ScheduleTaskModel(this.dbpath);
    }

    async createSchedule(scheduleData: ScheduleCreateRequest): Promise<number> {
        try {
            const validation = await this.validateSchedule(scheduleData);
            if (!validation.isValid) {
                throw new Error(`Schedule validation failed: ${validation.errors.join(', ')}`);
            }
            return await this.scheduleTaskModel.createSchedule(scheduleData);
        } catch (error) {
            console.error('Error creating schedule:', error);
            throw error;
        }
    }

    async updateSchedule(id: number, scheduleData: ScheduleUpdateRequest): Promise<void> {
        try {
            const validation = await this.validateSchedule(scheduleData);
            if (!validation.isValid) {
                throw new Error(`Schedule validation failed: ${validation.errors.join(', ')}`);
            }
            await this.scheduleTaskModel.updateSchedule(id, scheduleData);
        } catch (error) {
            console.error('Error updating schedule:', error);
            throw error;
        }
    }

    async deleteSchedule(id: number): Promise<void> {
        try {
            const childSchedules = await this.getChildSchedules(id);
            if (childSchedules.length > 0) {
                throw new Error('Cannot delete schedule with child schedules. Please delete child schedules first.');
            }
            await this.scheduleTaskModel.deleteSchedule(id);
        } catch (error) {
            console.error('Error deleting schedule:', error);
            throw error;
        }
    }

    async getScheduleById(id: number): Promise<ScheduleTaskEntity | null> {
        try {
            return await this.scheduleTaskModel.getScheduleById(id);
        } catch (error) {
            console.error('Error getting schedule by ID:', error);
            throw error;
        }
    }

    async listSchedules(page: number, size: number, sort?: SortBy): Promise<ListData<ScheduleTaskEntity>> {
        try {
            const records = await this.scheduleTaskModel.listSchedules(page, size, sort);
            const num = await this.scheduleTaskModel.getScheduleTotal();
            return { records, num };
        } catch (error) {
            console.error('Error listing schedules:', error);
            throw error;
        }
    }

    async getScheduleTotal(): Promise<number> {
        try {
            return await this.scheduleTaskModel.getScheduleTotal();
        } catch (error) {
            console.error('Error getting schedule total:', error);
            throw error;
        }
    }

    async getActiveSchedules(): Promise<ScheduleTaskEntity[]> {
        try {
            return await this.scheduleTaskModel.getActiveSchedules();
        } catch (error) {
            console.error('Error getting active schedules:', error);
            throw error;
        }
    }

    async getSchedulesReadyToExecute(): Promise<ScheduleTaskEntity[]> {
        try {
            return await this.scheduleTaskModel.getSchedulesReadyToExecute();
        } catch (error) {
            console.error('Error getting schedules ready to execute:', error);
            throw error;
        }
    }

    async updateNextRunTime(id: number, nextRunTime: Date): Promise<void> {
        try {
            await this.scheduleTaskModel.updateNextRunTime(id, nextRunTime);
        } catch (error) {
            console.error('Error updating next run time:', error);
            throw error;
        }
    }

    async updateLastRunTime(id: number, lastRunTime: Date): Promise<void> {
        try {
            await this.scheduleTaskModel.updateLastRunTime(id, lastRunTime);
        } catch (error) {
            console.error('Error updating last run time:', error);
            throw error;
        }
    }

    async incrementExecutionCount(id: number, success: boolean): Promise<void> {
        try {
            await this.scheduleTaskModel.incrementExecutionCount(id, success);
        } catch (error) {
            console.error('Error incrementing execution count:', error);
            throw error;
        }
    }

    async updateLastErrorMessage(id: number, errorMessage: string): Promise<void> {
        try {
            await this.scheduleTaskModel.updateLastErrorMessage(id, errorMessage);
        } catch (error) {
            console.error('Error updating last error message:', error);
            throw error;
        }
    }

    async getChildSchedules(parentId: number): Promise<ScheduleTaskEntity[]> {
        try {
            return await this.scheduleTaskModel.getChildSchedules(parentId);
        } catch (error) {
            console.error('Error getting child schedules:', error);
            throw error;
        }
    }

    async getParentSchedule(childId: number): Promise<ScheduleTaskEntity | null> {
        try {
            return await this.scheduleTaskModel.getParentSchedule(childId);
        } catch (error) {
            console.error('Error getting parent schedule:', error);
            throw error;
        }
    }

    async getDependencyChain(scheduleId: number): Promise<ScheduleTaskEntity[]> {
        try {
            return await this.scheduleTaskModel.getDependencyChain(scheduleId);
        } catch (error) {
            console.error('Error getting dependency chain:', error);
            throw error;
        }
    }

    async checkCircularDependencies(scheduleId: number): Promise<boolean> {
        try {
            return await this.scheduleTaskModel.checkCircularDependencies(scheduleId);
        } catch (error) {
            console.error('Error checking circular dependencies:', error);
            throw error;
        }
    }

    async getSchedulesByTaskType(taskType: TaskType): Promise<ScheduleTaskEntity[]> {
        try {
            return await this.scheduleTaskModel.getSchedulesByTaskType(taskType);
        } catch (error) {
            console.error('Error getting schedules by task type:', error);
            throw error;
        }
    }

    async getSchedulesByTriggerType(triggerType: TriggerType): Promise<ScheduleTaskEntity[]> {
        try {
            return await this.scheduleTaskModel.getSchedulesByTriggerType(triggerType);
        } catch (error) {
            console.error('Error getting schedules by trigger type:', error);
            throw error;
        }
    }

    async enableSchedule(id: number): Promise<void> {
        try {
            await this.scheduleTaskModel.enableSchedule(id);
        } catch (error) {
            console.error('Error enabling schedule:', error);
            throw error;
        }
    }

    async disableSchedule(id: number): Promise<void> {
        try {
            await this.scheduleTaskModel.disableSchedule(id);
        } catch (error) {
            console.error('Error disabling schedule:', error);
            throw error;
        }
    }

    async pauseSchedule(id: number): Promise<void> {
        try {
            await this.scheduleTaskModel.pauseSchedule(id);
        } catch (error) {
            console.error('Error pausing schedule:', error);
            throw error;
        }
    }

    async resumeSchedule(id: number): Promise<void> {
        try {
            await this.scheduleTaskModel.resumeSchedule(id);
        } catch (error) {
            console.error('Error resuming schedule:', error);
            throw error;
        }
    }

    async validateSchedule(scheduleData: ScheduleCreateRequest | ScheduleUpdateRequest): Promise<DependencyValidationResponse> {
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Validate name
            if ('name' in scheduleData && scheduleData.name !== undefined) {
                if (!scheduleData.name || scheduleData.name.trim().length === 0) {
                    errors.push('Schedule name is required');
                } else if (scheduleData.name.length > 255) {
                    errors.push('Schedule name must be less than 255 characters');
                }
            }

            // Validate description
            if ('description' in scheduleData && scheduleData.description !== undefined) {
                if (scheduleData.description && scheduleData.description.length > 1000) {
                    errors.push('Description must be less than 1000 characters');
                }
            }

            // Validate task_type
            if ('task_type' in scheduleData && scheduleData.task_type !== undefined) {
                if (!Object.values(TaskType).includes(scheduleData.task_type)) {
                    errors.push('Invalid task type');
                }
            }

            // Validate task_id
            if ('task_id' in scheduleData && scheduleData.task_id !== undefined) {
                if (scheduleData.task_id <= 0) {
                    errors.push('Task ID must be a positive number');
                }
            }

            // Validate cron_expression
            if ('cron_expression' in scheduleData && scheduleData.cron_expression !== undefined) {
                if (!scheduleData.cron_expression || scheduleData.cron_expression.trim().length === 0) {
                    errors.push('Cron expression is required');
                } else {
                    try {
                        const isValid = cron.isValidCron(scheduleData.cron_expression);
                        if (!isValid) {
                            errors.push('Invalid cron expression format');
                        }
                    } catch (cronError) {
                        errors.push('Invalid cron expression format');
                    }
                }
            }

            // Validate trigger_type
            if ('trigger_type' in scheduleData && scheduleData.trigger_type !== undefined) {
                if (!Object.values(TriggerType).includes(scheduleData.trigger_type)) {
                    errors.push('Invalid trigger type');
                }
            }

            // Validate parent_schedule_id
            if ('parent_schedule_id' in scheduleData && scheduleData.parent_schedule_id !== undefined) {
                if (scheduleData.parent_schedule_id !== null && scheduleData.parent_schedule_id <= 0) {
                    errors.push('Parent schedule ID must be a positive number or null');
                }
            }

            // Validate dependency_condition
            if ('dependency_condition' in scheduleData && scheduleData.dependency_condition !== undefined) {
                if (scheduleData.dependency_condition && !Object.values(DependencyCondition).includes(scheduleData.dependency_condition)) {
                    errors.push('Invalid dependency condition');
                }
            }

            // Validate delay_minutes
            if ('delay_minutes' in scheduleData && scheduleData.delay_minutes !== undefined) {
                if (scheduleData.delay_minutes < 0) {
                    errors.push('Delay minutes must be non-negative');
                }
                if (scheduleData.delay_minutes > 1440) { // 24 hours
                    warnings.push('Delay minutes is very high (>24 hours)');
                }
            }

            // Validate status
            if ('status' in scheduleData && scheduleData.status !== undefined) {
                if (!Object.values(ScheduleStatus).includes(scheduleData.status)) {
                    errors.push('Invalid status');
                }
            }

            // Check for circular dependencies if parent_schedule_id is set
            if ('parent_schedule_id' in scheduleData && scheduleData.parent_schedule_id && 'id' in scheduleData && scheduleData.id) {
                // This would need to be implemented in the model
                // For now, we'll add a warning
                warnings.push('Circular dependency check should be performed when updating parent schedule');
            }

            return {
                isValid: errors.length === 0,
                errors,
                warnings
            };
        } catch (error) {
            console.error('Error validating schedule:', error);
            errors.push('Validation failed due to system error');
            return {
                isValid: false,
                errors,
                warnings
            };
        }
    }

    async getScheduleDetails(id: number): Promise<ScheduleDetailResponse> {
        try {
            const schedule = await this.getScheduleById(id);
            if (!schedule) {
                throw new Error('Schedule not found');
            }

            const childSchedules = await this.getChildSchedules(id);
            const parentSchedule = await this.getParentSchedule(id);
            const dependencyChain = await this.getDependencyChain(id);

            return {
                schedule,
                dependencies: {
                    children: childSchedules,
                    parents: parentSchedule ? [parentSchedule] : []
                }
            };
        } catch (error) {
            console.error('Error getting schedule details:', error);
            throw error;
        }
    }

    async truncatedb(): Promise<void> {
        try {
            await this.scheduleTaskModel.truncatedb();
        } catch (error) {
            console.error('Error truncating database:', error);
            throw error;
        }
    }
} 