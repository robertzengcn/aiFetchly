import { describe, it, expect, beforeEach } from 'vitest'

// Mock form validation utilities
const validateUrls = (urls: string[]): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (!urls || urls.length === 0) {
    errors.push('At least one URL is required')
    return { isValid: false, errors }
  }
  
  for (const url of urls) {
    if (!url.trim()) {
      errors.push('URL cannot be empty')
      continue
    }
    
    try {
      new URL(url)
    } catch {
      errors.push(`Invalid URL format: ${url}`)
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

const validatePageLength = (length: number): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (length <= 0) {
    errors.push('Page length must be greater than 0')
  }
  
  if (length > 1000) {
    errors.push('Page length cannot exceed 1000')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

const validateConcurrency = (concurrency: number): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (concurrency <= 0) {
    errors.push('Concurrency must be greater than 0')
  }
  
  if (concurrency > 10) {
    errors.push('Concurrency cannot exceed 10')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

const validateProcessTimeout = (timeout: number): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (timeout < 1) {
    errors.push('Process timeout must be at least 1 minute')
  }
  
  if (timeout > 20) {
    errors.push('Process timeout cannot exceed 20 minutes')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

const validateMaxPageNumber = (maxPages: number): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (maxPages < 0) {
    errors.push('Max page number cannot be negative')
  }
  
  if (maxPages > 1000) {
    errors.push('Max page number cannot exceed 1000')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

describe('Email Extraction Form Validation Tests', () => {
  describe('URL Validation', () => {
    it('should validate valid URLs', () => {
      const urls = [
        'https://example.com',
        'http://test.com',
        'https://subdomain.example.org/path'
      ]
      
      const result = validateUrls(urls)
      
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject empty URL list', () => {
      const urls: string[] = []
      
      const result = validateUrls(urls)
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('At least one URL is required')
    })

    it('should reject invalid URL formats', () => {
      const urls = [
        'not-a-url',
        'ftp://example.com',
        'invalid-protocol://test.com'
      ]
      
      const result = validateUrls(urls)
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(3)
      expect(result.errors[0]).toContain('Invalid URL format')
    })

    it('should reject empty URL strings', () => {
      const urls = ['', 'https://example.com', '']
      
      const result = validateUrls(urls)
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('URL cannot be empty')
    })
  })

  describe('Page Length Validation', () => {
    it('should validate valid page length', () => {
      const validLengths = [1, 10, 100, 500, 1000]
      
      for (const length of validLengths) {
        const result = validatePageLength(length)
        expect(result.isValid).toBe(true)
        expect(result.errors).toHaveLength(0)
      }
    })

    it('should reject zero or negative page length', () => {
      const invalidLengths = [0, -1, -10]
      
      for (const length of invalidLengths) {
        const result = validatePageLength(length)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Page length must be greater than 0')
      }
    })

    it('should reject page length exceeding maximum', () => {
      const invalidLengths = [1001, 2000, 5000]
      
      for (const length of invalidLengths) {
        const result = validatePageLength(length)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Page length cannot exceed 1000')
      }
    })
  })

  describe('Concurrency Validation', () => {
    it('should validate valid concurrency values', () => {
      const validConcurrency = [1, 2, 5, 10]
      
      for (const concurrency of validConcurrency) {
        const result = validateConcurrency(concurrency)
        expect(result.isValid).toBe(true)
        expect(result.errors).toHaveLength(0)
      }
    })

    it('should reject zero or negative concurrency', () => {
      const invalidConcurrency = [0, -1, -5]
      
      for (const concurrency of invalidConcurrency) {
        const result = validateConcurrency(concurrency)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Concurrency must be greater than 0')
      }
    })

    it('should reject concurrency exceeding maximum', () => {
      const invalidConcurrency = [11, 20, 50]
      
      for (const concurrency of invalidConcurrency) {
        const result = validateConcurrency(concurrency)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Concurrency cannot exceed 10')
      }
    })
  })

  describe('Process Timeout Validation', () => {
    it('should validate valid timeout values', () => {
      const validTimeouts = [1, 5, 10, 15, 20]
      
      for (const timeout of validTimeouts) {
        const result = validateProcessTimeout(timeout)
        expect(result.isValid).toBe(true)
        expect(result.errors).toHaveLength(0)
      }
    })

    it('should reject timeout less than minimum', () => {
      const invalidTimeouts = [0, -1, -5]
      
      for (const timeout of invalidTimeouts) {
        const result = validateProcessTimeout(timeout)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Process timeout must be at least 1 minute')
      }
    })

    it('should reject timeout exceeding maximum', () => {
      const invalidTimeouts = [21, 30, 60]
      
      for (const timeout of invalidTimeouts) {
        const result = validateProcessTimeout(timeout)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Process timeout cannot exceed 20 minutes')
      }
    })
  })

  describe('Max Page Number Validation', () => {
    it('should validate valid max page numbers', () => {
      const validMaxPages = [0, 1, 100, 500, 1000]
      
      for (const maxPages of validMaxPages) {
        const result = validateMaxPageNumber(maxPages)
        expect(result.isValid).toBe(true)
        expect(result.errors).toHaveLength(0)
      }
    })

    it('should reject negative max page numbers', () => {
      const invalidMaxPages = [-1, -10, -100]
      
      for (const maxPages of invalidMaxPages) {
        const result = validateMaxPageNumber(maxPages)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Max page number cannot be negative')
      }
    })

    it('should reject max page numbers exceeding maximum', () => {
      const invalidMaxPages = [1001, 2000, 5000]
      
      for (const maxPages of invalidMaxPages) {
        const result = validateMaxPageNumber(maxPages)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Max page number cannot exceed 1000')
      }
    })
  })

  describe('Complete Form Validation', () => {
    it('should validate a complete valid form', () => {
      const formData = {
        urls: ['https://example.com', 'https://test.com'],
        pagelength: 10,
        concurrency: 2,
        processTimeout: 5,
        maxPageNumber: 100
      }
      
      const urlValidation = validateUrls(formData.urls)
      const pageLengthValidation = validatePageLength(formData.pagelength)
      const concurrencyValidation = validateConcurrency(formData.concurrency)
      const timeoutValidation = validateProcessTimeout(formData.processTimeout)
      const maxPagesValidation = validateMaxPageNumber(formData.maxPageNumber)
      
      expect(urlValidation.isValid).toBe(true)
      expect(pageLengthValidation.isValid).toBe(true)
      expect(concurrencyValidation.isValid).toBe(true)
      expect(timeoutValidation.isValid).toBe(true)
      expect(maxPagesValidation.isValid).toBe(true)
    })

    it('should collect all validation errors', () => {
      const invalidFormData = {
        urls: [],
        pagelength: -1,
        concurrency: 15,
        processTimeout: 25,
        maxPageNumber: -5
      }
      
      const urlValidation = validateUrls(invalidFormData.urls)
      const pageLengthValidation = validatePageLength(invalidFormData.pagelength)
      const concurrencyValidation = validateConcurrency(invalidFormData.concurrency)
      const timeoutValidation = validateProcessTimeout(invalidFormData.processTimeout)
      const maxPagesValidation = validateMaxPageNumber(invalidFormData.maxPageNumber)
      
      const allErrors = [
        ...urlValidation.errors,
        ...pageLengthValidation.errors,
        ...concurrencyValidation.errors,
        ...timeoutValidation.errors,
        ...maxPagesValidation.errors
      ]
      
      expect(allErrors).toHaveLength(5)
      expect(allErrors).toContain('At least one URL is required')
      expect(allErrors).toContain('Page length must be greater than 0')
      expect(allErrors).toContain('Concurrency cannot exceed 10')
      expect(allErrors).toContain('Process timeout cannot exceed 20 minutes')
      expect(allErrors).toContain('Max page number cannot be negative')
    })
  })
}) 