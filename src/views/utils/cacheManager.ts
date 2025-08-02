import { ref } from 'vue'
import { EmailSearchTaskDetail } from '@/entityTypes/emailextraction-type'

interface CacheItem<T> {
  data: T
  timestamp: number
  ttl: number // Time to live in milliseconds
}

class CacheManager {
  private cache = new Map<string, CacheItem<any>>()
  private defaultTTL = 5 * 60 * 1000 // 5 minutes

  // Set cache item
  set<T>(key: string, data: T, ttl?: number): void {
    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    }
    this.cache.set(key, item)
  }

  // Get cache item
  get<T>(key: string): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    // Check if item has expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      return null
    }

    return item.data
  }

  // Check if key exists and is valid
  has(key: string): boolean {
    return this.get(key) !== null
  }

  // Delete cache item
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  // Clear all cache
  clear(): void {
    this.cache.clear()
  }

  // Get cache size
  size(): number {
    return this.cache.size
  }

  // Get all cache keys
  getKeys(): string[] {
    return Array.from(this.cache.keys())
  }

  // Clean expired items
  cleanup(): void {
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key)
      }
    }
  }
}

// Task-specific cache keys
export const CACHE_KEYS = {
  TASK_DETAIL: (id: number) => `task_detail_${id}`,
  TASK_LIST: 'task_list',
  FORM_DATA: (id: number) => `form_data_${id}`,
  SEARCH_RESULTS: 'search_results'
} as const

// Global cache instance
const cacheManager = new CacheManager()

// Task cache utilities
export const taskCache = {
  // Cache task detail
  setTaskDetail: (taskId: number, task: EmailSearchTaskDetail) => {
    cacheManager.set(CACHE_KEYS.TASK_DETAIL(taskId), task, 10 * 60 * 1000) // 10 minutes
  },

  // Get cached task detail
  getTaskDetail: (taskId: number): EmailSearchTaskDetail | null => {
    return cacheManager.get(CACHE_KEYS.TASK_DETAIL(taskId))
  },

  // Invalidate task cache
  invalidateTask: (taskId: number) => {
    cacheManager.delete(CACHE_KEYS.TASK_DETAIL(taskId))
    cacheManager.delete(CACHE_KEYS.FORM_DATA(taskId))
  },

  // Cache form data
  setFormData: (taskId: number, formData: any) => {
    cacheManager.set(CACHE_KEYS.FORM_DATA(taskId), formData, 30 * 60 * 1000) // 30 minutes
  },

  // Get cached form data
  getFormData: (taskId: number): any => {
    return cacheManager.get(CACHE_KEYS.FORM_DATA(taskId))
  },

  // Clear all task-related cache
  clearTaskCache: (taskId: number) => {
    cacheManager.delete(CACHE_KEYS.TASK_DETAIL(taskId))
    cacheManager.delete(CACHE_KEYS.FORM_DATA(taskId))
  }
}

// Form cache utilities
export const formCache = {
  // Cache form state
  setFormState: (key: string, state: any) => {
    cacheManager.set(`form_state_${key}`, state, 60 * 60 * 1000) // 1 hour
  },

  // Get cached form state
  getFormState: (key: string): any => {
    return cacheManager.get(`form_state_${key}`)
  },

  // Clear form cache
  clearFormCache: (key: string) => {
    cacheManager.delete(`form_state_${key}`)
  }
}

// Optimistic updates
export const optimisticCache = {
  // Set optimistic update
  setOptimistic: (key: string, data: any) => {
    cacheManager.set(`optimistic_${key}`, data, 5 * 60 * 1000) // 5 minutes
  },

  // Get optimistic data
  getOptimistic: (key: string): any => {
    return cacheManager.get(`optimistic_${key}`)
  },

  // Clear optimistic data
  clearOptimistic: (key: string) => {
    cacheManager.delete(`optimistic_${key}`)
  }
}

// Cache invalidation utilities
export const cacheInvalidation = {
  // Invalidate all task-related cache
  invalidateAllTasks: () => {
    for (const key of cacheManager.getKeys()) {
      if (key.startsWith('task_detail_') || key.startsWith('form_data_')) {
        cacheManager.delete(key)
      }
    }
  },

  // Invalidate cache by pattern
  invalidateByPattern: (pattern: RegExp) => {
    for (const key of cacheManager.getKeys()) {
      if (pattern.test(key)) {
        cacheManager.delete(key)
      }
    }
  }
}

// Auto cleanup every 5 minutes
setInterval(() => {
  cacheManager.cleanup()
}, 5 * 60 * 1000)

export default cacheManager