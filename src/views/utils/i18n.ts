/**
 * Internationalization Utilities for Email Extraction
 * Provides translation keys, locale-specific formatting, RTL language support, and cultural adaptations
 */

export interface LocaleConfig {
  code: string
  name: string
  direction: 'ltr' | 'rtl'
  dateFormat: string
  timeFormat: string
  numberFormat: Intl.NumberFormatOptions
  currencyFormat: Intl.NumberFormatOptions
}

export interface TranslationKey {
  key: string
  defaultValue: string
  description?: string
  context?: string
}

/**
 * Translation management utilities
 */
export class TranslationManager {
  private translations = new Map<string, Record<string, string>>()
  private currentLocale = 'en'
  private fallbackLocale = 'en'

  /**
   * Add translation data
   * @param locale - Locale code
   * @param translations - Translation data
   */
  addTranslations(locale: string, translations: Record<string, string>): void {
    this.translations.set(locale, translations)
  }

  /**
   * Get translation for key
   * @param key - Translation key
   * @param locale - Locale code (optional, uses current locale)
   * @param params - Parameters for interpolation
   * @returns Translated string
   */
  translate(
    key: string,
    locale?: string,
    params?: Record<string, string | number>
  ): string {
    const targetLocale = locale || this.currentLocale
    const translations = this.translations.get(targetLocale) || 
                       this.translations.get(this.fallbackLocale) || {}
    
    let translation = translations[key] || key

    // Interpolate parameters
    if (params) {
      Object.entries(params).forEach(([param, value]) => {
        translation = translation.replace(`{${param}}`, String(value))
      })
    }

    return translation
  }

  /**
   * Set current locale
   * @param locale - Locale code
   */
  setLocale(locale: string): void {
    this.currentLocale = locale
    document.documentElement.setAttribute('lang', locale)
    document.documentElement.setAttribute('dir', this.getDirection(locale))
  }

  /**
   * Get current locale
   * @returns Current locale code
   */
  getCurrentLocale(): string {
    return this.currentLocale
  }

  /**
   * Get text direction for locale
   * @param locale - Locale code
   * @returns Text direction
   */
  getDirection(locale: string): 'ltr' | 'rtl' {
    const rtlLocales = ['ar', 'he', 'fa', 'ur', 'ps', 'sd']
    return rtlLocales.includes(locale) ? 'rtl' : 'ltr'
  }

  /**
   * Check if locale is RTL
   * @param locale - Locale code
   * @returns True if RTL
   */
  isRTL(locale: string): boolean {
    return this.getDirection(locale) === 'rtl'
  }
}

/**
 * Locale-specific formatting utilities
 */
export class LocaleFormatter {
  private localeConfigs = new Map<string, LocaleConfig>()

  /**
   * Add locale configuration
   * @param config - Locale configuration
   */
  addLocaleConfig(config: LocaleConfig): void {
    this.localeConfigs.set(config.code, config)
  }

  /**
   * Format date according to locale
   * @param date - Date to format
   * @param locale - Locale code
   * @param options - Formatting options
   * @returns Formatted date string
   */
  formatDate(
    date: Date,
    locale: string,
    options?: Intl.DateTimeFormatOptions
  ): string {
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...options
    }

    return new Intl.DateTimeFormat(locale, defaultOptions).format(date)
  }

  /**
   * Format time according to locale
   * @param date - Date to format
   * @param locale - Locale code
   * @param options - Formatting options
   * @returns Formatted time string
   */
  formatTime(
    date: Date,
    locale: string,
    options?: Intl.DateTimeFormatOptions
  ): string {
    const defaultOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      ...options
    }

    return new Intl.DateTimeFormat(locale, defaultOptions).format(date)
  }

  /**
   * Format number according to locale
   * @param number - Number to format
   * @param locale - Locale code
   * @param options - Formatting options
   * @returns Formatted number string
   */
  formatNumber(
    number: number,
    locale: string,
    options?: Intl.NumberFormatOptions
  ): string {
    const defaultOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      ...options
    }

    return new Intl.NumberFormat(locale, defaultOptions).format(number)
  }

  /**
   * Format currency according to locale
   * @param amount - Amount to format
   * @param currency - Currency code
   * @param locale - Locale code
   * @param options - Formatting options
   * @returns Formatted currency string
   */
  formatCurrency(
    amount: number,
    currency: string,
    locale: string,
    options?: Intl.NumberFormatOptions
  ): string {
    const defaultOptions: Intl.NumberFormatOptions = {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...options
    }

    return new Intl.NumberFormat(locale, defaultOptions).format(amount)
  }

  /**
   * Format relative time
   * @param date - Date to format
   * @param locale - Locale code
   * @returns Relative time string
   */
  formatRelativeTime(date: Date, locale: string): string {
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

    if (diffInSeconds < 60) {
      return rtf.format(-diffInSeconds, 'second')
    } else if (diffInSeconds < 3600) {
      return rtf.format(-Math.floor(diffInSeconds / 60), 'minute')
    } else if (diffInSeconds < 86400) {
      return rtf.format(-Math.floor(diffInSeconds / 3600), 'hour')
    } else {
      return rtf.format(-Math.floor(diffInSeconds / 86400), 'day')
    }
  }
}

/**
 * RTL language support utilities
 */
export class RTLSupport {
  /**
   * Check if current locale is RTL
   * @returns True if RTL
   */
  static isRTL(): boolean {
    return document.documentElement.getAttribute('dir') === 'rtl'
  }

  /**
   * Apply RTL styles to element
   * @param element - Element to apply RTL styles to
   */
  static applyRTLStyles(element: HTMLElement): void {
    if (this.isRTL()) {
      element.style.direction = 'rtl'
      element.style.textAlign = 'right'
    }
  }

  /**
   * Get RTL-aware margin/padding
   * @param left - Left value
   * @param right - Right value
   * @returns CSS property object
   */
  static getRTLSpacing(left: string, right: string): Record<string, string> {
    if (this.isRTL()) {
      return {
        marginLeft: right,
        marginRight: left,
        paddingLeft: right,
        paddingRight: left
      }
    } else {
      return {
        marginLeft: left,
        marginRight: right,
        paddingLeft: left,
        paddingRight: right
      }
    }
  }

  /**
   * Get RTL-aware flex direction
   * @param direction - Original flex direction
   * @returns RTL-aware flex direction
   */
  static getRTLFlexDirection(direction: string): string {
    if (!this.isRTL()) return direction

    switch (direction) {
      case 'row':
        return 'row-reverse'
      case 'row-reverse':
        return 'row'
      default:
        return direction
    }
  }

  /**
   * Mirror icon for RTL
   * @param iconName - Original icon name
   * @returns RTL-aware icon name
   */
  static getRTLIcon(iconName: string): string {
    if (!this.isRTL()) return iconName

    const iconMap: Record<string, string> = {
      'mdi-arrow-left': 'mdi-arrow-right',
      'mdi-arrow-right': 'mdi-arrow-left',
      'mdi-chevron-left': 'mdi-chevron-right',
      'mdi-chevron-right': 'mdi-chevron-left',
      'mdi-menu-left': 'mdi-menu-right',
      'mdi-menu-right': 'mdi-menu-left'
    }

    return iconMap[iconName] || iconName
  }
}

/**
 * Cultural adaptations utilities
 */
export class CulturalAdaptations {
  /**
   * Get culturally appropriate greeting
   * @param locale - Locale code
   * @param timeOfDay - Time of day
   * @returns Greeting string
   */
  static getGreeting(locale: string, timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'): string {
    const greetings: Record<string, Record<string, string>> = {
      en: {
        morning: 'Good morning',
        afternoon: 'Good afternoon',
        evening: 'Good evening',
        night: 'Good night'
      },
      es: {
        morning: 'Buenos días',
        afternoon: 'Buenas tardes',
        evening: 'Buenas noches',
        night: 'Buenas noches'
      },
      fr: {
        morning: 'Bonjour',
        afternoon: 'Bon après-midi',
        evening: 'Bonsoir',
        night: 'Bonne nuit'
      },
      de: {
        morning: 'Guten Morgen',
        afternoon: 'Guten Tag',
        evening: 'Guten Abend',
        night: 'Gute Nacht'
      },
      ar: {
        morning: 'صباح الخير',
        afternoon: 'مساء الخير',
        evening: 'مساء الخير',
        night: 'تصبح على خير'
      }
    }

    return greetings[locale]?.[timeOfDay] || greetings.en[timeOfDay]
  }

  /**
   * Get culturally appropriate date format
   * @param locale - Locale code
   * @returns Date format string
   */
  static getDateFormat(locale: string): string {
    const formats: Record<string, string> = {
      en: 'MM/DD/YYYY',
      es: 'DD/MM/YYYY',
      fr: 'DD/MM/YYYY',
      de: 'DD.MM.YYYY',
      ar: 'DD/MM/YYYY'
    }

    return formats[locale] || formats.en
  }

  /**
   * Get culturally appropriate number format
   * @param locale - Locale code
   * @returns Number format options
   */
  static getNumberFormat(locale: string): Intl.NumberFormatOptions {
    const formats: Record<string, Intl.NumberFormatOptions> = {
      en: { useGrouping: true, minimumFractionDigits: 0 },
      es: { useGrouping: true, minimumFractionDigits: 0 },
      fr: { useGrouping: true, minimumFractionDigits: 0 },
      de: { useGrouping: true, minimumFractionDigits: 0 },
      ar: { useGrouping: true, minimumFractionDigits: 0 }
    }

    return formats[locale] || formats.en
  }

  /**
   * Get culturally appropriate currency symbol
   * @param locale - Locale code
   * @returns Currency symbol
   */
  static getCurrencySymbol(locale: string): string {
    const symbols: Record<string, string> = {
      en: '$',
      es: '€',
      fr: '€',
      de: '€',
      ar: 'د.ك'
    }

    return symbols[locale] || symbols.en
  }
}

/**
 * Email extraction specific translation keys
 */
export const emailExtractionKeys: TranslationKey[] = [
  {
    key: 'emailextraction.title',
    defaultValue: 'Email Extraction',
    description: 'Main page title'
  },
  {
    key: 'emailextraction.create_task',
    defaultValue: 'Create New Task',
    description: 'Button to create new task'
  },
  {
    key: 'emailextraction.edit_task',
    defaultValue: 'Edit Task',
    description: 'Button to edit existing task'
  },
  {
    key: 'emailextraction.delete_task',
    defaultValue: 'Delete Task',
    description: 'Button to delete task'
  },
  {
    key: 'emailextraction.task_list',
    defaultValue: 'Task List',
    description: 'Title for task list page'
  },
  {
    key: 'emailextraction.task_details',
    defaultValue: 'Task Details',
    description: 'Title for task details page'
  },
  {
    key: 'emailextraction.extraction_type',
    defaultValue: 'Extraction Type',
    description: 'Label for extraction type field'
  },
  {
    key: 'emailextraction.urls',
    defaultValue: 'URLs',
    description: 'Label for URLs field'
  },
  {
    key: 'emailextraction.page_length',
    defaultValue: 'Page Length',
    description: 'Label for page length field'
  },
  {
    key: 'emailextraction.concurrency',
    defaultValue: 'Concurrency',
    description: 'Label for concurrency field'
  },
  {
    key: 'emailextraction.process_timeout',
    defaultValue: 'Process Timeout',
    description: 'Label for process timeout field'
  },
  {
    key: 'emailextraction.max_page_number',
    defaultValue: 'Max Page Number',
    description: 'Label for max page number field'
  },
  {
    key: 'emailextraction.status',
    defaultValue: 'Status',
    description: 'Label for status column'
  },
  {
    key: 'emailextraction.actions',
    defaultValue: 'Actions',
    description: 'Label for actions column'
  },
  {
    key: 'emailextraction.created_at',
    defaultValue: 'Created At',
    description: 'Label for created at column'
  },
  {
    key: 'emailextraction.updated_at',
    defaultValue: 'Updated At',
    description: 'Label for updated at column'
  },
  {
    key: 'emailextraction.status.pending',
    defaultValue: 'Pending',
    description: 'Status for pending tasks'
  },
  {
    key: 'emailextraction.status.running',
    defaultValue: 'Running',
    description: 'Status for running tasks'
  },
  {
    key: 'emailextraction.status.completed',
    defaultValue: 'Completed',
    description: 'Status for completed tasks'
  },
  {
    key: 'emailextraction.status.error',
    defaultValue: 'Error',
    description: 'Status for error tasks'
  },
  {
    key: 'emailextraction.status.cancelled',
    defaultValue: 'Cancelled',
    description: 'Status for cancelled tasks'
  },
  {
    key: 'emailextraction.validation.required',
    defaultValue: 'This field is required',
    description: 'Validation message for required fields'
  },
  {
    key: 'emailextraction.validation.invalid_url',
    defaultValue: 'Please enter a valid URL',
    description: 'Validation message for invalid URLs'
  },
  {
    key: 'emailextraction.validation.min_value',
    defaultValue: 'Value must be at least {min}',
    description: 'Validation message for minimum value'
  },
  {
    key: 'emailextraction.validation.max_value',
    defaultValue: 'Value must be at most {max}',
    description: 'Validation message for maximum value'
  },
  {
    key: 'emailextraction.error.task_not_found',
    defaultValue: 'Task not found',
    description: 'Error message when task is not found'
  },
  {
    key: 'emailextraction.error.cannot_edit',
    defaultValue: 'Cannot edit task with current status',
    description: 'Error message when task cannot be edited'
  },
  {
    key: 'emailextraction.error.network_error',
    defaultValue: 'Network connection failed',
    description: 'Error message for network issues'
  },
  {
    key: 'emailextraction.success.task_created',
    defaultValue: 'Task created successfully',
    description: 'Success message when task is created'
  },
  {
    key: 'emailextraction.success.task_updated',
    defaultValue: 'Task updated successfully',
    description: 'Success message when task is updated'
  },
  {
    key: 'emailextraction.success.task_deleted',
    defaultValue: 'Task deleted successfully',
    description: 'Success message when task is deleted'
  },
  {
    key: 'emailextraction.confirmation.delete_task',
    defaultValue: 'Are you sure you want to delete this task?',
    description: 'Confirmation message for task deletion'
  },
  {
    key: 'emailextraction.confirmation.unsaved_changes',
    defaultValue: 'You have unsaved changes. Are you sure you want to leave?',
    description: 'Confirmation message for unsaved changes'
  }
]

// Global instances
export const translationManager = new TranslationManager()
export const localeFormatter = new LocaleFormatter()

// Initialize with default locale configurations
localeFormatter.addLocaleConfig({
  code: 'en',
  name: 'English',
  direction: 'ltr',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: 'HH:mm',
  numberFormat: { useGrouping: true, minimumFractionDigits: 0 },
  currencyFormat: { style: 'currency', currency: 'USD' }
})

localeFormatter.addLocaleConfig({
  code: 'es',
  name: 'Español',
  direction: 'ltr',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: 'HH:mm',
  numberFormat: { useGrouping: true, minimumFractionDigits: 0 },
  currencyFormat: { style: 'currency', currency: 'EUR' }
})

localeFormatter.addLocaleConfig({
  code: 'ar',
  name: 'العربية',
  direction: 'rtl',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: 'HH:mm',
  numberFormat: { useGrouping: true, minimumFractionDigits: 0 },
  currencyFormat: { style: 'currency', currency: 'KWD' }
})

/**
 * Vue composition utilities for internationalization
 */
export function useI18n() {
  /**
   * Translate text
   */
  const t = (key: string, params?: Record<string, string | number>): string => {
    return translationManager.translate(key, undefined, params)
  }

  /**
   * Format date
   */
  const formatDate = (date: Date, options?: Intl.DateTimeFormatOptions): string => {
    const locale = translationManager.getCurrentLocale()
    return localeFormatter.formatDate(date, locale, options)
  }

  /**
   * Format number
   */
  const formatNumber = (number: number, options?: Intl.NumberFormatOptions): string => {
    const locale = translationManager.getCurrentLocale()
    return localeFormatter.formatNumber(number, locale, options)
  }

  /**
   * Check if current locale is RTL
   */
  const isRTL = (): boolean => {
    return RTLSupport.isRTL()
  }

  /**
   * Get culturally appropriate greeting
   */
  const getGreeting = (timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'): string => {
    const locale = translationManager.getCurrentLocale()
    return CulturalAdaptations.getGreeting(locale, timeOfDay)
  }

  return {
    t,
    formatDate,
    formatNumber,
    isRTL,
    getGreeting
  }
} 