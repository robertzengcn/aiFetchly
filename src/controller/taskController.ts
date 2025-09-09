import { TaskModel } from '@/model/Task.model'
import { TaskCreateRequest, TaskUpdateRequest, TaskListResponse, TaskDetailResponse, TaskEntity as TaskEntityType } from '@/entityTypes/task-type'
import { TaskEntity } from '@/entity/Task.entity'
import { 
    MCPRequest, 
    MCPResponse, 
    MCPTaskCreateRequest,
    MCPTaskUpdateRequest,
    MCPTask,
    MCPTaskListData,
    MCPPaginationParams,
    createMCPSuccessResponse,
    createMCPErrorResponse,
    createMCPError,
    MCPErrorCode
} from '@/mcp-server/types/mcpTypes';

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

  /**
   * Handle MCP requests for task management functionality
   * This method acts as an adapter between MCP requests and the existing task management business logic
   */
  public async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      const { tool, parameters } = request;

      switch (tool) {
        case 'create_task':
          return await this.handleCreateTaskRequest(parameters as MCPTaskCreateRequest);
        
        case 'list_tasks':
          return await this.handleListTasksRequest(parameters as MCPPaginationParams);
        
        case 'get_task':
          return await this.handleGetTaskRequest(parameters.taskId as number);
        
        case 'update_task':
          return await this.handleUpdateTaskRequest(parameters as MCPTaskUpdateRequest);
        
        case 'delete_task':
          return await this.handleDeleteTaskRequest(parameters.taskId as number);
        
        case 'run_task':
          return await this.handleRunTaskRequest(parameters.taskId as number);
        
        case 'cancel_task':
          return await this.handleCancelTaskRequest(parameters.taskId as number);
        
        case 'get_task_results':
          return await this.handleGetTaskResultsRequest(parameters as { taskId: number } & MCPPaginationParams);
        
        default:
          return createMCPErrorResponse(
            createMCPError(MCPErrorCode.INVALID_PARAMETERS, `Unknown task management tool: ${tool}`),
            'Invalid task management tool requested'
          );
      }
    } catch (error) {
      console.error('Error in TaskController.handleMCPRequest:', error);
      return createMCPErrorResponse(
        createMCPError(
          MCPErrorCode.INTERNAL_ERROR,
          'Internal error occurred while processing task management request',
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error.stack : undefined
        ),
        'Failed to process task management request'
      );
    }
  }

  /**
   * Handle create task requests
   */
  private async handleCreateTaskRequest(params: MCPTaskCreateRequest): Promise<MCPResponse<MCPTask>> {
    try {
      // Convert MCP task parameters to internal format
      const taskData: TaskCreateRequest = {
        name: params.name,
        description: params.description,
        platform: params.parameters.platform as string || 'unknown',
        keywords: params.parameters.keywords as string[] || [],
        location: params.parameters.location as string,
        numPages: params.parameters.numPages as number || 1,
        concurrency: params.parameters.concurrency as number || 1,
        showBrowser: params.parameters.showBrowser as boolean || false
      };

      const taskId = await this.createTask(taskData);

      // Convert to MCP task format
      const mcpTask: MCPTask = {
        id: taskId.toString(),
        name: params.name,
        description: params.description,
        type: params.type,
        status: 'pending',
        parameters: params.parameters,
        priority: params.priority || 'medium',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return createMCPSuccessResponse(mcpTask, 'Task created successfully');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle list tasks requests
   */
  private async handleListTasksRequest(params: MCPPaginationParams): Promise<MCPResponse<MCPTaskListData>> {
    try {
      const page = params.page || 1;
      const size = params.size || 20;
      const search = (params as any).search as string;

      const result = await this.getTaskList(page, size, search);

      // Convert to MCP format
      const mcpTasks: MCPTask[] = result.tasks.map(task => ({
        id: task.id.toString(),
        name: task.name,
        description: task.description || '',
        type: 'general',
        status: task.status,
        parameters: {
          platform: task.platform,
          keywords: task.keywords,
          location: task.location,
          numPages: task.numPages,
          concurrency: task.concurrency,
          showBrowser: task.showBrowser
        },
        priority: 'medium',
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at,
        resultsCount: task.results_count,
        errorMessage: task.error_message
      }));

      const taskListData: MCPTaskListData = {
        tasks: mcpTasks,
        pagination: {
          items: mcpTasks,
          total: result.total,
          page: result.page,
          size: result.size,
          totalPages: Math.ceil(result.total / result.size)
        }
      };

      return createMCPSuccessResponse(taskListData, 'Tasks retrieved successfully');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle get task requests
   */
  private async handleGetTaskRequest(taskId: number): Promise<MCPResponse<MCPTask>> {
    try {
      const result = await this.getTaskDetail(taskId);
      const task = result.task;
      
      const mcpTask: MCPTask = {
        id: task.id.toString(),
        name: task.name,
        description: task.description || '',
        type: 'general',
        status: task.status,
        parameters: {
          platform: task.platform,
          keywords: task.keywords,
          location: task.location,
          numPages: task.numPages,
          concurrency: task.concurrency,
          showBrowser: task.showBrowser
        },
        priority: 'medium',
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at,
        resultsCount: task.results_count,
        errorMessage: task.error_message
      };

      return createMCPSuccessResponse(mcpTask, 'Task retrieved successfully');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle update task requests
   */
  private async handleUpdateTaskRequest(params: MCPTaskUpdateRequest): Promise<MCPResponse<MCPTask>> {
    try {
      const taskId = parseInt(params.taskId);
      
      // Convert MCP update parameters to internal format
      const taskData: TaskUpdateRequest = {
        id: taskId,
        name: params.name,
        description: params.description,
        platform: params.parameters?.platform as string,
        keywords: params.parameters?.keywords as string[],
        location: params.parameters?.location as string,
        numPages: params.parameters?.numPages as number,
        concurrency: params.parameters?.concurrency as number,
        showBrowser: params.parameters?.showBrowser as boolean
      };

      await this.updateTask(taskData);

      // Get updated task details
      const result = await this.getTaskDetail(taskId);
      const task = result.task;
      
      const mcpTask: MCPTask = {
        id: taskId.toString(),
        name: params.name || task.name,
        description: params.description || task.description || '',
        type: 'general',
        status: task.status,
        parameters: {
          platform: task.platform,
          keywords: task.keywords,
          location: task.location,
          numPages: task.numPages,
          concurrency: task.concurrency,
          showBrowser: task.showBrowser
        },
        priority: 'medium',
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at,
        resultsCount: task.results_count,
        errorMessage: task.error_message
      };

      return createMCPSuccessResponse(mcpTask, 'Task updated successfully');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle delete task requests
   */
  private async handleDeleteTaskRequest(taskId: number): Promise<MCPResponse> {
    try {
      await this.deleteTask(taskId);
      return createMCPSuccessResponse(null, 'Task deleted successfully');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle run task requests
   */
  private async handleRunTaskRequest(taskId: number): Promise<MCPResponse> {
    try {
      await this.runTask(taskId);
      return createMCPSuccessResponse(null, 'Task started successfully');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle cancel task requests
   */
  private async handleCancelTaskRequest(taskId: number): Promise<MCPResponse> {
    try {
      await this.cancelTask(taskId);
      return createMCPSuccessResponse(null, 'Task cancelled successfully');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle get task results requests
   */
  private async handleGetTaskResultsRequest(params: { taskId: number } & MCPPaginationParams): Promise<MCPResponse<any>> {
    try {
      const page = params.page || 1;
      const size = params.size || 20;
      
      const results = await this.getTaskResults(params.taskId, page, size);
      return createMCPSuccessResponse(results, 'Task results retrieved successfully');
    } catch (error) {
      throw error;
    }
  }
} 