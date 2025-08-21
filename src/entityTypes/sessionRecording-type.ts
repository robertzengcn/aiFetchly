/**
 * Type definitions for Puppeteer Session Recording System
 * Used for AI training data collection
 */

export interface TrainingDataPoint {
  state: string; // DOM snapshot or simplified representation
  action: string; // Puppeteer action (e.g., "click('#search-submit')")
}

export interface SessionRecord {
  taskId: number;
  platform: string;
  keywords: string[];
  location: string;
  resultsCount: number;
  timestamp: Date;
  trainingData: TrainingDataPoint[];
  expectedOutput: any[];
  sessionFilePath: string;
}

export interface SessionMetadata {
  id: number;
  taskId: number;
  platform: string;
  keywords: string[];
  location: string;
  resultsCount: number;
  sessionFilePath: string;
  created_at: Date;
  status: 'pending' | 'completed' | 'failed';
  trainingDataPoints: number;
  fileSize: number;
}

export interface TrainingDataset {
  platform: string;
  totalSessions: number;
  totalTrainingPoints: number;
  averageResultsPerSession: number;
  dateRange: {
    start: Date;
    end: Date;
  };
  sessions: SessionRecord[];
}

export interface SessionRecordingConfig {
  enabled: boolean;
  minResultsThreshold: number; // Default: > 1
  maxFileSize: number; // MB
  compressionEnabled: boolean;
  autoCleanup: boolean;
  cleanupDays: number; // Days to keep old sessions
}

export interface SessionExportOptions {
  format: 'json' | 'csv' | 'openai' | 'huggingface';
  includeStates: boolean;
  includeExpectedOutput: boolean;
  filterByPlatform?: string;
  filterByDateRange?: {
    start: Date;
    end: Date;
  };
  filterByResultsCount?: {
    min: number;
    max: number;
  };
}
