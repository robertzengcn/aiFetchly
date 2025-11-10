/**
 * IPC message interface for communication between main and child processes
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface IPCMessage {
  type: 'START' | 'STOP' | 'PAUSE' | 'PROGRESS' | 'COMPLETED' | 'ERROR';
  taskId: number;
  data?: any;
  error?: string;
  progress?: ScrapingProgress;
}

/**
 * Scraping progress interface for tracking task progress
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */
export interface ScrapingProgress {
  currentPage: number;
  totalPages: number;
  resultsCount: number;
  percentage: number;
  estimatedTimeRemaining?: number;
} 