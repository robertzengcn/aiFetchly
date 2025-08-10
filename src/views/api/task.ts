import { windowInvoke } from '@/views/utils/apirequest'
import { 
  TaskCreateRequest, 
  TaskUpdateRequest, 
  TaskListResponse, 
  TaskDetailResponse,
  PlatformListResponse
} from '@/entityTypes/task-type'

// Task Management
export async function createTask(taskData: TaskCreateRequest): Promise<number> {
  const response = await windowInvoke('task:create', taskData)
  return response
}

export async function updateTask(taskData: TaskUpdateRequest): Promise<boolean> {
  const response = await windowInvoke('task:update', taskData)
  return response
}

export async function deleteTask(taskId: number): Promise<boolean> {
  const response = await windowInvoke('task:delete', { id: taskId })
  return response
}

export async function getTaskList(
  page: number = 1, 
  size: number = 10, 
  search?: string
): Promise<TaskListResponse> {
  const params: { page: number; size: number; search?: string } = { page, size }
  if (search) {
    params.search = search
  }
  const response = await windowInvoke('task:list', params)
  return response
}

export async function getTaskDetail(taskId: number): Promise<TaskDetailResponse> {
  const response = await windowInvoke('task:detail', { id: taskId })
  return response
}

export async function runTask(taskId: number): Promise<boolean> {
  const response = await windowInvoke('task:run', { id: taskId })
  return response
}

export async function cancelTask(taskId: number): Promise<boolean> {
  const response = await windowInvoke('task:cancel', { id: taskId })
  return response
}

// Platform Management
export async function getPlatformList(): Promise<PlatformListResponse> {
  const response = await windowInvoke('platform:list', {})
  return response
}
