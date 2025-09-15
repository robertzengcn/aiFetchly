import { LANGUAGE_OPTIONS, LanguageCode } from '@/views/api/language';

/**
 * Browser language detection utilities
 */

export interface BrowserLanguageDetection {
    detectedLanguage: LanguageCode | null;
    confidence: number;
    browserLanguages: string[];
    supportedLanguages: LanguageCode[];
}

/**
 * Detect browser language and find the best match
 * @returns BrowserLanguageDetection
 */
export function detectBrowserLanguage(): BrowserLanguageDetection {
    const supportedLanguages: LanguageCode[] = ['en', 'zh'];
    const browserLanguages = getBrowserLanguages();
    
    // Check for exact matches first
    for (const browserLang of browserLanguages) {
        const exactMatch = supportedLanguages.find(lang => 
            browserLang.toLowerCase() === lang.toLowerCase()
        );
        if (exactMatch) {
            return {
                detectedLanguage: exactMatch,
                confidence: 1.0,
                browserLanguages,
                supportedLanguages
            };
        }
    }
    
    // Check for partial matches (e.g., 'en-US' matches 'en')
    for (const browserLang of browserLanguages) {
        for (const supportedLang of supportedLanguages) {
            if (browserLang.toLowerCase().startsWith(supportedLang.toLowerCase())) {
                return {
                    detectedLanguage: supportedLang,
                    confidence: 0.8,
                    browserLanguages,
                    supportedLanguages
                };
            }
        }
    }
    
    // Check for language family matches (e.g., 'zh-CN' matches 'zh')
    for (const browserLang of browserLanguages) {
        const langFamily = browserLang.split('-')[0].toLowerCase();
        const familyMatch = supportedLanguages.find(lang => 
            lang.toLowerCase() === langFamily
        );
        if (familyMatch) {
            return {
                detectedLanguage: familyMatch,
                confidence: 0.6,
                browserLanguages,
                supportedLanguages
            };
        }
    }
    
    return {
        detectedLanguage: null,
        confidence: 0,
        browserLanguages,
        supportedLanguages
    };
}

/**
 * Get all browser languages in order of preference
 * @returns string[] - Array of language codes
 */
function getBrowserLanguages(): string[] {
    const languages: string[] = [];
    
    // Primary language
    if (navigator.language) {
        languages.push(navigator.language);
    }
    
    // Additional languages
    if (navigator.languages) {
        languages.push(...navigator.languages);
    }
    
    // Remove duplicates while preserving order
    return [...new Set(languages)];
}

/**
 * Check if this is the user's first visit
 * @returns boolean
 */
export function isFirstVisit(): boolean {
    try {
        // Check if language preference exists in cookies
        const cookieLanguage = document.cookie
            .split('; ')
            .find(row => row.startsWith('language='));
        
        // Check if language preference exists in localStorage
        const localStorageLanguage = localStorage.getItem('language');
        
        // Check if language preference exists in sessionStorage
        const sessionStorageLanguage = sessionStorage.getItem('language');
        
        return !cookieLanguage && !localStorageLanguage && !sessionStorageLanguage;
    } catch (error) {
        console.warn('Error checking first visit status:', error);
        return true; // Assume first visit if we can't determine
    }
}

/**
 * Show language selection dialog for new users
 * @param detectedLanguage - The detected browser language
 * @param onLanguageSelected - Callback when user selects a language
 */
export function showLanguageSelectionDialog(
    detectedLanguage: LanguageCode | null,
    onLanguageSelected: (language: LanguageCode) => void
): void {
    // Create a simple language selection dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        padding: 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        max-width: 400px;
        width: 90%;
        text-align: center;
    `;
    
    const title = document.createElement('h2');
    title.textContent = 'Select Language / 选择语言';
    title.style.cssText = `
        margin: 0 0 1rem 0;
        color: #333;
        font-size: 1.5rem;
    `;
    
    const subtitle = document.createElement('p');
    subtitle.textContent = detectedLanguage 
        ? `We detected your language: ${LANGUAGE_OPTIONS.find(opt => opt.code === detectedLanguage)?.label || detectedLanguage}`
        : 'Please select your preferred language:';
    subtitle.style.cssText = `
        margin: 0 0 1.5rem 0;
        color: #666;
        font-size: 1rem;
    `;
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 1rem;
        justify-content: center;
        flex-wrap: wrap;
    `;
    
    // Create language buttons
    LANGUAGE_OPTIONS.forEach(option => {
        const button = document.createElement('button');
        button.textContent = option.label;
        button.style.cssText = `
            padding: 0.75rem 1.5rem;
            border: 2px solid #007bff;
            background: ${detectedLanguage === option.code ? '#007bff' : 'white'};
            color: ${detectedLanguage === option.code ? 'white' : '#007bff'};
            border-radius: 4px;
            cursor: pointer;
            font-size: 1rem;
            transition: all 0.2s;
            min-width: 120px;
        `;
        
        button.addEventListener('mouseenter', () => {
            if (detectedLanguage !== option.code) {
                button.style.background = '#f8f9fa';
            }
        });
        
        button.addEventListener('mouseleave', () => {
            if (detectedLanguage !== option.code) {
                button.style.background = 'white';
            }
        });
        
        button.addEventListener('click', () => {
            onLanguageSelected(option.code);
            document.body.removeChild(dialog);
        });
        
        buttonContainer.appendChild(button);
    });
    
    content.appendChild(title);
    content.appendChild(subtitle);
    content.appendChild(buttonContainer);
    dialog.appendChild(content);
    
    document.body.appendChild(dialog);
}

/**
 * Auto-select language based on browser detection
 * @param onLanguageSelected - Callback when language is selected
 * @returns boolean - True if language was auto-selected, false if user needs to choose
 */
export function autoSelectLanguage(
    onLanguageSelected: (language: LanguageCode) => void
): boolean {
    const detection = detectBrowserLanguage();
    
    if (detection.detectedLanguage && detection.confidence >= 0.6) {
        console.log(`Auto-selecting language: ${detection.detectedLanguage} (confidence: ${detection.confidence})`);
        onLanguageSelected(detection.detectedLanguage);
        return true;
    }
    
    return false;
}

/**
 * Initialize language detection for new users
 * @param onLanguageSelected - Callback when language is selected
 */
export function initializeLanguageDetection(
    onLanguageSelected: (language: LanguageCode) => void
): void {
    if (!isFirstVisit()) {
        return; // Not a first visit, skip detection
    }
    
    // Try to auto-select first
    const autoSelected = autoSelectLanguage(onLanguageSelected);
    console.log("autoSelected",autoSelected)
    // If auto-selection failed, show dialog
    if (!autoSelected) {
        const detection = detectBrowserLanguage();
        showLanguageSelectionDialog(detection.detectedLanguage, onLanguageSelected);
    }
}




