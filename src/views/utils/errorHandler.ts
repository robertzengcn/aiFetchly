import { ref } from 'vue'

export interface ErrorInfo {
  id: string
  message: string
  details?: string
  type: 'error' | 'warning' | 'info'
  timestamp: Date
  recoverable: boolean
  action?: string
  retryCount?: number
  userFriendlyMessage?: string
  recoveryOptions?: RecoveryOption[]
  isOffline?: boolean
}

export interface RecoveryOption {
  id: string
  label: string
  action: () => Promise<void>
  icon?: string
  color?: string
}

export interface ErrorConfig {
  showToast?: boolean
  showDialog?: boolean
  logToConsole?: boolean
  retryable?: boolean
  maxRetries?: number
  autoDismiss?: boolean
  dismissDelay?: number
  userFriendly?: boolean
  recoveryOptions?: RecoveryOption[]
  offlineHandling?: boolean
}

export class ErrorHandler {
  private errors = ref<ErrorInfo[]>([])
  private globalError = ref<ErrorInfo | null>(null)
  private retryCallbacks = new Map<string, () => Promise<any>>()
  private isOnline = ref(true)
  private offlineQueue = ref<Array<() => Promise<void>>>([])

  constructor() {
    this.initializeOfflineDetection()
  }

  // Initialize offline detection
  private initializeOfflineDetection = () => {
    window.addEventListener('online', () => {
      this.isOnline.value = true
      this.processOfflineQueue()
    })

    window.addEventListener('offline', () => {
      this.isOnline.value = false
    })
  }

  // Process offline queue when back online
  private processOfflineQueue = async () => {
    while (this.offlineQueue.value.length > 0) {
      const operation = this.offlineQueue.value.shift()
      if (operation) {
        try {
          await operation()
        } catch (error) {
          console.error('Failed to process offline operation:', error)
        }
      }
    }
  }

  // Add operation to offline queue
  addToOfflineQueue = (operation: () => Promise<void>) => {
    this.offlineQueue.value.push(operation)
  }

  // Check if online
  isOnlineStatus = () => this.isOnline.value

  // Add an error with enhanced features
  addError = (error: Omit<ErrorInfo, 'id' | 'timestamp'>, config: ErrorConfig = {}) => {
    const errorInfo: ErrorInfo = {
      ...error,
      id: this.generateId(),
      timestamp: new Date(),
      isOffline: !this.isOnline.value,
      userFriendlyMessage: config.userFriendly !== false ? this.getUserFriendlyMessage(error.message) : error.message,
      recoveryOptions: config.recoveryOptions || this.getDefaultRecoveryOptions(error, config)
    }

    this.errors.value.push(errorInfo)

    // Handle global error
    if (config.showDialog) {
      this.globalError.value = errorInfo
    }

    // Log to console if enabled
    if (config.logToConsole !== false) {
      console.error('Error:', errorInfo)
    }

    // Auto dismiss if enabled
    if (config.autoDismiss && config.dismissDelay) {
      setTimeout(() => {
        this.removeError(errorInfo.id)
      }, config.dismissDelay)
    }

    return errorInfo.id
  }

  // Get user-friendly error message
  private getUserFriendlyMessage = (technicalMessage: string): string => {
    const messageMap: Record<string, string> = {
      'Network Error': 'Network connection failed. Please check your internet connection and try again.',
      'timeout': 'Request timed out. Please try again.',
      '404': 'The requested resource was not found.',
      '403': 'You do not have permission to access this resource.',
      '500': 'Server error occurred. Please try again later.',
      'VALIDATION_ERROR': 'Please check your input and try again.',
      'TASK_NOT_FOUND': 'The task you are looking for could not be found.',
      'TASK_ACCESS_DENIED': 'You do not have permission to access this task.',
      'TASK_ALREADY_RUNNING': 'This task is already running. Please wait for it to complete.',
      'TASK_CANNOT_EDIT': 'This task cannot be edited in its current state.',
      'FORM_INVALID': 'Please correct the errors in the form before submitting.',
      'SAVE_FAILED': 'Failed to save changes. Please try again.',
      'LOAD_FAILED': 'Failed to load data. Please refresh the page.',
      'UNKNOWN_ERROR': 'An unexpected error occurred. Please try again.',
      'PERMISSION_DENIED': 'You do not have permission to perform this action.',
      'RESOURCE_NOT_FOUND': 'The requested resource was not found.'
    }

    // Try to match technical message with user-friendly message
    for (const [key, friendlyMessage] of Object.entries(messageMap)) {
      if (technicalMessage.toLowerCase().includes(key.toLowerCase())) {
        return friendlyMessage
      }
    }

    // Default user-friendly message
    return 'Something went wrong. Please try again.'
  }

  // Get default recovery options
  private getDefaultRecoveryOptions = (error: Omit<ErrorInfo, 'id' | 'timestamp'>, config: ErrorConfig): RecoveryOption[] => {
    const options: RecoveryOption[] = []

    // Retry option for retryable errors
    if (config.retryable && error.recoverable) {
      options.push({
        id: 'retry',
        label: 'Try Again',
        action: async () => {
          // Find the error by matching other properties since we don't have the ID here
          const matchingError = this.errors.value.find(e => 
            e.message === error.message && 
            e.type === error.type &&
            e.recoverable === error.recoverable
          )
          if (matchingError) {
            const callback = this.retryCallbacks.get(matchingError.id)
            if (callback) {
              await callback()
            }
          }
        },
        icon: 'mdi-refresh',
        color: 'primary'
      })
    }

    // Refresh page option for load failures
    if (error.message.includes('LOAD_FAILED') || error.message.includes('404')) {
      options.push({
        id: 'refresh',
        label: 'Refresh Page',
        action: async () => {
          window.location.reload()
        },
        icon: 'mdi-refresh',
        color: 'info'
      })
    }

    // Go back option for navigation errors
    if (error.message.includes('NOT_FOUND') || error.message.includes('ACCESS_DENIED')) {
      options.push({
        id: 'go-back',
        label: 'Go Back',
        action: async () => {
          window.history.back()
        },
        icon: 'mdi-arrow-left',
        color: 'secondary'
      })
    }

    // Retry when online option for offline errors
    if (!this.isOnline.value) {
      options.push({
        id: 'retry-online',
        label: 'Retry When Online',
        action: async () => {
          this.addToOfflineQueue(async () => {
            // Find the error by matching other properties since we don't have the ID here
            const matchingError = this.errors.value.find(e => 
              e.message === error.message && 
              e.type === error.type &&
              e.recoverable === error.recoverable
            )
            if (matchingError) {
              const callback = this.retryCallbacks.get(matchingError.id)
              if (callback) {
                await callback()
              }
            }
          })
        },
        icon: 'mdi-wifi-off',
        color: 'warning'
      })
    }

    return options
  }

  // Remove an error
  removeError = (id: string) => {
    this.errors.value = this.errors.value.filter(error => error.id !== id)
    
    if (this.globalError.value?.id === id) {
      this.globalError.value = null
    }
  }

  // Clear all errors
  clearErrors = () => {
    this.errors.value = []
    this.globalError.value = null
  }

  // Get errors by type
  getErrorsByType = (type: ErrorInfo['type']) => {
    return this.errors.value.filter(error => error.type === type)
  }

  // Get active errors
  getActiveErrors = () => {
    return this.errors.value
  }

  // Retry an operation with enhanced error handling
  retryOperation = async (id: string) => {
    const callback = this.retryCallbacks.get(id)
    if (!callback) {
      throw new Error('No retry callback found for this error')
    }

    try {
      await callback()
      this.removeError(id)
      this.retryCallbacks.delete(id)
    } catch (error) {
      // Increment retry count
      const errorInfo = this.errors.value.find(e => e.id === id)
      if (errorInfo) {
        errorInfo.retryCount = (errorInfo.retryCount || 0) + 1
        
        // If max retries reached, show different message
        if (errorInfo.retryCount >= 3) {
          errorInfo.userFriendlyMessage = 'Multiple attempts failed. Please try again later or contact support.'
        }
      }
    }
  }

  // Register retry callback
  registerRetryCallback = (id: string, callback: () => Promise<any>) => {
    this.retryCallbacks.set(id, callback)
  }

  // Execute recovery option
  executeRecoveryOption = async (errorId: string, optionId: string) => {
    const error = this.errors.value.find(e => e.id === errorId)
    if (!error || !error.recoveryOptions) {
      throw new Error('Error or recovery option not found')
    }

    const option = error.recoveryOptions.find(o => o.id === optionId)
    if (!option) {
      throw new Error('Recovery option not found')
    }

    try {
      await option.action()
      this.removeError(errorId)
    } catch (error) {
      console.error('Recovery option failed:', error)
      throw error
    }
  }

  // Generate unique ID
  private generateId = () => {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Get global error
  getGlobalError = () => this.globalError.value

  // Clear global error
  clearGlobalError = () => {
    this.globalError.value = null
  }

  // Get offline status
  getOfflineStatus = () => this.isOnline.value
}

// User-friendly error messages
export const errorMessages = {
  // Network errors
  NETWORK_ERROR: 'Network connection failed. Please check your internet connection.',
  TIMEOUT_ERROR: 'Request timed out. Please try again.',
  SERVER_ERROR: 'Server error occurred. Please try again later.',
  OFFLINE_ERROR: 'You are currently offline. Please check your connection.',
  
  // Validation errors
  VALIDATION_ERROR: 'Please check your input and try again.',
  REQUIRED_FIELD: 'This field is required.',
  INVALID_FORMAT: 'Invalid format. Please check your input.',
  
  // Task errors
  TASK_NOT_FOUND: 'Task not found.',
  TASK_ACCESS_DENIED: 'You do not have permission to access this task.',
  TASK_ALREADY_RUNNING: 'This task is already running.',
  TASK_CANNOT_EDIT: 'This task cannot be edited in its current state.',
  
  // Form errors
  FORM_INVALID: 'Please correct the errors in the form.',
  SAVE_FAILED: 'Failed to save changes. Please try again.',
  LOAD_FAILED: 'Failed to load data. Please refresh the page.',
  
  // General errors
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  RESOURCE_NOT_FOUND: 'The requested resource was not found.'
}

// Error recovery strategies
export const errorRecovery = {
  // Retry with exponential backoff
  retryWithBackoff: async <T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> => {
    let lastError: Error
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error as Error
        
        if (attempt === maxRetries) {
          throw lastError
        }
        
        // Wait with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    
    throw lastError!
  },

  // Retry with user confirmation
  retryWithConfirmation: async <T>(
    operation: () => Promise<T>,
    errorHandler: ErrorHandler,
    errorId: string
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      errorHandler.registerRetryCallback(errorId, async () => {
        try {
          const result = await operation()
          resolve(result)
          return result
        } catch (error) {
          reject(error)
          throw error
        }
      })
    })
  },

  // Retry when online
  retryWhenOnline: async <T>(
    operation: () => Promise<T>,
    errorHandler: ErrorHandler
  ): Promise<T> => {
    if (!errorHandler.getOfflineStatus()) {
      // Add to offline queue
      return new Promise((resolve, reject) => {
        errorHandler.addToOfflineQueue(async () => {
          try {
            const result = await operation()
            resolve(result)
          } catch (error) {
            reject(error)
          }
        })
      })
    } else {
      return await operation()
    }
  }
}

// Error notification utilities
export const errorNotifications = {
  // Show toast notification
  showToast: (message: string, type: 'error' | 'warning' | 'info' = 'error') => {
    // Implementation depends on your toast library
    console.log(`${type.toUpperCase()}: ${message}`)
  },

  // Show error dialog
  showErrorDialog: (error: ErrorInfo) => {
    // Implementation depends on your dialog library
    console.log('Error Dialog:', error)
  },

  // Show confirmation dialog
  showConfirmationDialog: (message: string): Promise<boolean> => {
    // Implementation depends on your dialog library
    return new Promise((resolve) => {
      const confirmed = confirm(message)
      resolve(confirmed)
    })
  }
}

// Global error handler instance
export const errorHandler = new ErrorHandler()

// Error boundary utilities
export const errorBoundary = {
  // Wrap async operations with error handling
  wrapAsync: async <T>(
    operation: () => Promise<T>,
    errorConfig: ErrorConfig = {}
  ): Promise<T | null> => {
    try {
      return await operation()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      errorHandler.addError({
        message: errorMessage,
        type: 'error',
        recoverable: errorConfig.retryable || false,
        details: error instanceof Error ? error.stack : undefined
      }, errorConfig)
      
      return null
    }
  },

  // Wrap synchronous operations with error handling
  wrapSync: <T>(
    operation: () => T,
    errorConfig: ErrorConfig = {}
  ): T | null => {
    try {
      return operation()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      errorHandler.addError({
        message: errorMessage,
        type: 'error',
        recoverable: errorConfig.retryable || false,
        details: error instanceof Error ? error.stack : undefined
      }, errorConfig)
      
      return null
    }
  }
}

// Error reporting utilities
export const errorReporting = {
  // Report error to external service
  reportError: (error: Error, context?: any) => {
    // Implementation for error reporting service
    console.error('Error Report:', {
      error: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent
    })
  },

  // Collect error context
  collectContext: () => {
    return {
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      memory: (performance as any).memory,
      networkType: (navigator as any).connection?.effectiveType
    }
  }
}