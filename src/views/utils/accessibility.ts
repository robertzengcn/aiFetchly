/**
 * Accessibility Utilities for Email Extraction
 * Provides ARIA labels, keyboard navigation, screen reader support, focus management, and color contrast compliance
 */

/**
 * ARIA Label utilities
 */
export class AriaLabels {
  /**
   * Generate ARIA label for form fields
   * @param fieldName - Name of the field
   * @param required - Whether the field is required
   * @param error - Error message if any
   * @returns ARIA label string
   */
  static getFormFieldLabel(
    fieldName: string,
    required: boolean = false,
    error?: string
  ): string {
    let label = fieldName
    
    if (required) {
      label += ' (required)'
    }
    
    if (error) {
      label += ` - Error: ${error}`
    }
    
    return label
  }

  /**
   * Generate ARIA label for buttons
   * @param action - Action description
   * @param context - Context information
   * @returns ARIA label string
   */
  static getButtonLabel(action: string, context?: string): string {
    if (context) {
      return `${action} ${context}`
    }
    return action
  }

  /**
   * Generate ARIA label for table cells
   * @param columnName - Name of the column
   * @param value - Cell value
   * @param rowIndex - Row index
   * @returns ARIA label string
   */
  static getTableCellLabel(
    columnName: string,
    value: string,
    rowIndex: number
  ): string {
    return `${columnName} for row ${rowIndex + 1}: ${value}`
  }

  /**
   * Generate ARIA label for status indicators
   * @param status - Status value
   * @param context - Additional context
   * @returns ARIA label string
   */
  static getStatusLabel(status: string, context?: string): string {
    let label = `Status: ${status}`
    
    if (context) {
      label += ` - ${context}`
    }
    
    return label
  }
}

/**
 * Keyboard navigation utilities
 */
export class KeyboardNavigation {
  private focusableSelectors = [
    'button',
    'input',
    'select',
    'textarea',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(', ')

  /**
   * Get all focusable elements in a container
   * @param container - Container element
   * @returns Array of focusable elements
   */
  getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll(this.focusableSelectors)
    ) as HTMLElement[]
  }

  /**
   * Handle keyboard navigation
   * @param event - Keyboard event
   * @param container - Container element
   */
  handleKeyboardNavigation(event: KeyboardEvent, container: HTMLElement): void {
    const focusableElements = this.getFocusableElements(container)
    const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement)
    
    if (currentIndex === -1) return

    let nextIndex: number

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault()
        nextIndex = (currentIndex + 1) % focusableElements.length
        focusableElements[nextIndex].focus()
        break

      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault()
        nextIndex = currentIndex === 0 
          ? focusableElements.length - 1 
          : currentIndex - 1
        focusableElements[nextIndex].focus()
        break

      case 'Home':
        event.preventDefault()
        focusableElements[0].focus()
        break

      case 'End':
        event.preventDefault()
        focusableElements[focusableElements.length - 1].focus()
        break

      case 'Enter':
      case ' ':
        event.preventDefault()
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.click()
        }
        break
    }
  }

  /**
   * Trap focus within a container
   * @param container - Container element
   * @param event - Keyboard event
   */
  trapFocus(container: HTMLElement, event: KeyboardEvent): void {
    const focusableElements = this.getFocusableElements(container)
    
    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (event.target === firstElement && event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      lastElement.focus()
    } else if (event.target === lastElement && event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      firstElement.focus()
    }
  }
}

/**
 * Screen reader utilities
 */
export class ScreenReader {
  private liveRegion: HTMLElement | null = null

  /**
   * Create live region for screen reader announcements
   */
  createLiveRegion(): HTMLElement {
    if (this.liveRegion) {
      return this.liveRegion
    }

    this.liveRegion = document.createElement('div')
    this.liveRegion.setAttribute('aria-live', 'polite')
    this.liveRegion.setAttribute('aria-atomic', 'true')
    this.liveRegion.style.position = 'absolute'
    this.liveRegion.style.left = '-10000px'
    this.liveRegion.style.width = '1px'
    this.liveRegion.style.height = '1px'
    this.liveRegion.style.overflow = 'hidden'

    document.body.appendChild(this.liveRegion)
    return this.liveRegion
  }

  /**
   * Announce message to screen readers
   * @param message - Message to announce
   * @param priority - Priority level ('polite' or 'assertive')
   */
  announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    const liveRegion = this.createLiveRegion()
    liveRegion.setAttribute('aria-live', priority)
    liveRegion.textContent = message

    // Clear message after announcement
    setTimeout(() => {
      liveRegion.textContent = ''
    }, 1000)
  }

  /**
   * Announce form validation errors
   * @param errors - Array of error messages
   */
  announceErrors(errors: string[]): void {
    if (errors.length === 0) return

    const message = `Form validation errors: ${errors.join(', ')}`
    this.announce(message, 'assertive')
  }

  /**
   * Announce success message
   * @param message - Success message
   */
  announceSuccess(message: string): void {
    this.announce(message, 'polite')
  }

  /**
   * Announce loading state
   * @param isLoading - Whether content is loading
   */
  announceLoading(isLoading: boolean): void {
    const message = isLoading ? 'Loading content' : 'Content loaded'
    this.announce(message, 'polite')
  }
}

/**
 * Focus management utilities
 */
export class FocusManager {
  private focusHistory: HTMLElement[] = []
  private maxHistorySize = 10

  /**
   * Save current focus for later restoration
   */
  saveFocus(): void {
    const activeElement = document.activeElement as HTMLElement
    if (activeElement) {
      this.focusHistory.push(activeElement)
      
      // Keep history size manageable
      if (this.focusHistory.length > this.maxHistorySize) {
        this.focusHistory.shift()
      }
    }
  }

  /**
   * Restore previous focus
   */
  restoreFocus(): void {
    const previousFocus = this.focusHistory.pop()
    if (previousFocus && previousFocus.focus) {
      previousFocus.focus()
    }
  }

  /**
   * Focus first focusable element in container
   * @param container - Container element
   */
  focusFirst(container: HTMLElement): void {
    const keyboardNav = new KeyboardNavigation()
    const focusableElements = keyboardNav.getFocusableElements(container)
    
    if (focusableElements.length > 0) {
      focusableElements[0].focus()
    }
  }

  /**
   * Focus last focusable element in container
   * @param container - Container element
   */
  focusLast(container: HTMLElement): void {
    const keyboardNav = new KeyboardNavigation()
    const focusableElements = keyboardNav.getFocusableElements(container)
    
    if (focusableElements.length > 0) {
      focusableElements[focusableElements.length - 1].focus()
    }
  }

  /**
   * Focus element by ID
   * @param id - Element ID
   */
  focusById(id: string): void {
    const element = document.getElementById(id)
    if (element) {
      element.focus()
    }
  }

  /**
   * Focus element by selector
   * @param selector - CSS selector
   */
  focusBySelector(selector: string): void {
    const element = document.querySelector(selector) as HTMLElement
    if (element) {
      element.focus()
    }
  }
}

/**
 * Color contrast utilities
 */
export class ColorContrast {
  /**
   * Calculate relative luminance
   * @param r - Red component (0-255)
   * @param g - Green component (0-255)
   * @param b - Blue component (0-255)
   * @returns Relative luminance value
   */
  static getRelativeLuminance(r: number, g: number, b: number): number {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
  }

  /**
   * Calculate contrast ratio between two colors
   * @param color1 - First color (hex string)
   * @param color2 - Second color (hex string)
   * @returns Contrast ratio
   */
  static getContrastRatio(color1: string, color2: string): number {
    const rgb1 = this.hexToRgb(color1)
    const rgb2 = this.hexToRgb(color2)
    
    if (!rgb1 || !rgb2) return 0

    const lum1 = this.getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b)
    const lum2 = this.getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b)
    
    const lighter = Math.max(lum1, lum2)
    const darker = Math.min(lum1, lum2)
    
    return (lighter + 0.05) / (darker + 0.05)
  }

  /**
   * Check if contrast ratio meets WCAG guidelines
   * @param color1 - First color (hex string)
   * @param color2 - Second color (hex string)
   * @param level - WCAG level ('AA' or 'AAA')
   * @param size - Text size ('normal' or 'large')
   * @returns Whether contrast meets guidelines
   */
  static meetsWCAGGuidelines(
    color1: string,
    color2: string,
    level: 'AA' | 'AAA' = 'AA',
    size: 'normal' | 'large' = 'normal'
  ): boolean {
    const ratio = this.getContrastRatio(color1, color2)
    
    const guidelines = {
      AA: { normal: 4.5, large: 3 },
      AAA: { normal: 7, large: 4.5 }
    }
    
    const requiredRatio = guidelines[level][size]
    return ratio >= requiredRatio
  }

  /**
   * Convert hex color to RGB
   * @param hex - Hex color string
   * @returns RGB object or null if invalid
   */
  static hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    
    if (!result) return null
    
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    }
  }

  /**
   * Get accessible text color for background
   * @param backgroundColor - Background color (hex string)
   * @returns Accessible text color (hex string)
   */
  static getAccessibleTextColor(backgroundColor: string): string {
    const white = '#FFFFFF'
    const black = '#000000'
    
    const whiteContrast = this.getContrastRatio(backgroundColor, white)
    const blackContrast = this.getContrastRatio(backgroundColor, black)
    
    return whiteContrast > blackContrast ? white : black
  }
}

/**
 * Accessibility compliance checker
 */
export class AccessibilityChecker {
  /**
   * Check if element has proper ARIA attributes
   * @param element - Element to check
   * @returns Array of accessibility issues
   */
  static checkAriaAttributes(element: HTMLElement): string[] {
    const issues: string[] = []
    
    // Check for images without alt text
    const images = element.querySelectorAll('img')
    images.forEach(img => {
      if (!img.alt && !img.getAttribute('aria-label')) {
        issues.push('Image missing alt text or aria-label')
      }
    })

    // Check for form fields without labels
    const formFields = element.querySelectorAll('input, select, textarea')
    formFields.forEach(field => {
      const hasLabel = field.getAttribute('aria-label') || 
                      field.getAttribute('aria-labelledby') ||
                      field.closest('label')
      
      if (!hasLabel) {
        issues.push('Form field missing label or aria-label')
      }
    })

    // Check for buttons without accessible text
    const buttons = element.querySelectorAll('button')
    buttons.forEach(button => {
      const hasText = button.textContent?.trim() || 
                     button.getAttribute('aria-label')
      
      if (!hasText) {
        issues.push('Button missing accessible text')
      }
    })

    return issues
  }

  /**
   * Check keyboard navigation
   * @param element - Element to check
   * @returns Array of keyboard navigation issues
   */
  static checkKeyboardNavigation(element: HTMLElement): string[] {
    const issues: string[] = []
    const keyboardNav = new KeyboardNavigation()
    const focusableElements = keyboardNav.getFocusableElements(element)
    
    // Check if all interactive elements are keyboard accessible
    const interactiveElements = element.querySelectorAll('button, a, input, select, textarea')
    interactiveElements.forEach(el => {
      if (el instanceof HTMLElement && el.tabIndex === -1) {
        issues.push('Interactive element not keyboard accessible')
      }
    })

    return issues
  }

  /**
   * Check color contrast
   * @param element - Element to check
   * @returns Array of contrast issues
   */
  static checkColorContrast(element: HTMLElement): string[] {
    const issues: string[] = []
    
    // Get computed styles for text and background
    const style = window.getComputedStyle(element)
    const backgroundColor = style.backgroundColor
    const color = style.color
    
    // Convert to hex for contrast calculation
    const bgHex = this.rgbToHex(backgroundColor)
    const textHex = this.rgbToHex(color)
    
    if (bgHex && textHex) {
      const ratio = ColorContrast.getContrastRatio(bgHex, textHex)
      
      if (ratio < 4.5) {
        issues.push(`Insufficient color contrast: ${ratio.toFixed(2)}:1`)
      }
    }

    return issues
  }

  /**
   * Convert RGB color to hex
   * @param rgb - RGB color string
   * @returns Hex color string or null
   */
  private static rgbToHex(rgb: string): string | null {
    const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!match) return null
    
    const r = parseInt(match[1])
    const g = parseInt(match[2])
    const b = parseInt(match[3])
    
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
  }

  /**
   * Run comprehensive accessibility check
   * @param element - Element to check
   * @returns Object with all accessibility issues
   */
  static runComprehensiveCheck(element: HTMLElement) {
    return {
      aria: this.checkAriaAttributes(element),
      keyboard: this.checkKeyboardNavigation(element),
      contrast: this.checkColorContrast(element)
    }
  }
}

// Global instances
export const ariaLabels = new AriaLabels()
export const keyboardNavigation = new KeyboardNavigation()
export const screenReader = new ScreenReader()
export const focusManager = new FocusManager()
export const accessibilityChecker = new AccessibilityChecker()

/**
 * Vue composition utilities for accessibility
 */
export function useAccessibility() {
  /**
   * Add ARIA attributes to element
   */
  const addAriaAttributes = (
    element: HTMLElement,
    attributes: Record<string, string>
  ) => {
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value)
    })
  }

  /**
   * Handle keyboard events
   */
  const handleKeyboardEvents = (event: KeyboardEvent) => {
    keyboardNavigation.handleKeyboardNavigation(event, event.target as HTMLElement)
  }

  /**
   * Announce to screen reader
   */
  const announce = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    screenReader.announce(message, priority)
  }

  /**
   * Manage focus
   */
  const saveAndRestoreFocus = () => {
    focusManager.saveFocus()
    return () => focusManager.restoreFocus()
  }

  return {
    addAriaAttributes,
    handleKeyboardEvents,
    announce,
    saveAndRestoreFocus
  }
} 