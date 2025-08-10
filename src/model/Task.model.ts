import { Repository } from 'typeorm'
import { BaseDb } from './Basedb'
import { TaskEntity } from '@/entity/Task.entity'
import { TaskCreateRequest, TaskUpdateRequest } from '@/entityTypes/task-type'

export class TaskModel extends BaseDb {
  private repository: Repository<TaskEntity>

  constructor() {
    super('tasks.db')
    this.repository = this.sqliteDb.connection.getRepository(TaskEntity)
  }

  /**
   * Create a new task
   * @param taskData The task creation data
   * @returns The ID of the created task
   */
  async createTask(taskData: TaskCreateRequest): Promise<number> {
    const taskEntity = new TaskEntity()
    taskEntity.name = taskData.name
    taskEntity.description = taskData.description || ''
    taskEntity.platform = taskData.platform
    taskEntity.keywords = taskData.keywords
    taskEntity.location = taskData.location || ''
    taskEntity.numPages = taskData.numPages
    taskEntity.concurrency = taskData.concurrency
    taskEntity.showBrowser = taskData.showBrowser
    taskEntity.status = 'pending'
    taskEntity.created_at = new Date().toISOString()
    taskEntity.updated_at = new Date().toISOString()

    const savedTask = await this.repository.save(taskEntity)
    return savedTask.id
  }

  /**
   * Update an existing task
   * @param taskData The task update data
   */
  async updateTask(taskData: TaskUpdateRequest): Promise<void> {
    const task = await this.repository.findOne({ where: { id: taskData.id } })
    if (!task) {
      throw new Error(`Task with ID ${taskData.id} not found`)
    }

    if (taskData.name !== undefined) task.name = taskData.name
    if (taskData.description !== undefined) task.description = taskData.description
    if (taskData.platform !== undefined) task.platform = taskData.platform
    if (taskData.keywords !== undefined) task.keywords = taskData.keywords
    if (taskData.location !== undefined) task.location = taskData.location
    if (taskData.numPages !== undefined) task.numPages = taskData.numPages
    if (taskData.concurrency !== undefined) task.concurrency = taskData.concurrency
    if (taskData.showBrowser !== undefined) task.showBrowser = taskData.showBrowser

    task.updated_at = new Date().toISOString()

    await this.repository.save(task)
  }

  /**
   * Delete a task
   * @param taskId The ID of the task to delete
   */
  async deleteTask(taskId: number): Promise<void> {
    const task = await this.repository.findOne({ where: { id: taskId } })
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`)
    }

    await this.repository.remove(task)
  }

  /**
   * Get a list of tasks with pagination
   * @param page Page number
   * @param size Page size
   * @param search Search query
   * @returns Task list response
   */
  async getTaskList(page: number, size: number, search?: string): Promise<{
    tasks: TaskEntity[]
    total: number
    page: number
    size: number
  }> {
    const queryBuilder = this.repository.createQueryBuilder('task')

    if (search) {
      queryBuilder.where(
        'task.name LIKE :search OR task.description LIKE :search OR task.platform LIKE :search',
        { search: `%${search}%` }
      )
    }

    const [tasks, total] = await queryBuilder
      .skip((page - 1) * size)
      .take(size)
      .orderBy('task.created_at', 'DESC')
      .getManyAndCount()

    return {
      tasks,
      total,
      page,
      size
    }
  }

  /**
   * Get task by ID
   * @param taskId The ID of the task
   * @returns Task entity or null
   */
  async getTaskById(taskId: number): Promise<TaskEntity | null> {
    return await this.repository.findOne({ where: { id: taskId } })
  }

  /**
   * Update task status
   * @param taskId The ID of the task
   * @param status The new status
   */
  async updateTaskStatus(taskId: number, status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'): Promise<void> {
    const task = await this.repository.findOne({ where: { id: taskId } })
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`)
    }

    task.status = status
    task.updated_at = new Date().toISOString()

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      task.completed_at = new Date().toISOString()
    }

    await this.repository.save(task)
  }

  /**
   * Get task results
   * @param taskId The ID of the task
   * @param page Page number
   * @param size Page size
   * @returns Task results
   */
  async getTaskResults(taskId: number, page: number, size: number): Promise<{
    results: any[]
    total: number
    page: number
    size: number
  }> {
    // TODO: Implement results retrieval from results table
    // For now, return mock data
    const mockResults = [
      {
        id: 1,
        task_id: taskId,
        title: 'Sample Result 1',
        url: 'https://example.com/1',
        source: 'Google',
        status: 'success',
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        task_id: taskId,
        title: 'Sample Result 2',
        url: 'https://example.com/2',
        source: 'Google',
        status: 'success',
        created_at: new Date().toISOString()
      }
    ]

    return {
      results: mockResults,
      total: mockResults.length,
      page,
      size
    }
  }
}
