import { getLanguagePreference, updateLanguagePreference } from '@/views/api/language'
import { getLanguage, setLanguage } from '@/views/utils/cookies'

/**
 * Language preference synchronization utilities
 */

export interface SyncEvent {
    type: 'language_changed' | 'conflict_detected' | 'sync_completed'
    timestamp: number
    oldValue?: string
    newValue?: string
    source: 'local' | 'remote' | 'system'
    conflictResolution?: 'local_wins' | 'remote_wins' | 'user_choice'
}

export interface SyncState {
    lastSyncTime: number
    lastKnownValue: string
    pendingChanges: boolean
    conflictDetected: boolean
}

/**
 * Language synchronization manager
 */
export class LanguageSynchronizer {
    private syncInterval: number | null = null
    private syncState: SyncState
    private eventListeners: ((event: SyncEvent) => void)[] = []
    private readonly SYNC_INTERVAL = 5000 // 5 seconds
    private readonly CONFLICT_THRESHOLD = 10000 // 10 seconds

    constructor() {
        this.syncState = {
            lastSyncTime: 0,
            lastKnownValue: 'en',
            pendingChanges: false,
            conflictDetected: false
        }
    }

    /**
     * Start automatic synchronization
     */
    startSync(): void {
        if (this.syncInterval) {
            return // Already running
        }

        console.log('Starting language synchronization...')
        
        // Initial sync
        this.performSync()
        
        // Set up interval
        this.syncInterval = window.setInterval(() => {
            this.performSync()
        }, this.SYNC_INTERVAL)
    }

    /**
     * Stop automatic synchronization
     */
    stopSync(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval)
            this.syncInterval = null
            console.log('Language synchronization stopped')
        }
    }

    /**
     * Add event listener for sync events
     */
    addEventListener(listener: (event: SyncEvent) => void): void {
        this.eventListeners.push(listener)
    }

    /**
     * Remove event listener
     */
    removeEventListener(listener: (event: SyncEvent) => void): void {
        const index = this.eventListeners.indexOf(listener)
        if (index > -1) {
            this.eventListeners.splice(index, 1)
        }
    }

    /**
     * Emit sync event to all listeners
     */
    private emitEvent(event: SyncEvent): void {
        this.eventListeners.forEach(listener => {
            try {
                listener(event)
            } catch (error) {
                console.error('Error in sync event listener:', error)
            }
        })
    }

    /**
     * Perform synchronization check
     */
    private async performSync(): Promise<void> {
        try {
            const currentSystemLanguage = await getLanguagePreference()
            const currentCookieLanguage = getLanguage()
            
            // Check for conflicts
            if (this.syncState.lastKnownValue !== currentSystemLanguage) {
                await this.handleConflict(currentSystemLanguage, currentCookieLanguage)
                return
            }
            
            // Check if local changes need to be synced
            if (currentCookieLanguage !== currentSystemLanguage) {
                await this.syncLocalToRemote(currentCookieLanguage)
            }
            
            // Update sync state
            this.syncState.lastSyncTime = Date.now()
            this.syncState.lastKnownValue = currentSystemLanguage
            this.syncState.pendingChanges = false
            
        } catch (error) {
            console.error('Sync error:', error)
        }
    }

    /**
     * Handle conflict between local and remote values
     */
    private async handleConflict(systemLanguage: string, cookieLanguage: string): Promise<void> {
        console.log(`Language conflict detected: system=${systemLanguage}, local=${cookieLanguage}`)
        
        this.syncState.conflictDetected = true
        
        // Emit conflict event
        this.emitEvent({
            type: 'conflict_detected',
            timestamp: Date.now(),
            oldValue: this.syncState.lastKnownValue,
            newValue: systemLanguage,
            source: 'remote'
        })
        
        // Resolve conflict based on timestamp and user preference
        const resolution = await this.resolveConflict(systemLanguage, cookieLanguage)
        
        if (resolution === 'remote_wins') {
            // Update local to match remote
            await this.syncRemoteToLocal(systemLanguage)
        } else if (resolution === 'local_wins') {
            // Update remote to match local
            await this.syncLocalToRemote(cookieLanguage)
        }
        
        this.syncState.conflictDetected = false
    }

    /**
     * Resolve conflict between local and remote values
     */
    private async resolveConflict(systemLanguage: string, cookieLanguage: string): Promise<'local_wins' | 'remote_wins' | 'user_choice'> {
        // For now, use a simple strategy: remote wins if it's different from default
        // In a real application, you might want to show a dialog to the user
        
        if (systemLanguage !== 'en' && cookieLanguage === 'en') {
            return 'remote_wins'
        } else if (cookieLanguage !== 'en' && systemLanguage === 'en') {
            return 'local_wins'
        } else {
            // Both are non-default, prefer remote (system settings)
            return 'remote_wins'
        }
    }

    /**
     * Sync local changes to remote
     */
    private async syncLocalToRemote(localLanguage: string): Promise<void> {
        try {
            console.log(`Syncing local language to remote: ${localLanguage}`)
            
            const success = await updateLanguagePreference(localLanguage)
            
            if (success) {
                this.syncState.lastKnownValue = localLanguage
                this.syncState.pendingChanges = false
                
                this.emitEvent({
                    type: 'sync_completed',
                    timestamp: Date.now(),
                    newValue: localLanguage,
                    source: 'local'
                })
            } else {
                console.warn('Failed to sync local language to remote')
            }
        } catch (error) {
            console.error('Error syncing local to remote:', error)
        }
    }

    /**
     * Sync remote changes to local
     */
    private async syncRemoteToLocal(remoteLanguage: string): Promise<void> {
        try {
            console.log(`Syncing remote language to local: ${remoteLanguage}`)
            
            setLanguage(remoteLanguage)
            this.syncState.lastKnownValue = remoteLanguage
            
            this.emitEvent({
                type: 'language_changed',
                timestamp: Date.now(),
                newValue: remoteLanguage,
                source: 'remote'
            })
        } catch (error) {
            console.error('Error syncing remote to local:', error)
        }
    }

    /**
     * Force immediate synchronization
     */
    async forceSync(): Promise<void> {
        await this.performSync()
    }

    /**
     * Get current sync state
     */
    getSyncState(): SyncState {
        return { ...this.syncState }
    }

    /**
     * Check if synchronization is active
     */
    isActive(): boolean {
        return this.syncInterval !== null
    }
}

// Global synchronizer instance
let globalSynchronizer: LanguageSynchronizer | null = null

/**
 * Get the global language synchronizer instance
 */
export function getLanguageSynchronizer(): LanguageSynchronizer {
    if (!globalSynchronizer) {
        globalSynchronizer = new LanguageSynchronizer()
    }
    return globalSynchronizer
}

/**
 * Initialize language synchronization
 */
export function initializeLanguageSynchronization(): void {
    const synchronizer = getLanguageSynchronizer()
    
    if (!synchronizer.isActive()) {
        synchronizer.startSync()
        
        // Add event listeners for debugging and user feedback
        synchronizer.addEventListener((event) => {
            console.log('Language sync event:', event)
            
            // You can add UI notifications here
            switch (event.type) {
                case 'language_changed':
                    console.log(`Language changed to: ${event.newValue}`)
                    break
                case 'conflict_detected':
                    console.warn('Language conflict detected, resolving...')
                    break
                case 'sync_completed':
                    console.log('Language synchronization completed')
                    break
            }
        })
    }
}

/**
 * Stop language synchronization
 */
export function stopLanguageSynchronization(): void {
    const synchronizer = getLanguageSynchronizer()
    synchronizer.stopSync()
}

/**
 * Force immediate language synchronization
 */
export async function forceLanguageSync(): Promise<void> {
    const synchronizer = getLanguageSynchronizer()
    await synchronizer.forceSync()
}




