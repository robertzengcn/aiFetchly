/**
 * Integration test for Yellow Pages module with scheduler
 * This test verifies that Yellow Pages tasks can be created and executed through the scheduling system
 */

import { YellowPagesModule } from "@/modules/YellowPagesModule";
import { TaskExecutorService } from "@/modules/TaskExecutorService";
import { ScheduleTaskEntity, TaskType } from "@/entity/ScheduleTask.entity";
import { YellowPagesTaskData, TaskStatus } from "@/interfaces/ITaskManager";

export class YellowPagesIntegrationTest {
    private yellowPagesModule: YellowPagesModule;
    private taskExecutorService: TaskExecutorService;

    constructor() {
        this.yellowPagesModule = new YellowPagesModule();
        this.taskExecutorService = new TaskExecutorService();
    }

    /**
     * Test creating a Yellow Pages task
     */
    async testCreateTask(): Promise<number> {
        console.log('Testing Yellow Pages task creation...');

        const taskData: YellowPagesTaskData = {
            name: "Test Yellow Pages Task",
            platform: "yellowpages.com",
            keywords: ["restaurant", "pizza"],
            location: "New York, NY",
            max_pages: 2,
            concurrency: 1,
            delay_between_requests: 2000
        };

        try {
            const taskId = await this.yellowPagesModule.createTask(taskData);
            console.log(`✅ Task created successfully with ID: ${taskId}`);
            return taskId;
        } catch (error) {
            console.error('❌ Failed to create task:', error);
            throw error;
        }
    }

    /**
     * Test task status retrieval
     */
    async testGetTaskStatus(taskId: number): Promise<void> {
        console.log(`Testing task status retrieval for task ${taskId}...`);

        try {
            const status = await this.yellowPagesModule.getTaskStatus(taskId);
            console.log(`✅ Task status retrieved: ${TaskStatus[status]}`);
        } catch (error) {
            console.error('❌ Failed to get task status:', error);
            throw error;
        }
    }

    /**
     * Test task progress retrieval
     */
    async testGetTaskProgress(taskId: number): Promise<void> {
        console.log(`Testing task progress retrieval for task ${taskId}...`);

        try {
            const progress = await this.yellowPagesModule.getTaskProgress(taskId);
            console.log(`✅ Task progress retrieved:`, {
                status: TaskStatus[progress.status],
                percentage: progress.percentage,
                currentPage: progress.currentPage,
                totalPages: progress.totalPages
            });
        } catch (error) {
            console.error('❌ Failed to get task progress:', error);
            throw error;
        }
    }

    /**
     * Test TaskExecutorService integration
     */
    async testTaskExecutorIntegration(taskId: number): Promise<void> {
        console.log(`Testing TaskExecutorService integration for task ${taskId}...`);

        try {
            // Test task status retrieval through TaskExecutorService
            const status = await this.taskExecutorService.getTaskStatus(taskId, TaskType.YELLOW_PAGES);
            console.log(`✅ TaskExecutorService status retrieved: ${status}`);

            // Test task validation
            const validation = await this.taskExecutorService.validateTaskConfiguration(taskId, TaskType.YELLOW_PAGES);
            console.log(`✅ Task validation result:`, validation);

        } catch (error) {
            console.error('❌ Failed TaskExecutorService integration test:', error);
            throw error;
        }
    }

    /**
     * Test scheduled task execution simulation
     */
    async testScheduledTaskExecution(taskId: number): Promise<void> {
        console.log(`Testing scheduled task execution simulation for task ${taskId}...`);

        try {
            // Create a mock schedule entity
            const mockSchedule: Partial<ScheduleTaskEntity> = {
                id: 1,
                name: "Test Schedule",
                description: "Test Yellow Pages Schedule",
                task_type: TaskType.YELLOW_PAGES,
                task_id: taskId,
                cron_expression: "0 9 * * *",
                is_active: true,
                last_run_time: new Date(0), // Use epoch time instead of null
                next_run_time: new Date(),
                status: "active",
                execution_count: 0,
                failure_count: 0,
                last_error_message: "", // Use empty string instead of null
                last_modified: new Date(),
                trigger_type: "cron",
                parent_schedule_id: null,
                dependency_condition: "on_success",
                delay_minutes: 0,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Test execution through TaskExecutorService
            const result = await this.taskExecutorService.executeScheduledTask(mockSchedule as ScheduleTaskEntity);
            console.log(`✅ Scheduled task execution result: ${result}`);

        } catch (error) {
            console.error('❌ Failed scheduled task execution test:', error);
            throw error;
        }
    }

    /**
     * Test task listing
     */
    async testListTasks(): Promise<void> {
        console.log('Testing task listing...');

        try {
            const tasks = await this.yellowPagesModule.listTasks({ limit: 10 });
            console.log(`✅ Retrieved ${tasks.length} tasks`);
            
            if (tasks.length > 0) {
                console.log('Sample task:', {
                    id: tasks[0].id,
                    name: tasks[0].name,
                    platform: tasks[0].platform,
                    status: TaskStatus[tasks[0].status]
                });
            }
        } catch (error) {
            console.error('❌ Failed to list tasks:', error);
            throw error;
        }
    }

    /**
     * Test health status
     */
    async testHealthStatus(): Promise<void> {
        console.log('Testing health status...');

        try {
            const health = await this.yellowPagesModule.getHealthStatus();
            console.log(`✅ Health status:`, health);
        } catch (error) {
            console.error('❌ Failed to get health status:', error);
            throw error;
        }
    }

    /**
     * Run all integration tests
     */
    async runAllTests(): Promise<void> {
        console.log('🚀 Starting Yellow Pages Integration Tests...\n');

        try {
            // Test 1: Create a task
            const taskId = await this.testCreateTask();
            console.log('');

            // Test 2: Get task status
            await this.testGetTaskStatus(taskId);
            console.log('');

            // Test 3: Get task progress
            await this.testGetTaskProgress(taskId);
            console.log('');

            // Test 4: Test TaskExecutorService integration
            await this.testTaskExecutorIntegration(taskId);
            console.log('');

            // Test 5: Test scheduled task execution simulation
            await this.testScheduledTaskExecution(taskId);
            console.log('');

            // Test 6: List tasks
            await this.testListTasks();
            console.log('');

            // Test 7: Health status
            await this.testHealthStatus();
            console.log('');

            console.log('🎉 All integration tests completed successfully!');

        } catch (error) {
            console.error('💥 Integration tests failed:', error);
            throw error;
        }
    }
}

// Export for use in other test files
export default YellowPagesIntegrationTest;