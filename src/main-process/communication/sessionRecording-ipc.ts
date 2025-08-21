import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * IPC Handlers for Session Recording Management
 * 
 * Provides communication between main and renderer processes for:
 * - Toggling session recording
 * - Getting recording status
 * - Managing recorded sessions
 * - Exporting training data
 */

// Global recording state
let isRecordingEnabled: boolean = false;

// Sessions directory path
const sessionsDirectory = path.join(app.getPath('userData'), 'sessions');

/**
 * Register all session recording IPC handlers
 */
export function registerSessionRecordingIpcHandlers(): void {
    console.log('Registering session recording IPC handlers...');

    // Toggle session recording on/off
    ipcMain.handle('session-recording:toggle', async (event, enabled: boolean) => {
        try {
            isRecordingEnabled = enabled;
            console.log(`Session recording ${enabled ? 'enabled' : 'disabled'} via IPC`);
            
            // Save preference to config file
            await saveRecordingPreference(enabled);
            
            return { success: true, enabled };
        } catch (error) {
            console.error('Failed to toggle session recording:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    // Get current recording status
    ipcMain.handle('session-recording:get-status', async () => {
        try {
            // Load from config file to ensure consistency
            const config = await loadRecordingPreference();
            isRecordingEnabled = config.enabled;
            
            return { success: true, enabled: isRecordingEnabled };
        } catch (error) {
            console.error('Failed to get recording status:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    // Get list of recorded sessions
    ipcMain.handle('session-recording:get-sessions', async () => {
        try {
            const sessions = await getRecordedSessions();
            return { success: true, sessions };
        } catch (error) {
            console.error('Failed to get recorded sessions:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    // Export sessions for AI training
    ipcMain.handle('session-recording:export', async (event, options: any) => {
        try {
            const exportResult = await exportSessions(options);
            return { success: true, ...exportResult };
        } catch (error) {
            console.error('Failed to export sessions:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    // Clear old sessions
    ipcMain.handle('session-recording:clear', async (event, options: any) => {
        try {
            const clearResult = await clearOldSessions(options);
            return { success: true, ...clearResult };
        } catch (error) {
            console.error('Failed to clear old sessions:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    // Get sessions directory path
    ipcMain.handle('session-recording:get-directory', async () => {
        try {
            return { success: true, directory: sessionsDirectory };
        } catch (error) {
            console.error('Failed to get sessions directory:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });

    console.log('Session recording IPC handlers registered successfully');
}

/**
 * Save recording preference to config file
 */
async function saveRecordingPreference(enabled: boolean): Promise<void> {
    const configPath = path.join(app.getPath('userData'), 'session-recording-config.json');
    
    const config = {
        enabled,
        lastUpdated: new Date().toISOString(),
        sessionsDirectory
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Load recording preference from config file
 */
async function loadRecordingPreference(): Promise<{ enabled: boolean }> {
    const configPath = path.join(app.getPath('userData'), 'session-recording-config.json');
    
    if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        return { enabled: config.enabled || false };
    }
    
    // Default to disabled if no config exists
    return { enabled: false };
}

/**
 * Get list of recorded sessions
 */
async function getRecordedSessions(): Promise<any[]> {
    if (!fs.existsSync(sessionsDirectory)) {
        return [];
    }

    const sessions: any[] = [];
    
    // Walk through sessions directory
    const platforms = fs.readdirSync(sessionsDirectory);
    
    for (const platform of platforms) {
        const platformPath = path.join(sessionsDirectory, platform);
        const platformStat = fs.statSync(platformPath);
        
        if (platformStat.isDirectory()) {
            const dates = fs.readdirSync(platformPath);
            
            for (const date of dates) {
                const datePath = path.join(platformPath, date);
                const dateStat = fs.statSync(datePath);
                
                if (dateStat.isDirectory()) {
                    const sessionFiles = fs.readdirSync(datePath).filter(file => file.endsWith('_session.json'));
                    
                    for (const sessionFile of sessionFiles) {
                        const sessionPath = path.join(datePath, sessionFile);
                        try {
                            const sessionData = fs.readFileSync(sessionPath, 'utf8');
                            const session = JSON.parse(sessionData);
                            
                            // Add file metadata
                            const fileStat = fs.statSync(sessionPath);
                            session.fileSize = fileStat.size;
                            session.filePath = sessionPath;
                            session.platform = platform;
                            session.date = date;
                            
                            sessions.push(session);
                        } catch (error) {
                            console.error(`Failed to read session file ${sessionPath}:`, error);
                        }
                    }
                }
            }
        }
    }
    
    // Sort by timestamp (newest first)
    sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return sessions;
}

/**
 * Export sessions for AI training
 */
async function exportSessions(options: any): Promise<any> {
    const { format = 'json', includeStates = true, includeExpectedOutput = true } = options;
    
    const sessions = await getRecordedSessions();
    let exportData: any;
    
    switch (format) {
        case 'json':
            exportData = sessions.map(session => ({
                platform: session.platform,
                taskId: session.taskId,
                keywords: session.keywords,
                location: session.location,
                resultsCount: session.resultsCount,
                timestamp: session.timestamp,
                trainingData: includeStates ? session.trainingData : [],
                expectedOutput: includeExpectedOutput ? session.expectedOutput : []
            }));
            break;
            
        case 'csv':
            // Simple CSV export for analysis
            exportData = sessions.map(session => ({
                platform: session.platform,
                taskId: session.taskId,
                keywords: session.keywords.join(', '),
                location: session.location,
                resultsCount: session.resultsCount,
                timestamp: session.timestamp,
                trainingDataPoints: session.trainingData?.length || 0
            }));
            break;
            
        case 'openai':
            // Format for OpenAI fine-tuning
            exportData = sessions.flatMap(session => 
                session.trainingData?.map((point: any) => ({
                    messages: [
                        { role: "user", content: `Given this HTML state: ${point.state}` },
                        { role: "assistant", content: `Perform this action: ${point.action}` }
                    ]
                })) || []
            );
            break;
            
        default:
            throw new Error(`Unsupported export format: ${format}`);
    }
    
    // Save export file
    const exportPath = path.join(sessionsDirectory, `export_${format}_${Date.now()}.${format === 'csv' ? 'csv' : 'json'}`);
    
    if (format === 'csv') {
        // Convert to CSV format
        const headers = Object.keys(exportData[0] || {}).join(',');
        const rows = exportData.map(row => Object.values(row).map(val => `"${val}"`).join(','));
        const csvContent = [headers, ...rows].join('\n');
        fs.writeFileSync(exportPath, csvContent);
    } else {
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
    }
    
    return {
        exportedSessions: sessions.length,
        exportPath,
        format
    };
}

/**
 * Clear old sessions based on criteria
 */
async function clearOldSessions(options: any): Promise<any> {
    const { daysOld = 30, maxSessions = 1000 } = options;
    
    const sessions = await getRecordedSessions();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let deletedCount = 0;
    let deletedSize = 0;
    
    for (const session of sessions) {
        const sessionDate = new Date(session.timestamp);
        
        if (sessionDate < cutoffDate || deletedCount >= maxSessions) {
            try {
                const fileSize = session.fileSize || 0;
                fs.unlinkSync(session.filePath);
                deletedCount++;
                deletedSize += fileSize;
            } catch (error) {
                console.error(`Failed to delete session file ${session.filePath}:`, error);
            }
        }
    }
    
    return {
        deletedCount,
        deletedSize,
        remainingSessions: sessions.length - deletedCount
    };
}
