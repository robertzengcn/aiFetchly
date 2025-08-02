import { EmailscFormdata } from '@/entityTypes/emailextraction-type'

// Input sanitization utilities
export const sanitizeInput = {
  // Sanitize string input
  string: (input: string): string => {
    if (!input) return ''
    
    // Remove HTML tags
    let sanitized = input.replace(/<[^>]*>/g, '')
    
    // Remove script tags and content
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    
    // Remove dangerous characters
    sanitized = sanitized.replace(/[<>]/g, '')
    
    // Trim whitespace
    sanitized = sanitized.trim()
    
    return sanitized
  },

  // Sanitize URL
  url: (url: string): string => {
    if (!url) return ''
    
    let sanitized = url.trim()
    
    // Ensure URL has protocol
    if (!sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
      sanitized = 'https://' + sanitized
    }
    
    // Validate URL format
    try {
      new URL(sanitized)
      return sanitized
    } catch {
      return ''
    }
  },

  // Sanitize number
  number: (value: any, min?: number, max?: number): number => {
    const num = parseInt(value)
    if (isNaN(num)) return 0
    
    if (min !== undefined && num < min) return min
    if (max !== undefined && num > max) return max
    
    return num
  },

  // Sanitize array of strings
  stringArray: (arr: string[]): string[] => {
    if (!Array.isArray(arr)) return []
    
    return arr
      .filter(item => item !== null && item !== undefined)
      .map(item => sanitizeInput.string(item))
      .filter(item => item.length > 0)
  },

  // Sanitize form data
  formData: (data: EmailscFormdata): EmailscFormdata => {
    const sanitized = { ...data }
    
    // Sanitize strings
    if (sanitized.extratype) {
      sanitized.extratype = sanitizeInput.string(sanitized.extratype)
    }
    
    // Sanitize URLs
    if (sanitized.urls) {
      sanitized.urls = sanitized.urls.map(url => sanitizeInput.url(url)).filter(url => url)
    }
    
    // Sanitize numbers
    if (sanitized.concurrency) {
      sanitized.concurrency = sanitizeInput.number(sanitized.concurrency, 1, 100)
    }
    
    if (sanitized.pagelength) {
      sanitized.pagelength = sanitizeInput.number(sanitized.pagelength, 1, 1000)
    }
    
    if (sanitized.processTimeout) {
      sanitized.processTimeout = sanitizeInput.number(sanitized.processTimeout, 1, 60)
    }
    
    if (sanitized.maxPageNumber) {
      sanitized.maxPageNumber = sanitizeInput.number(sanitized.maxPageNumber, 0, 10000)
    }
    
    // Sanitize search task ID
    if (sanitized.searchTaskId) {
      sanitized.searchTaskId = sanitizeInput.number(sanitized.searchTaskId, 0)
    }
    
    return sanitized
  }
}

// CSRF protection utilities
export const csrfProtection = {
  // Generate CSRF token
  generateToken: (): string => {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
  },

  // Validate CSRF token
  validateToken: (token: string, storedToken: string): boolean => {
    if (!token || !storedToken) return false
    return token === storedToken
  },

  // Get stored CSRF token
  getStoredToken: (): string | null => {
    return localStorage.getItem('csrf_token')
  },

  // Store CSRF token
  storeToken: (token: string): void => {
    localStorage.setItem('csrf_token', token)
  }
}

// Rate limiting utilities
export class RateLimiter {
  private requests = new Map<string, { count: number; resetTime: number }>()
  private maxRequests: number
  private windowMs: number

  constructor(maxRequests: number = 10, windowMs: number = 60000) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  // Check if request is allowed
  isAllowed(key: string): boolean {
    const now = Date.now()
    const request = this.requests.get(key)

    if (!request) {
      this.requests.set(key, { count: 1, resetTime: now + this.windowMs })
      return true
    }

    if (now > request.resetTime) {
      this.requests.set(key, { count: 1, resetTime: now + this.windowMs })
      return true
    }

    if (request.count >= this.maxRequests) {
      return false
    }

    request.count++
    return true
  }

  // Get remaining requests
  getRemaining(key: string): number {
    const request = this.requests.get(key)
    if (!request) return this.maxRequests
    return Math.max(0, this.maxRequests - request.count)
  }

  // Reset rate limiter
  reset(key: string): void {
    this.requests.delete(key)
  }
}

// Audit logging utilities
export interface AuditLogEntry {
  timestamp: Date
  userId?: string
  action: string
  resource: string
  resourceId: number
  details: any
  ipAddress?: string
  userAgent?: string
}

export class AuditLogger {
  private logs: AuditLogEntry[] = []

  // Log an action
  log(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    const logEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date()
    }
    
    this.logs.push(logEntry)
    
    // In a real application, you would send this to a logging service
    console.log('AUDIT LOG:', logEntry)
  }

  // Get logs for a specific resource
  getLogsForResource(resource: string, resourceId: number): AuditLogEntry[] {
    return this.logs.filter(log => 
      log.resource === resource && log.resourceId === resourceId
    )
  }

  // Get logs for a specific user
  getLogsForUser(userId: string): AuditLogEntry[] {
    return this.logs.filter(log => log.userId === userId)
  }

  // Clear logs (for testing)
  clear(): void {
    this.logs = []
  }
}

// Security validation utilities
export const securityValidation = {
  // Validate input length
  validateLength: (input: string, maxLength: number): boolean => {
    return input.length <= maxLength
  },

  // Validate file type
  validateFileType: (filename: string, allowedTypes: string[]): boolean => {
    const extension = filename.split('.').pop()?.toLowerCase()
    return extension ? allowedTypes.includes(extension) : false
  },

  // Validate email format
  validateEmail: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  },

  // Validate URL format
  validateUrl: (url: string): boolean => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  },

  // Check for SQL injection patterns
  checkSqlInjection: (input: string): boolean => {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      /(--|\/\*|\*\/|;)/,
      /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i
    ]
    
    return sqlPatterns.some(pattern => pattern.test(input))
  },

  // Check for XSS patterns
  checkXss: (input: string): boolean => {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /<object/i,
      /<embed/i
    ]
    
    return xssPatterns.some(pattern => pattern.test(input))
  }
}

// Global instances
export const rateLimiter = new RateLimiter(10, 60000) // 10 requests per minute
export const auditLogger = new AuditLogger()

// Security middleware for API calls
export const securityMiddleware = {
  // Sanitize request data
  sanitizeRequest: (data: any): any => {
    if (typeof data === 'string') {
      return sanitizeInput.string(data)
    }
    
    if (Array.isArray(data)) {
      return data.map(item => securityMiddleware.sanitizeRequest(item))
    }
    
    if (typeof data === 'object' && data !== null) {
      const sanitized: any = {}
      for (const [key, value] of Object.entries(data)) {
        sanitized[key] = securityMiddleware.sanitizeRequest(value)
      }
      return sanitized
    }
    
    return data
  },

  // Validate request
  validateRequest: (data: any): { isValid: boolean; errors: string[] } => {
    const errors: string[] = []
    
    // Check for SQL injection
    if (typeof data === 'string' && securityValidation.checkSqlInjection(data)) {
      errors.push('Potential SQL injection detected')
    }
    
    // Check for XSS
    if (typeof data === 'string' && securityValidation.checkXss(data)) {
      errors.push('Potential XSS attack detected')
    }
    
    return {
      isValid: errors.length === 0,
      errors
    }
  },

  // Log security event
  logSecurityEvent: (event: string, details: any) => {
    auditLogger.log({
      action: event,
      resource: 'security',
      resourceId: 0,
      details
    })
  }
}