export interface TaskEntity {
  id: number
  name: string
  description?: string
  platform: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  keywords: string[]
  location?: string
  numPages: number
  concurrency: number
  showBrowser: boolean
  created_at: string
  updated_at: string
  completed_at?: string
  results_count?: number
  error_message?: string
}

export interface TaskCreateRequest {
  name: string
  description?: string
  platform: string
  keywords: string[]
  location?: string
  numPages: number
  concurrency: number
  showBrowser: boolean
}

export interface TaskUpdateRequest {
  id: number
  name?: string
  description?: string
  platform?: string
  keywords?: string[]
  location?: string
  numPages?: number
  concurrency?: number
  showBrowser?: boolean
}

export interface TaskListResponse {
  tasks: TaskEntity[]
  total: number
  page: number
  size: number
}

export interface TaskDetailResponse {
  task: TaskEntity
}

export interface PlatformEntity {
  id: string
  name: string
  description?: string
  is_active: boolean
  config_schema?: any
}

export interface PlatformListResponse {
  platforms: PlatformEntity[]
  total: number
}
