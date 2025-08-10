import { TaskModel } from '@/model/Task.model'
import { TaskCreateRequest, TaskUpdateRequest, TaskListResponse, TaskDetailResponse, TaskEntity as TaskEntityType } from '@/entityTypes/task-type'
import { TaskEntity } from '@/entity/Task.entity'

export class TaskController {
  private taskModel: TaskModel

  constructor() {
    this.taskModel = new TaskModel()
  }

  private convertToTaskEntityType(task: TaskEntity): TaskEntityType {
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      platform: task.platform,
      status: task.status as 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
      keywords: task.keywords,
      location: task.location,
      numPages: task.numPages,
      concurrency: task.concurrency,
      showBrowser: task.showBrowser,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
      results_count: task.results_count,
      error_message: task.error_message
    }
  }

  async createTask(taskData: TaskCreateRequest): Promise<number> {
    return await this.taskModel.createTask(taskData)
  }

  async updateTask(taskData: TaskUpdateRequest): Promise<boolean> {
    await this.taskModel.updateTask(taskData)
    return true
  }

  async deleteTask(taskId: number): Promise<boolean> {
    await this.taskModel.deleteTask(taskId)
    return true
  }

  async getTaskList(page: number, size: number, search?: string): Promise<TaskListResponse> {
    const result = await this.taskModel.getTaskList(page, size, search)
    return {
      tasks: result.tasks.map(task => this.convertToTaskEntityType(task)),
      total: result.total,
      page: result.page,
      size: result.size
    }
  }

  async getTaskDetail(taskId: number): Promise<TaskDetailResponse> {
    const task = await this.taskModel.getTaskById(taskId)
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`)
    }
    return { task: this.convertToTaskEntityType(task) }
  }

  async runTask(taskId: number): Promise<boolean> {
    await this.taskModel.updateTaskStatus(taskId, 'running')
    return true
  }

  async cancelTask(taskId: number): Promise<boolean> {
    await this.taskModel.updateTaskStatus(taskId, 'cancelled')
    return true
  }

  async getTaskResults(taskId: number, page: number, size: number): Promise<{
    results: any[]
    total: number
    page: number
    size: number
  }> {
    return await this.taskModel.getTaskResults(taskId, page, size)
  }
} 