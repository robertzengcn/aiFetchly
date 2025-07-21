import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScheduleTaskModule } from '@/modules/ScheduleTaskModule';
import { ScheduleCreateRequest, TaskType, TriggerType, DependencyCondition } from '@/entityTypes/schedule-type';
import { ScheduleStatus } from '@/entity/ScheduleTask.entity';

describe('ScheduleTaskModule', () => {
    let scheduleTaskModule: ScheduleTaskModule;

    beforeEach(() => {
        scheduleTaskModule = new ScheduleTaskModule();
    });

    afterEach(async () => {
        // Clean up after each test
        try {
            await scheduleTaskModule.truncatedb();
        } catch (error) {
            console.warn('Cleanup failed:', error);
        }
    });

    describe('createSchedule', () => {
        it('should create a valid schedule', async () => {
            const scheduleData: ScheduleCreateRequest = {
                name: 'Test Schedule',
                description: 'Test description',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 1,
                cron_expression: '0 0 * * *',
                is_active: true,
                trigger_type: TriggerType.CRON
            };

            const id = await scheduleTaskModule.createSchedule(scheduleData);
            expect(id).toBeGreaterThan(0);

            const createdSchedule = await scheduleTaskModule.getScheduleById(id);
            expect(createdSchedule).not.toBeNull();
            expect(createdSchedule?.name).toBe('Test Schedule');
            expect(createdSchedule?.task_type).toBe(TaskType.EMAIL_EXTRACT);
        });

        it('should validate cron expression', async () => {
            const scheduleData: ScheduleCreateRequest = {
                name: 'Invalid Cron Schedule',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 1,
                cron_expression: 'invalid cron',
                is_active: true
            };

            await expect(scheduleTaskModule.createSchedule(scheduleData))
                .rejects.toThrow('Schedule validation failed');
        });
    });

    describe('updateSchedule', () => {
        it('should update an existing schedule', async () => {
            // Create a schedule first
            const scheduleData: ScheduleCreateRequest = {
                name: 'Original Name',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 1,
                cron_expression: '0 0 * * *',
                is_active: true
            };

            const id = await scheduleTaskModule.createSchedule(scheduleData);

            // Update the schedule
            await scheduleTaskModule.updateSchedule(id, {
                name: 'Updated Name',
                description: 'Updated description'
            });

            const updatedSchedule = await scheduleTaskModule.getScheduleById(id);
            expect(updatedSchedule?.name).toBe('Updated Name');
            expect(updatedSchedule?.description).toBe('Updated description');
        });
    });

    describe('listSchedules', () => {
        it('should list schedules with pagination', async () => {
            // Create multiple schedules
            const scheduleData1: ScheduleCreateRequest = {
                name: 'Schedule 1',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 1,
                cron_expression: '0 0 * * *',
                is_active: true
            };

            const scheduleData2: ScheduleCreateRequest = {
                name: 'Schedule 2',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 2,
                cron_expression: '0 12 * * *',
                is_active: true
            };

            await scheduleTaskModule.createSchedule(scheduleData1);
            await scheduleTaskModule.createSchedule(scheduleData2);

            const result = await scheduleTaskModule.listSchedules(0, 10);
            expect(result.records.length).toBeGreaterThanOrEqual(2);
            expect(result.num).toBeGreaterThanOrEqual(2);
        });
    });

    describe('schedule status management', () => {
        it('should enable and disable schedules', async () => {
            const scheduleData: ScheduleCreateRequest = {
                name: 'Status Test Schedule',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 1,
                cron_expression: '0 0 * * *',
                is_active: false
            };

            const id = await scheduleTaskModule.createSchedule(scheduleData);

            // Enable the schedule
            await scheduleTaskModule.enableSchedule(id);
            let schedule = await scheduleTaskModule.getScheduleById(id);
            expect(schedule?.is_active).toBe(true);
            expect(schedule?.status).toBe(ScheduleStatus.ACTIVE);

            // Disable the schedule
            await scheduleTaskModule.disableSchedule(id);
            schedule = await scheduleTaskModule.getScheduleById(id);
            expect(schedule?.is_active).toBe(false);
            expect(schedule?.status).toBe(ScheduleStatus.INACTIVE);
        });

        it('should pause and resume schedules', async () => {
            const scheduleData: ScheduleCreateRequest = {
                name: 'Pause Test Schedule',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 1,
                cron_expression: '0 0 * * *',
                is_active: true
            };

            const id = await scheduleTaskModule.createSchedule(scheduleData);

            // Pause the schedule
            await scheduleTaskModule.pauseSchedule(id);
            let schedule = await scheduleTaskModule.getScheduleById(id);
            expect(schedule?.status).toBe(ScheduleStatus.PAUSED);

            // Resume the schedule
            await scheduleTaskModule.resumeSchedule(id);
            schedule = await scheduleTaskModule.getScheduleById(id);
            expect(schedule?.status).toBe(ScheduleStatus.ACTIVE);
        });
    });

    describe('validation', () => {
        it('should validate schedule data', async () => {
            const invalidScheduleData: ScheduleCreateRequest = {
                name: '', // Invalid: empty name
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: -1, // Invalid: negative task_id
                cron_expression: 'invalid cron', // Invalid cron
                is_active: true
            };

            const validation = await scheduleTaskModule.validateSchedule(invalidScheduleData);
            expect(validation.isValid).toBe(false);
            expect(validation.errors.length).toBeGreaterThan(0);
        });

        it('should validate valid schedule data', async () => {
            const validScheduleData: ScheduleCreateRequest = {
                name: 'Valid Schedule',
                task_type: TaskType.EMAIL_EXTRACT,
                task_id: 1,
                cron_expression: '0 0 * * *',
                is_active: true
            };

            const validation = await scheduleTaskModule.validateSchedule(validScheduleData);
            expect(validation.isValid).toBe(true);
            expect(validation.errors.length).toBe(0);
        });
    });
}); 