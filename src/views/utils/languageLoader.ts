import { getLanguagePreference } from '@/views/api/language'
import { getLanguage } from '@/views/utils/cookies'

/**
 * Language loading utility functions
 */

export interface LanguageLoadResult {
    language: string;
    source: 'system_settings' | 'cookies' | 'browser' | 'default';
    success: boolean;
    error?: string;
}

/**
 * Load language preference with fallback chain
 * Priority: System Settings -> Cookies -> Browser -> Default
 * @returns Promise<LanguageLoadResult>
 */
export async function loadLanguagePreference(): Promise<LanguageLoadResult> {
    try {
        // First try: System Settings
        const systemLanguage = await getLanguagePreference()
        if (systemLanguage && systemLanguage !== 'en') {
            return {
                language: systemLanguage,
                source: 'system_settings',
                success: true
            }
        }
    } catch (error) {
        console.warn('Failed to load language from system settings:', error)
    }

    try {
        // Second try: Cookies
        const cookieLanguage = getLanguage()
        if (cookieLanguage) {
            return {
                language: cookieLanguage,
                source: 'cookies',
                success: true
            }
        }
    } catch (error) {
        console.warn('Failed to load language from cookies:', error)
    }

    try {
        // Third try: Browser language
        const browserLanguage = navigator.language.toLowerCase()
        const supportedLanguages = ['en', 'zh']
        
        for (const lang of supportedLanguages) {
            if (browserLanguage.indexOf(lang) > -1) {
                return {
                    language: lang,
                    source: 'browser',
                    success: true
                }
            }
        }
    } catch (error) {
        console.warn('Failed to detect browser language:', error)
    }

    // Final fallback: Default
    return {
        language: 'en',
        source: 'default',
        success: true
    }
}

/**
 * Load language preference with error handling and logging
 * @param onSuccess - Callback when language is loaded successfully
 * @param onError - Callback when language loading fails
 * @returns Promise<string> - The loaded language code
 */
export async function loadLanguagePreferenceWithCallbacks(
    onSuccess?: (result: LanguageLoadResult) => void,
    onError?: (error: string) => void
): Promise<string> {
    try {
        const result = await loadLanguagePreference()
        
        if (result.success) {
            console.log(`Language loaded from ${result.source}: ${result.language}`)
            onSuccess?.(result)
            return result.language
        } else {
            const errorMsg = result.error || 'Unknown error loading language'
            console.error('Language loading failed:', errorMsg)
            onError?.(errorMsg)
            return 'en' // Fallback
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error('Language loading failed:', errorMsg)
        onError?.(errorMsg)
        return 'en' // Fallback
    }
}

/**
 * Check if a language code is supported
 * @param language - The language code to check
 * @returns boolean
 */
export function isLanguageSupported(language: string): boolean {
    const supportedLanguages = ['en', 'zh']
    return supportedLanguages.includes(language)
}

/**
 * Get the best available language from a list of preferences
 * @param preferences - Array of language preferences in order of preference
 * @returns string - The best available language code
 */
export function getBestAvailableLanguage(preferences: string[]): string {
    const supportedLanguages = ['en', 'zh']
    
    for (const preference of preferences) {
        if (supportedLanguages.includes(preference)) {
            return preference
        }
    }
    
    return 'en' // Default fallback
}

/**
 * Language loading constants
 */
export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const
export const DEFAULT_LANGUAGE = 'en'
export const LANGUAGE_SOURCES = {
    SYSTEM_SETTINGS: 'system_settings',
    COOKIES: 'cookies',
    BROWSER: 'browser',
    DEFAULT: 'default'
} as const



