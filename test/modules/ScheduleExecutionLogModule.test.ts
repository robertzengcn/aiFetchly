import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScheduleExecutionLogModule } from '@/modules/ScheduleExecutionLogModule';
import { ExecutionStatus, TriggerType } from '@/entity/ScheduleExecutionLog.entity';

describe('ScheduleExecutionLogModule', () => {
    let scheduleExecutionLogModule: ScheduleExecutionLogModule;

    beforeEach(() => {
        scheduleExecutionLogModule = new ScheduleExecutionLogModule();
    });

    afterEach(async () => {
        // Clean up after each test
        try {
            await scheduleExecutionLogModule.truncatedb();
        } catch (error) {
            console.warn('Cleanup failed:', error);
        }
    });

    describe('logExecution', () => {
        it('should log a new execution', async () => {
            const executionId = await scheduleExecutionLogModule.logExecution(
                1, // scheduleId
                ExecutionStatus.SUCCESS,
                'Task completed successfully',
                1500, // duration in ms
                undefined, // parentExecutionId
                TriggerType.CRON,
                undefined // taskOutputId
            );

            expect(executionId).toBeGreaterThan(0);

            const execution = await scheduleExecutionLogModule.getExecutionById(executionId);
            expect(execution).not.toBeNull();
            expect(execution?.schedule_id).toBe(1);
            expect(execution?.status).toBe(ExecutionStatus.SUCCESS);
            expect(execution?.result_message).toBe('Task completed successfully');
            expect(execution?.execution_duration).toBe(1500);
            expect(execution?.triggered_by).toBe(TriggerType.CRON);
        });

        it('should log execution with parent execution ID', async () => {
            // Create parent execution first
            const parentExecutionId = await scheduleExecutionLogModule.logExecution(
                1,
                ExecutionStatus.SUCCESS,
                'Parent task completed',
                1000,
                undefined,
                TriggerType.CRON
            );

            // Create child execution
            const childExecutionId = await scheduleExecutionLogModule.logExecution(
                2,
                ExecutionStatus.SUCCESS,
                'Child task completed',
                500,
                parentExecutionId,
                TriggerType.DEPENDENCY
            );

            const childExecution = await scheduleExecutionLogModule.getExecutionById(childExecutionId);
            expect(childExecution?.parent_execution_id).toBe(parentExecutionId);
            expect(childExecution?.triggered_by).toBe(TriggerType.DEPENDENCY);
        });
    });

    describe('updateExecutionStatus', () => {
        it('should update execution status', async () => {
            const executionId = await scheduleExecutionLogModule.logExecution(
                1,
                ExecutionStatus.RUNNING,
                'Task started',
                0
            );

            await scheduleExecutionLogModule.updateExecutionStatus(
                executionId,
                ExecutionStatus.SUCCESS,
                'Task completed successfully',
                2000
            );

            const updatedExecution = await scheduleExecutionLogModule.getExecutionById(executionId);
            expect(updatedExecution?.status).toBe(ExecutionStatus.SUCCESS);
            expect(updatedExecution?.result_message).toBe('Task completed successfully');
            expect(updatedExecution?.execution_duration).toBe(2000);
            expect(updatedExecution?.completion_time).not.toBeNull();
        });
    });

    describe('getExecutionHistory', () => {
        it('should get execution history for a schedule', async () => {
            // Create multiple executions for the same schedule
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'First execution', 1000);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.FAILED, 'Second execution', 2000);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Third execution', 1500);

            const history = await scheduleExecutionLogModule.getExecutionHistory(1, 0, 10);
            expect(history.records.length).toBe(3);
            expect(history.num).toBe(3);

            // Check that executions are ordered by execution_time DESC
            expect(history.records[0].execution_time.getTime()).toBeGreaterThanOrEqual(
                history.records[1].execution_time.getTime()
            );
        });
    });

    describe('getRecentExecutions', () => {
        it('should get recent executions across all schedules', async () => {
            // Create executions for different schedules
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Schedule 1 execution', 1000);
            await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.SUCCESS, 'Schedule 2 execution', 1500);
            await scheduleExecutionLogModule.logExecution(3, ExecutionStatus.FAILED, 'Schedule 3 execution', 2000);

            const recentExecutions = await scheduleExecutionLogModule.getRecentExecutions(5);
            expect(recentExecutions.length).toBe(3);

            // Check that executions are ordered by execution_time DESC
            expect(recentExecutions[0].execution_time.getTime()).toBeGreaterThanOrEqual(
                recentExecutions[1].execution_time.getTime()
            );
        });
    });

    describe('getFailedExecutions', () => {
        it('should get failed executions for a schedule', async () => {
            // Create mixed executions
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Success 1', 1000);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.FAILED, 'Failed 1', 2000);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Success 2', 1500);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.FAILED, 'Failed 2', 3000);

            const failedExecutions = await scheduleExecutionLogModule.getFailedExecutions(1, 10);
            expect(failedExecutions.length).toBe(2);
            expect(failedExecutions.every(exec => exec.status === ExecutionStatus.FAILED)).toBe(true);
        });
    });

    describe('getExecutionChain', () => {
        it('should get execution chain', async () => {
            // Create a chain of executions
            const execution1 = await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'First', 1000);
            const execution2 = await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.SUCCESS, 'Second', 1500, execution1);
            const execution3 = await scheduleExecutionLogModule.logExecution(3, ExecutionStatus.SUCCESS, 'Third', 2000, execution2);

            const chain = await scheduleExecutionLogModule.getExecutionChain(execution3);
            expect(chain.length).toBe(3);
            expect(chain[0].id).toBe(execution1);
            expect(chain[1].id).toBe(execution2);
            expect(chain[2].id).toBe(execution3);
        });
    });

    describe('getExecutionsByStatus', () => {
        it('should get executions by status', async () => {
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Success 1', 1000);
            await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.FAILED, 'Failed 1', 2000);
            await scheduleExecutionLogModule.logExecution(3, ExecutionStatus.SUCCESS, 'Success 2', 1500);
            await scheduleExecutionLogModule.logExecution(4, ExecutionStatus.RUNNING, 'Running 1', 500);

            const successfulExecutions = await scheduleExecutionLogModule.getExecutionsByStatus(ExecutionStatus.SUCCESS, 10);
            expect(successfulExecutions.length).toBe(2);
            expect(successfulExecutions.every(exec => exec.status === ExecutionStatus.SUCCESS)).toBe(true);
        });
    });

    describe('getExecutionsByTriggerType', () => {
        it('should get executions by trigger type', async () => {
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Cron execution', 1000, undefined, TriggerType.CRON);
            await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.SUCCESS, 'Manual execution', 1500, undefined, TriggerType.MANUAL);
            await scheduleExecutionLogModule.logExecution(3, ExecutionStatus.SUCCESS, 'Dependency execution', 2000, undefined, TriggerType.DEPENDENCY);

            const cronExecutions = await scheduleExecutionLogModule.getExecutionsByTriggerType(TriggerType.CRON, 10);
            expect(cronExecutions.length).toBe(1);
            expect(cronExecutions[0].triggered_by).toBe(TriggerType.CRON);
        });
    });

    describe('getExecutionStatistics', () => {
        it('should get execution statistics for a schedule', async () => {
            // Create various executions
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Success 1', 1000);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Success 2', 1500);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.FAILED, 'Failed 1', 2000);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.RUNNING, 'Running 1', 500);

            const stats = await scheduleExecutionLogModule.getExecutionStatistics(1);
            expect(stats.total).toBe(4);
            expect(stats.successful).toBe(2);
            expect(stats.failed).toBe(1);
            expect(stats.running).toBe(1);
            expect(stats.averageDuration).toBeGreaterThan(0);
            expect(stats.lastExecution).not.toBeNull();
        });
    });

    describe('getRunningExecutions', () => {
        it('should get currently running executions', async () => {
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Completed', 1000);
            await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.RUNNING, 'Running 1', 500);
            await scheduleExecutionLogModule.logExecution(3, ExecutionStatus.RUNNING, 'Running 2', 750);

            const runningExecutions = await scheduleExecutionLogModule.getRunningExecutions();
            expect(runningExecutions.length).toBe(2);
            expect(runningExecutions.every(exec => exec.status === ExecutionStatus.RUNNING)).toBe(true);
        });
    });

    describe('cleanupOldExecutions', () => {
        it('should cleanup old executions', async () => {
            // Create some executions
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Recent', 1000);
            await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.SUCCESS, 'Recent', 1500);

            // Cleanup executions older than 30 days (should keep recent ones)
            const deletedCount = await scheduleExecutionLogModule.cleanupOldExecutions(30);
            
            // Should not delete recent executions
            expect(deletedCount).toBe(0);

            const recentExecutions = await scheduleExecutionLogModule.getRecentExecutions(10);
            expect(recentExecutions.length).toBe(2);
        });
    });

    describe('getExecutionsInDateRange', () => {
        it('should get executions in date range', async () => {
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Today', 1000);
            await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.SUCCESS, 'Today 2', 1500);

            const executions = await scheduleExecutionLogModule.getExecutionsInDateRange(yesterday, tomorrow);
            expect(executions.length).toBe(2);
        });
    });

    describe('listExecutions', () => {
        it('should list executions with filtering', async () => {
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.SUCCESS, 'Success', 1000, undefined, TriggerType.CRON);
            await scheduleExecutionLogModule.logExecution(1, ExecutionStatus.FAILED, 'Failed', 2000, undefined, TriggerType.MANUAL);
            await scheduleExecutionLogModule.logExecution(2, ExecutionStatus.SUCCESS, 'Other schedule', 1500, undefined, TriggerType.CRON);

            const result = await scheduleExecutionLogModule.listExecutions(
                0, 10, 1, ExecutionStatus.SUCCESS, TriggerType.CRON
            );

            expect(result.records.length).toBe(1);
            expect(result.records[0].schedule_id).toBe(1);
            expect(result.records[0].status).toBe(ExecutionStatus.SUCCESS);
            expect(result.records[0].triggered_by).toBe(TriggerType.CRON);
        });
    });
}); 