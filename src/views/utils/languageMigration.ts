import { getLanguage } from '@/views/utils/cookies'
import { getLanguagePreference, updateLanguagePreference } from '@/views/api/language'
import { language_preference } from '@/config/settinggroupInit'

/**
 * Language preference migration utilities
 */

export interface MigrationResult {
    success: boolean;
    migrated: boolean;
    fromValue: string | null;
    toValue: string | null;
    error?: string;
    timestamp: number;
}

export interface MigrationLog {
    version: string;
    timestamp: number;
    results: MigrationResult[];
    totalMigrated: number;
    totalErrors: number;
}

/**
 * Check if migration is needed
 * @returns Promise<boolean>
 */
export async function isMigrationNeeded(): Promise<boolean> {
    try {
        // Check if there's a cookie-based language preference
        const cookieLanguage = getLanguage()
        
        if (!cookieLanguage) {
            return false // No cookie language to migrate
        }
        
        // Check if system settings already have a language preference
        const systemLanguage = await getLanguagePreference()
        
        // If system settings has a different language than cookies, migration is needed
        return systemLanguage !== cookieLanguage
    } catch (error) {
        console.warn('Error checking migration status:', error)
        return false
    }
}

/**
 * Migrate language preference from cookies to system settings
 * @returns Promise<MigrationResult>
 */
export async function migrateLanguagePreference(): Promise<MigrationResult> {
    const timestamp = Date.now()
    
    try {
        // Get current cookie language
        const cookieLanguage = getLanguage()
        
        if (!cookieLanguage) {
            return {
                success: true,
                migrated: false,
                fromValue: null,
                toValue: null,
                timestamp
            }
        }
        
        // Check current system settings language
        const currentSystemLanguage = await getLanguagePreference()
        
        // If they're the same, no migration needed
        if (currentSystemLanguage === cookieLanguage) {
            return {
                success: true,
                migrated: false,
                fromValue: cookieLanguage,
                toValue: currentSystemLanguage,
                timestamp
            }
        }
        
        // Migrate cookie language to system settings
        const success = await updateLanguagePreference(cookieLanguage)
        
        if (success) {
            console.log(`Language preference migrated from cookies to system settings: ${cookieLanguage}`)
            
            return {
                success: true,
                migrated: true,
                fromValue: cookieLanguage,
                toValue: cookieLanguage,
                timestamp
            }
        } else {
            throw new Error('Failed to update system settings with cookie language')
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('Language migration failed:', errorMessage)
        
        return {
            success: false,
            migrated: false,
            fromValue: getLanguage(),
            toValue: null,
            error: errorMessage,
            timestamp
        }
    }
}

/**
 * Perform complete language migration with logging
 * @returns Promise<MigrationLog>
 */
export async function performLanguageMigration(): Promise<MigrationLog> {
    const timestamp = Date.now()
    const version = '1.0.0'
    const results: MigrationResult[] = []
    
    console.log('Starting language preference migration...')
    
    try {
        // Check if migration is needed
        const needsMigration = await isMigrationNeeded()
        
        if (!needsMigration) {
            console.log('No language migration needed')
            return {
                version,
                timestamp,
                results,
                totalMigrated: 0,
                totalErrors: 0
            }
        }
        
        // Perform migration
        const result = await migrateLanguagePreference()
        results.push(result)
        
        const totalMigrated = result.migrated ? 1 : 0
        const totalErrors = result.success ? 0 : 1
        
        console.log(`Language migration completed. Migrated: ${totalMigrated}, Errors: ${totalErrors}`)
        
        return {
            version,
            timestamp,
            results,
            totalMigrated,
            totalErrors
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('Migration process failed:', errorMessage)
        
        results.push({
            success: false,
            migrated: false,
            fromValue: getLanguage(),
            toValue: null,
            error: errorMessage,
            timestamp
        })
        
        return {
            version,
            timestamp,
            results,
            totalMigrated: 0,
            totalErrors: 1
        }
    }
}

/**
 * Save migration log to localStorage
 * @param log - Migration log to save
 */
export function saveMigrationLog(log: MigrationLog): void {
    try {
        const key = 'language_migration_log'
        const existingLogs = getMigrationLogs()
        existingLogs.push(log)
        
        // Keep only the last 10 migration logs
        const recentLogs = existingLogs.slice(-10)
        
        localStorage.setItem(key, JSON.stringify(recentLogs))
        console.log('Migration log saved')
    } catch (error) {
        console.warn('Failed to save migration log:', error)
    }
}

/**
 * Get migration logs from localStorage
 * @returns MigrationLog[]
 */
export function getMigrationLogs(): MigrationLog[] {
    try {
        const key = 'language_migration_log'
        const logsJson = localStorage.getItem(key)
        
        if (!logsJson) {
            return []
        }
        
        return JSON.parse(logsJson)
    } catch (error) {
        console.warn('Failed to load migration logs:', error)
        return []
    }
}

/**
 * Check if migration has been performed recently
 * @param hoursThreshold - Hours threshold for recent migration (default: 24)
 * @returns boolean
 */
export function hasRecentMigration(hoursThreshold: number = 24): boolean {
    try {
        const logs = getMigrationLogs()
        const now = Date.now()
        const threshold = hoursThreshold * 60 * 60 * 1000 // Convert to milliseconds
        
        return logs.some(log => (now - log.timestamp) < threshold)
    } catch (error) {
        console.warn('Error checking recent migration:', error)
        return false
    }
}

/**
 * Initialize language migration on app startup
 * @returns Promise<void>
 */
export async function initializeLanguageMigration(): Promise<void> {
    try {
        // Skip if migration was performed recently
        if (hasRecentMigration(24)) {
            console.log('Skipping language migration - performed recently')
            return
        }
        
        // Check if migration is needed
        const needsMigration = await isMigrationNeeded()
        
        if (!needsMigration) {
            console.log('No language migration needed')
            return
        }
        
        console.log('Performing language preference migration...')
        
        // Perform migration
        const log = await performLanguageMigration()
        
        // Save migration log
        saveMigrationLog(log)
        
        if (log.totalMigrated > 0) {
            console.log(`Language migration completed successfully. Migrated ${log.totalMigrated} preferences.`)
        } else if (log.totalErrors > 0) {
            console.warn(`Language migration completed with ${log.totalErrors} errors.`)
        }
    } catch (error) {
        console.error('Language migration initialization failed:', error)
    }
}




