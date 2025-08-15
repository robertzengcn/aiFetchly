import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { YellowPagesTaskEntity } from "@/entity/YellowPagesTask.entity";
import { getRecorddatetime } from "@/modules/lib/function";
import { SortBy } from "@/entityTypes/commonType";

export enum YellowPagesTaskStatus {
  Pending = 0,
  InProgress = 1,
  Completed = 2,
  Failed = 3,
  Paused = 4
}

export type YellowPagesTaskUpdateFields = {
  name?: string;
  platform?: string;
  keywords?: string[];
  location?: string;
  max_pages?: number;
  concurrency?: number;
  status?: YellowPagesTaskStatus;
  scheduled_at?: Date;
  completed_at?: Date;
  error_log?: string;
  run_log?: string;
  account_id?: number;
  proxy_config?: string;
  delay_between_requests?: number;
  headless?: boolean;
}

export class YellowPagesTaskModel extends BaseDb {
  private repository: Repository<YellowPagesTaskEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(YellowPagesTaskEntity);
  }

  /**
   * Save a new yellow pages task
   * @param taskData The task data
   * @returns The ID of the created task
   */
  async saveYellowPagesTask(taskData: {
    name: string;
    platform: string;
    keywords: string[];
    location: string;
    max_pages?: number;
    concurrency?: number;
    account_id?: number;
    proxy_config?: string;
    delay_between_requests?: number;
    headless?: boolean;
  }): Promise<number> {
    const taskEntity = new YellowPagesTaskEntity();
    taskEntity.name = taskData.name;
    taskEntity.platform = taskData.platform;
    taskEntity.keywords = JSON.stringify(taskData.keywords);
    taskEntity.location = taskData.location;
    taskEntity.max_pages = taskData.max_pages || 1;
    taskEntity.concurrency = taskData.concurrency || 1;
    taskEntity.status = YellowPagesTaskStatus.Pending;
    taskEntity.account_id = taskData.account_id;
    taskEntity.proxy_config = taskData.proxy_config ? JSON.stringify(taskData.proxy_config) : undefined;
    taskEntity.delay_between_requests = taskData.delay_between_requests || 2000;
    taskEntity.headless = taskData.headless !== undefined ? taskData.headless : true;
    
    const savedTask = await this.repository.save(taskEntity);
    return savedTask.id;
  }

  /**
   * Update task status
   * @param taskId The task ID
   * @param status The new status
   */
  async updateTaskStatus(taskId: number, status: YellowPagesTaskStatus): Promise<void> {
    await this.repository.update(
      { id: taskId },
      { status }
    );
  }

  /**
   * Update task error log
   * @param taskId The task ID
   * @param errorLog The error log content
   */
  async updateTaskErrorLog(taskId: number, errorLog: string): Promise<void> {
    await this.repository.update(
      { id: taskId },
      { error_log: errorLog }
    );
  }

  /**
   * Update task runtime log
   * @param taskId The task ID
   * @param runLog The runtime log content
   */
  async updateTaskRunLog(taskId: number, runLog: string): Promise<void> {
    await this.repository.update(
      { id: taskId },
      { run_log: runLog }
    );
  }

  /**
   * Update task completion time
   * @param taskId The task ID
   */
  async updateTaskCompletion(taskId: number): Promise<void> {
    await this.repository.update(
      { id: taskId },
      { 
        completed_at: new Date(),
        status: YellowPagesTaskStatus.Completed
      }
    );
  }

  /**
   * Get task by ID
   * @param taskId The task ID
   * @returns The task entity or null
   */
  async getTaskById(taskId: number): Promise<YellowPagesTaskEntity | null> {
    return await this.repository.findOne({ where: { id: taskId } });
  }

  /**
   * List tasks with pagination
   * @param page Page number (1-based)
   * @param size Page size
   * @param sort Sort options
   * @returns Array of task entities
   */
  async listTasks(page: number = 1, size: number = 10, sort?: SortBy): Promise<YellowPagesTaskEntity[]> {
    const skip = (page - 1) * size;
    const orderBy: any = {};
    
    if (sort) {
      orderBy[sort.key] = sort.order;
    } else {
      orderBy.createdAt = 'DESC';
    }

    return await this.repository.find({
      skip,
      take: size,
      order: orderBy
    });
  }

  /**
   * Get total count of tasks
   * @returns Total number of tasks
   */
  async getTaskTotal(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Update task fields
   * @param taskId The task ID
   * @param updates The fields to update
   * @returns Success status
   */
  async updateTask(taskId: number, updates: YellowPagesTaskUpdateFields): Promise<boolean> {
    try {
      const updateData: any = { ...updates };
      
      // Handle JSON fields
      if (updates.keywords) {
        updateData.keywords = JSON.stringify(updates.keywords);
      }
      if (updates.proxy_config) {
        updateData.proxy_config = JSON.stringify(updates.proxy_config);
      }

      await this.repository.update(
        { id: taskId },
        updateData
      );
      return true;
    } catch (error) {
      console.error('Error updating task:', error);
      return false;
    }
  }

  /**
   * Delete task
   * @param taskId The task ID
   * @returns Success status
   */
  async deleteTask(taskId: number): Promise<boolean> {
    try {
      await this.repository.delete({ id: taskId });
      return true;
    } catch (error) {
      console.error('Error deleting task:', error);
      return false;
    }
  }

  /**
   * Get tasks by status
   * @param status The status to filter by
   * @returns Array of task entities
   */
  async getTasksByStatus(status: YellowPagesTaskStatus): Promise<YellowPagesTaskEntity[]> {
    return await this.repository.find({
      where: { status },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Get pending tasks
   * @returns Array of pending task entities
   */
  async getPendingTasks(): Promise<YellowPagesTaskEntity[]> {
    return await this.getTasksByStatus(YellowPagesTaskStatus.Pending);
  }

  /**
   * Get in-progress tasks
   * @returns Array of in-progress task entities
   */
  async getInProgressTasks(): Promise<YellowPagesTaskEntity[]> {
    return await this.getTasksByStatus(YellowPagesTaskStatus.InProgress);
  }

  /**
   * Convert status to string
   * @param status The status enum
   * @returns Status string
   */
  taskStatusToString(status: YellowPagesTaskStatus): string {
    switch (status) {
      case YellowPagesTaskStatus.Pending:
        return 'Pending';
      case YellowPagesTaskStatus.InProgress:
        return 'In Progress';
      case YellowPagesTaskStatus.Completed:
        return 'Completed';
      case YellowPagesTaskStatus.Failed:
        return 'Failed';
      case YellowPagesTaskStatus.Paused:
        return 'Paused';
      default:
        return 'Unknown';
    }
  }
} 