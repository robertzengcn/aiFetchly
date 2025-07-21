import { getLanguage } from '@/views/utils/cookies'
import { createI18n } from 'vue-i18n'
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

const i18n = createI18n({
    legacy: false,
    locale: getLocale(),
    fallbackLocale: 'en',
    globalInjection: true,
    messages
})
export default i18n  
