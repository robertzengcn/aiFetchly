import { ref, computed } from 'vue'
import { EmailscFormdata, EmailSearchTaskDetail } from '@/entityTypes/emailextraction-type'
import { ProxyEntity } from '@/entityTypes/proxyType'

// Form data transformation utilities
export const transformTaskToFormData = (task: EmailSearchTaskDetail): EmailscFormdata => {
  return {
    extratype: task.type_id === 1 ? 'SearchResult' : 'ManualInputUrl',
    urls: task.urls || [],
    searchTaskId: task.searchResultId || 0,
    concurrency: task.concurrency || 1,
    pagelength: task.pagelength || 10,
    notShowBrowser: task.notShowBrowser || false,
    proxys: task.proxies || [],
    processTimeout: task.processTimeout || 10,
    maxPageNumber: task.maxPageNumber || 100
  }
}

export const transformFormDataToTask = (formData: EmailscFormdata): Partial<EmailSearchTaskDetail> => {
  return {
    type_id: formData.extratype === 'SearchResult' ? 1 : 0,
    urls: formData.urls || [],
    searchResultId: formData.searchTaskId || 0,
    concurrency: formData.concurrency || 1,
    pagelength: formData.pagelength || 10,
    notShowBrowser: formData.notShowBrowser || false,
    proxies: formData.proxys || [],
    processTimeout: formData.processTimeout || 10,
    maxPageNumber: formData.maxPageNumber || 100
  }
}

// Validation helper functions
export const validateUrls = (urls: string[]): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (!urls || urls.length === 0) {
    errors.push('URLs cannot be empty')
    return { isValid: false, errors }
  }
  
  const validUrls = urls.filter(url => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  })
  
  if (validUrls.length === 0) {
    errors.push('No valid URLs provided')
    return { isValid: false, errors }
  }
  
  if (validUrls.length !== urls.length) {
    errors.push('Some URLs are invalid')
  }
  
  return { isValid: validUrls.length > 0, errors }
}

export const validateProxies = (proxies: ProxyEntity[]): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (!proxies) {
    return { isValid: true, errors }
  }
  
  for (const proxy of proxies) {
    if (!proxy.host || !proxy.port) {
      errors.push('Proxy must have host and port')
    }
  }
  
  return { isValid: errors.length === 0, errors }
}

// Form state management utilities
export const useFormState = () => {
  const isDirty = ref(false)
  const originalData = ref<any>(null)
  
  const setOriginalData = (data: any) => {
    originalData.value = JSON.parse(JSON.stringify(data))
    isDirty.value = false
  }
  
  const checkDirty = (currentData: any) => {
    if (!originalData.value) return false
    return JSON.stringify(currentData) !== JSON.stringify(originalData.value)
  }
  
  const resetDirty = () => {
    isDirty.value = false
  }
  
  return {
    isDirty: computed(() => isDirty.value),
    setOriginalData,
    checkDirty,
    resetDirty
  }
}

// Form field validation rules
export const formRules = {
  required: (value: any) => !!value || 'Field is required',
  url: (value: string) => {
    if (!value) return true
    try {
      new URL(value)
      return true
    } catch {
      return 'Invalid URL format'
    }
  },
  number: (min: number, max: number) => (value: number) => {
    if (value < min || value > max) {
      return `Value must be between ${min} and ${max}`
    }
    return true
  },
  positive: (value: number) => value > 0 || 'Value must be positive'
}

// Form data sanitization
export const sanitizeFormData = (data: any): any => {
  const sanitized = { ...data }
  
  // Remove empty strings
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === '') {
      delete sanitized[key]
    }
  })
  
  // Convert string numbers to actual numbers
  if (sanitized.concurrency) {
    sanitized.concurrency = parseInt(sanitized.concurrency)
  }
  if (sanitized.pagelength) {
    sanitized.pagelength = parseInt(sanitized.pagelength)
  }
  if (sanitized.processTimeout) {
    sanitized.processTimeout = parseInt(sanitized.processTimeout)
  }
  if (sanitized.maxPageNumber) {
    sanitized.maxPageNumber = parseInt(sanitized.maxPageNumber)
  }
  
  return sanitized
}