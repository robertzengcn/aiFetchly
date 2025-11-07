import { windowInvoke } from '@/views/utils/apirequest'
import { LANGUAGE_PREFERENCE_GET, LANGUAGE_PREFERENCE_UPDATE } from '@/config/channellist'

/**
 * Get the current language preference from system settings
 * @returns Promise<string> - The current language code (e.g., 'en', 'zh')
 */
export async function getLanguagePreference(): Promise<string> {
    try {
        const result = await windowInvoke(LANGUAGE_PREFERENCE_GET);
        return result || 'en'; // Default to English if no result
    } catch (error) {
        console.error('Error getting language preference:', error);
        return 'en'; // Default fallback
    }
}

/**
 * Update the language preference in system settings
 * @param language - The language code to set (e.g., 'en', 'zh')
 * @returns Promise<boolean> - True if successful, false otherwise
 */
export async function updateLanguagePreference(language: string): Promise<boolean> {
    try {
        // Validate language code
        const validLanguages = ['en', 'zh'];
        if (!validLanguages.includes(language)) {
            console.error('Invalid language code:', language);
            return false;
        }

        const result = await windowInvoke(LANGUAGE_PREFERENCE_UPDATE, { language });
        console.log(result)
        return result === true;
    } catch (error) {
        console.error('Error updating language preference:', error);
        return false;
    }
}

/**
 * Language preference types
 */
export type LanguageCode = 'en' | 'zh';

export interface LanguagePreference {
    code: LanguageCode;
    label: string;
    description: string;
}

/**
 * Available language options
 */
export const LANGUAGE_OPTIONS: LanguagePreference[] = [
    {
        code: 'en',
        label: 'English',
        description: 'English language'
    },
    {
        code: 'zh',
        label: '中文',
        description: 'Chinese language'
    }
];

/**
 * Get language preference object by code
 * @param code - The language code
 * @returns LanguagePreference | undefined
 */
export function getLanguagePreferenceByCode(code: string): LanguagePreference | undefined {
    return LANGUAGE_OPTIONS.find(option => option.code === code);
}

/**
 * Check if a language code is valid
 * @param code - The language code to validate
 * @returns boolean
 */
export function isValidLanguageCode(code: string): code is LanguageCode {
    return LANGUAGE_OPTIONS.some(option => option.code === code);
}
