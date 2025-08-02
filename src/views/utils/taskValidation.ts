import { EmailSearchTaskDetail } from '@/entityTypes/emailextraction-type'

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface TaskValidationContext {
  taskId: number
  currentStatus: string
  userPermissions?: string[]
  isEditMode: boolean
}

// Task status validation
export const validateTaskStatus = (status: string, action: 'edit' | 'delete'): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  const allowedStatuses = ['pending', 'error']
  const disallowedStatuses = ['running', 'completed', 'cancelled']

  if (action === 'edit' || action === 'delete') {
    if (!allowedStatuses.includes(status.toLowerCase())) {
      errors.push(`Cannot ${action} task with status: ${status}`)
    }

    if (disallowedStatuses.includes(status.toLowerCase())) {
      errors.push(`Task with status '${status}' cannot be modified`)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// Task data validation
export const validateTaskData = (task: EmailSearchTaskDetail): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  // Required fields validation
  if (!task.id) {
    errors.push('Task ID is required')
  }

  if (task.concurrency && (task.concurrency < 1 || task.concurrency > 100)) {
    errors.push('Concurrency must be between 1 and 100')
  }

  if (task.pagelength && (task.pagelength < 1 || task.pagelength > 1000)) {
    errors.push('Page length must be between 1 and 1000')
  }

  if (task.processTimeout && (task.processTimeout < 1 || task.processTimeout > 60)) {
    errors.push('Process timeout must be between 1 and 60 seconds')
  }

  if (task.maxPageNumber && (task.maxPageNumber < 0 || task.maxPageNumber > 10000)) {
    errors.push('Max page number must be between 0 and 10000')
  }

  // URL validation
  if (task.urls && task.urls.length > 0) {
    const invalidUrls = task.urls.filter(url => {
      try {
        new URL(url)
        return false
      } catch {
        return true
      }
    })

    if (invalidUrls.length > 0) {
      errors.push(`Invalid URLs found: ${invalidUrls.join(', ')}`)
    }

    if (task.urls.length > 1000) {
      warnings.push('Large number of URLs may impact performance')
    }
  }

  // Proxy validation
  if (task.proxies && task.proxies.length > 0) {
    const invalidProxies = task.proxies.filter(proxy => !proxy.host || !proxy.port)
    if (invalidProxies.length > 0) {
      errors.push('Some proxies have invalid host or port configuration')
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// Form data validation
export const validateFormData = (formData: any): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  // Extraction type validation
  if (!formData.extratype) {
    errors.push('Extraction type is required')
  } else if (!['ManualInputUrl', 'SearchResult'].includes(formData.extratype)) {
    errors.push('Invalid extraction type')
  }

  // URL validation for manual input
  if (formData.extratype === 'ManualInputUrl') {
    if (!formData.urls || formData.urls.length === 0) {
      errors.push('URLs are required for manual input mode')
    } else {
      const invalidUrls = formData.urls.filter((url: string) => {
        try {
          new URL(url)
          return false
        } catch {
          return true
        }
      })

      if (invalidUrls.length > 0) {
        errors.push(`Invalid URLs: ${invalidUrls.join(', ')}`)
      }
    }
  }

  // Search task validation for search result mode
  if (formData.extratype === 'SearchResult') {
    if (!formData.searchTaskId || formData.searchTaskId === 0) {
      errors.push('Search task ID is required for search result mode')
    }
  }

  // Numeric field validation
  if (formData.concurrency && (formData.concurrency < 1 || formData.concurrency > 100)) {
    errors.push('Concurrency must be between 1 and 100')
  }

  if (formData.pagelength && (formData.pagelength < 1 || formData.pagelength > 1000)) {
    errors.push('Page length must be between 1 and 1000')
  }

  if (formData.processTimeout && (formData.processTimeout < 1 || formData.processTimeout > 60)) {
    errors.push('Process timeout must be between 1 and 60 seconds')
  }

  if (formData.maxPageNumber && (formData.maxPageNumber < 0 || formData.maxPageNumber > 10000)) {
    errors.push('Max page number must be between 0 and 10000')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// Permission validation
export const validatePermissions = (context: TaskValidationContext): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  // Basic permission checks
  if (!context.userPermissions || context.userPermissions.length === 0) {
    warnings.push('No user permissions defined')
  }

  // Task ownership validation (if needed)
  if (context.isEditMode) {
    // Add ownership validation logic here if needed
    // For now, we assume all users can edit their own tasks
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// Comprehensive validation
export const validateTaskOperation = (
  task: EmailSearchTaskDetail,
  action: 'edit' | 'delete',
  context: TaskValidationContext
): ValidationResult => {
  const results: ValidationResult[] = []

  // Status validation
  results.push(validateTaskStatus(task.statusName, action))

  // Data validation
  results.push(validateTaskData(task))

  // Permission validation
  results.push(validatePermissions(context))

  // Combine all results
  const allErrors = results.flatMap(r => r.errors)
  const allWarnings = results.flatMap(r => r.warnings)

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  }
}

// Concurrent access validation
export const validateConcurrentAccess = (taskId: number, lastModified: Date): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  const timeSinceLastModified = Date.now() - lastModified.getTime()
  const fiveMinutes = 5 * 60 * 1000

  if (timeSinceLastModified < fiveMinutes) {
    warnings.push('Task was recently modified. Consider refreshing before editing.')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// Data integrity validation
export const validateDataIntegrity = (task: EmailSearchTaskDetail): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for required fields
  if (!task.id) {
    errors.push('Task ID is missing')
  }

  if (task.type_id === undefined || task.type_id === null) {
    errors.push('Task type is missing')
  }

  if (task.concurrency === undefined || task.concurrency === null) {
    errors.push('Concurrency setting is missing')
  }

  // Check for logical inconsistencies
  if (task.urls && task.urls.length > 0 && task.type_id === 1) {
    warnings.push('URLs should not be present for search result type tasks')
  }

  if (task.searchResultId && task.searchResultId > 0 && task.type_id === 0) {
    warnings.push('Search result ID should not be present for manual input type tasks')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}