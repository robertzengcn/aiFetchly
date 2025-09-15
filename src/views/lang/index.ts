import { getLanguage } from '@/views/utils/cookies'
import { createI18n } from 'vue-i18n'
import { getLanguagePreference } from '@/views/api/language'
// User defined lang
import enLocale from './en'
import zhLocale from './zh'

const messages = {
    en: {
      ...enLocale
    },
    zh: {
      ...zhLocale
    },
}
// Synchronous version for module initialization
export const getLocale = () => {
    const cookieLanguage = getLanguage()
    if (cookieLanguage) {
      document.documentElement.lang = cookieLanguage
      return cookieLanguage
    }
  
    const language = navigator.language.toLowerCase()
    const locales = Object.keys(messages)
    for (const locale of locales) {
      if (language.indexOf(locale) > -1) {
        document.documentElement.lang = locale
        return locale
      }
    }
  
    // Default language is english
    return 'en'
  }

// Async version that checks system settings first
export const getLocaleAsync = async (): Promise<string> => {
    try {
        // First try to get from system settings
        const systemLanguage = await getLanguagePreference()
        if (systemLanguage && systemLanguage !== 'en') {
            document.documentElement.lang = systemLanguage
            return systemLanguage
        }
    } catch (error) {
        console.warn('Failed to get language from system settings, falling back to cookies:', error)
    }
    
    // Fall back to cookie-based approach
    return getLocale()
  }

const i18n = createI18n({
    legacy: false,
    locale: getLocale(),
    fallbackLocale: 'en',
    globalInjection: true,
    messages
})
export default i18n  
