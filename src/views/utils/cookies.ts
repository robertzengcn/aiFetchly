import Cookies from 'js-cookie'

// App
const sidebarStatusKey = 'sidebar_status'
export const getSidebarStatus = () => Cookies.get(sidebarStatusKey)
export const setSidebarStatus = (sidebarStatus: string) => Cookies.set(sidebarStatusKey, sidebarStatus)

const languageKey = 'language'
const getStoredLanguage = (): string | undefined => {
    try {
        if (typeof localStorage === 'undefined') {
            return undefined
        }
        return localStorage.getItem(languageKey) || undefined
    } catch (error) {
        console.warn('Failed to read language from localStorage:', error)
        return undefined
    }
}
export const getLanguage = (): string | undefined => {
    return getStoredLanguage() || Cookies.get(languageKey)
}
export const setLanguage = (language: string): void => {
    Cookies.set(languageKey, language, { expires: 365 })
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(languageKey, language)
        }
    } catch (error) {
        console.warn('Failed to save language to localStorage:', error)
    }
}

const sizeKey = 'size'
export const getSize = () => Cookies.get(sizeKey)
export const setSize = (size: string) => Cookies.set(sizeKey, size)

// User
const tokenKey = 'admin_access_token'
export const getToken = () => Cookies.get(tokenKey)
export const setToken = (token: string) => Cookies.set(tokenKey, token)
export const removeToken = () => Cookies.remove(tokenKey)
