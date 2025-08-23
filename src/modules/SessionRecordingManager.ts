import { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface TrainingDataPoint {
  state: string; // DOM snapshot or simplified representation
  action: string; // Puppeteer action (e.g., "click('#search-submit')")
}

export interface DetailPageTrainingData {
  businessName: string;
  url: string;
  timestamp: string;
  pageMetadata: {
    title: string;
    description: string;
    keywords: string;
    viewport: string;
    language: string;
    timestamp: string;
  };
  pageStructure: {
    totalElements: number;
    bodyTextLength: number;
    hasForms: boolean;
    hasImages: boolean;
    hasLinks: boolean;
    structureInfo: Record<string, any>;
  };
  rawHtml: string;
  htmlLength: number;
  taskId: number;
  platform: string;
  keywords: string[];
  location: string;
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
  detailPageTrainingData?: DetailPageTrainingData[];
}

/**
 * Session Recording Manager for AI Training
 * 
 * Records successful Puppeteer scraping sessions to train AI models.
 * Only saves sessions when results > 1 are obtained.
 */
export class SessionRecordingManager {
  private isRecording: boolean = false;
  private currentSession: SessionRecord | null = null;
  private trainingData: TrainingDataPoint[] = [];
  private sessionsDirectory: string;

  constructor() {
    // Create sessions directory in user data path
    const userDataPath = app.getPath('userData');
    this.sessionsDirectory = path.join(userDataPath, 'sessions');
    this.ensureSessionsDirectory();
  }

  /**
   * Ensure sessions directory exists
   */
  private ensureSessionsDirectory(): void {
    try {
      if (!fs.existsSync(this.sessionsDirectory)) {
        fs.mkdirSync(this.sessionsDirectory, { recursive: true });
        console.log(`Created sessions directory: ${this.sessionsDirectory}`);
      }
    } catch (error) {
      console.error('Failed to create sessions directory:', error);
    }
  }

  /**
   * Start recording a new session
   */
  startSession(taskId: number, platform: string, keywords: string[], location: string): void {
    if (this.isRecording) {
      console.warn('Session recording already in progress, stopping previous session');
      this.endSession(0, []);
    }

    this.isRecording = true;
    this.trainingData = [];
    
    this.currentSession = {
      taskId,
      platform,
      keywords,
      location,
      resultsCount: 0,
      timestamp: new Date(),
      trainingData: [],
      expectedOutput: [],
      sessionFilePath: ''
    };

    console.log(`Started session recording for task ${taskId} on ${platform}`);
  }

  /**
   * Log an action with current page state
   */
  logAction(state: string, action: string): void {
    if (!this.isRecording || !this.currentSession) {
      return;
    }

    const trainingPoint: TrainingDataPoint = {
      state,
      action
    };

    this.trainingData.push(trainingPoint);
    console.log(`Logged action: ${action} (training data points: ${this.trainingData.length})`);
  }

  /**
   * Add detail page training data for AI model training
   * This method captures comprehensive detail page information for training purposes
   */
  addDetailPageTrainingData(data: DetailPageTrainingData): void {
    if (!this.isRecording || !this.currentSession) {
      return;
    }

    // Store detail page training data separately from regular action training data
    if (!this.currentSession.detailPageTrainingData) {
      this.currentSession.detailPageTrainingData = [];
    }

    this.currentSession.detailPageTrainingData.push(data);
    console.log(`Added detail page training data for: ${data.businessName} (total detail pages: ${this.currentSession.detailPageTrainingData.length})`);
  }

  /**
   * Capture current page state for training
   */
  async capturePageState(page: Page): Promise<string> {
    try {
      // Get simplified DOM representation for training
      const simplifiedState = await page.evaluate(() => {
        // Remove unnecessary elements and attributes for cleaner training data
        const clone = document.cloneNode(true) as Document;
        
        // Remove scripts, styles, and other non-essential elements
        const elementsToRemove = clone.querySelectorAll('script, style, noscript, iframe, img, video, audio');
        elementsToRemove.forEach(el => el.remove());
        
        // Remove event handlers and data attributes
        const allElements = clone.querySelectorAll('*');
        allElements.forEach(el => {
          const element = el as Element;
          // Remove event handlers
          element.removeAttribute('onclick');
          element.removeAttribute('onload');
          element.removeAttribute('onchange');
          element.removeAttribute('onsubmit');
          
          // Remove data attributes that might change
          element.removeAttribute('data-testid');
          element.removeAttribute('data-cy');
          element.removeAttribute('data-qa');
          
          // Keep class and id for element identification
        });
        
        return clone.documentElement.outerHTML;
      });

      return simplifiedState;
    } catch (error) {
      console.error('Failed to capture page state:', error);
      return '<error_capturing_state>';
    }
  }

  /**
   * End the current session and prepare for saving
   */
  async endSession(resultsCount: number, expectedOutput: any[]): Promise<boolean> {
    if (!this.isRecording || !this.currentSession) {
      return false;
    }

    this.currentSession.resultsCount = resultsCount;
    this.currentSession.expectedOutput = expectedOutput;
    this.currentSession.trainingData = [...this.trainingData];
    
    // Ensure detail page training data is preserved
    if (!this.currentSession.detailPageTrainingData) {
      this.currentSession.detailPageTrainingData = [];
    }

    this.isRecording = false;
    
    console.log(`Ended session recording with ${resultsCount} results and ${this.trainingData.length} training points`);
    return true;
  }

  /**
   * Save the session to file (only if results > 1)
   */
  async saveSession(): Promise<void> {
    if (!this.currentSession || this.currentSession.resultsCount <= 1) {
      console.log(`Session not saved: results count ${this.currentSession?.resultsCount} <= 1`);
      return;
    }

    try {
      // Create platform-specific directory
      const platformDir = path.join(this.sessionsDirectory, this.currentSession.platform);
      if (!fs.existsSync(platformDir)) {
        fs.mkdirSync(platformDir, { recursive: true });
      }

      // Create date-specific directory
      const dateStr = this.currentSession.timestamp.toISOString().split('T')[0];
      const dateDir = path.join(platformDir, dateStr);
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }

      // Generate filename
      const filename = `${this.currentSession.taskId}_${Date.now()}_session.json`;
      const filePath = path.join(dateDir, filename);
      
      // Update session file path
      this.currentSession.sessionFilePath = filePath;

      // Save session data
      const sessionData = {
        platform: this.currentSession.platform,
        taskId: this.currentSession.taskId,
        keywords: this.currentSession.keywords,
        location: this.currentSession.location,
        resultsCount: this.currentSession.resultsCount,
        timestamp: this.currentSession.timestamp.toISOString(),
        trainingData: this.currentSession.trainingData,
        expectedOutput: this.currentSession.expectedOutput,
        detailPageTrainingData: this.currentSession.detailPageTrainingData || []
      };

      fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
      
      console.log(`Session saved to: ${filePath}`);
      console.log(`Training data: ${this.currentSession.trainingData.length} points`);
      console.log(`Results: ${this.currentSession.resultsCount} items`);

    } catch (error) {
      console.error('Failed to save session:', error);
    } finally {
      // Clear current session
      this.currentSession = null;
      this.trainingData = [];
    }
  }

  /**
   * Check if recording is currently active
   */
  getRecordingStatus(): boolean {
    return this.isRecording;
  }

  /**
   * Get current session info
   */
  getCurrentSessionInfo(): Partial<SessionRecord> & { trainingDataPoints: number; detailPageTrainingDataPoints: number } | null {
    if (!this.currentSession) {
      return null;
    }

    return {
      taskId: this.currentSession.taskId,
      platform: this.currentSession.platform,
      resultsCount: this.currentSession.resultsCount,
      trainingDataPoints: this.trainingData.length,
      detailPageTrainingDataPoints: this.currentSession.detailPageTrainingData?.length || 0
    };
  }

  /**
   * Get sessions directory path
   */
  getSessionsDirectory(): string {
    return this.sessionsDirectory;
  }
}
