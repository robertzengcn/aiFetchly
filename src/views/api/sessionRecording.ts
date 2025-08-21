import { ipcRenderer } from 'electron';

/**
 * Frontend API functions for Session Recording Management
 * 
 * Provides easy-to-use functions for the renderer process to:
 * - Control session recording
 * - Manage recorded sessions
 * - Export training data
 */

export interface SessionRecordingStatus {
  success: boolean;
  enabled: boolean;
  error?: string;
}

export interface SessionInfo {
  platform: string;
  taskId: number;
  keywords: string[];
  location: string;
  resultsCount: number;
  timestamp: string;
  trainingData: any[];
  expectedOutput: any[];
  fileSize: number;
  filePath: string;
  date: string;
}

export interface ExportOptions {
  format: 'json' | 'csv' | 'openai';
  includeStates?: boolean;
  includeExpectedOutput?: boolean;
}

export interface ExportResult {
  success: boolean;
  exportedSessions: number;
  exportPath: string;
  format: string;
  error?: string;
}

export interface ClearOptions {
  daysOld?: number;
  maxSessions?: number;
}

export interface ClearResult {
  success: boolean;
  deletedCount: number;
  deletedSize: number;
  remainingSessions: number;
  error?: string;
}

/**
 * Toggle session recording on/off
 */
export async function toggleSessionRecording(enabled: boolean): Promise<SessionRecordingStatus> {
  try {
    const result = await ipcRenderer.invoke('session-recording:toggle', enabled);
    return result;
  } catch (error) {
    console.error('Failed to toggle session recording:', error);
    return {
      success: false,
      enabled: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get current session recording status
 */
export async function getSessionRecordingStatus(): Promise<SessionRecordingStatus> {
  try {
    const result = await ipcRenderer.invoke('session-recording:get-status');
    return result;
  } catch (error) {
    console.error('Failed to get session recording status:', error);
    return {
      success: false,
      enabled: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get list of all recorded sessions
 */
export async function getRecordedSessions(): Promise<{ success: boolean; sessions: SessionInfo[]; error?: string }> {
  try {
    const result = await ipcRenderer.invoke('session-recording:get-sessions');
    return result;
  } catch (error) {
    console.error('Failed to get recorded sessions:', error);
    return {
      success: false,
      sessions: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Export sessions for AI training
 */
export async function exportSessions(options: ExportOptions): Promise<ExportResult> {
  try {
    const result = await ipcRenderer.invoke('session-recording:export', options);
    return result;
  } catch (error) {
    console.error('Failed to export sessions:', error);
    return {
      success: false,
      exportedSessions: 0,
      exportPath: '',
      format: options.format,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Clear old sessions
 */
export async function clearOldSessions(options: ClearOptions = {}): Promise<ClearResult> {
  try {
    const result = await ipcRenderer.invoke('session-recording:clear', options);
    return result;
  } catch (error) {
    console.error('Failed to clear old sessions:', error);
    return {
      success: false,
      deletedCount: 0,
      deletedSize: 0,
      remainingSessions: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get sessions directory path
 */
export async function getSessionsDirectory(): Promise<{ success: boolean; directory: string; error?: string }> {
  try {
    const result = await ipcRenderer.invoke('session-recording:get-directory');
    return result;
  } catch (error) {
    console.error('Failed to get sessions directory:', error);
    return {
      success: false,
      directory: '',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Utility function to format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Utility function to format timestamp
 */
export function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch (error) {
    return timestamp;
  }
}

/**
 * Utility function to get session statistics
 */
export function getSessionStatistics(sessions: SessionInfo[]) {
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      totalTrainingPoints: 0,
      averageResultsPerSession: 0,
      totalFileSize: 0,
      platforms: [],
      dateRange: { start: null, end: null }
    };
  }

  const totalTrainingPoints = sessions.reduce((sum, session) => 
    sum + (session.trainingData?.length || 0), 0
  );
  
  const totalFileSize = sessions.reduce((sum, session) => 
    sum + session.fileSize, 0
  );
  
  const platforms = [...new Set(sessions.map(s => s.platform))];
  
  const timestamps = sessions.map(s => new Date(s.timestamp).getTime());
  const dateRange = {
    start: new Date(Math.min(...timestamps)),
    end: new Date(Math.max(...timestamps))
  };

  return {
    totalSessions: sessions.length,
    totalTrainingPoints,
    averageResultsPerSession: sessions.reduce((sum, s) => sum + s.resultsCount, 0) / sessions.length,
    totalFileSize,
    platforms,
    dateRange
  };
}
