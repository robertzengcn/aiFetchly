export type ProcessMessage<type> = {
    action: string,
    data?:type
}

/**
 * AI Recovery Request - Sent from child process to main process
 * Contains page state and error context for AI analysis
 */
export interface AIRecoveryRequest {
    requestId: string;          // Unique ID to match request/response
    operation: string;          // 'search_input' | 'parse_results' | 'next_page' | 'wait_results'
    searchEngine: string;       // 'google' | 'bing' | 'baidu' etc.
    currentUrl: string;
    pageTitle: string;
    errorMessage: string;
    attemptedSelectors: string[];
    screenshot?: string;        // Base64 encoded (optional, for vision models)
    htmlSample: string;         // Cleaned/truncated HTML (max ~10KB)
    accessibilityTree?: string; // For finding interactive elements
    keyword?: string;           // Current search keyword if applicable
}

/**
 * AI Recovery Response - Sent from main process to child process
 * Contains AI-suggested recovery actions
 */
export interface AIRecoveryResponse {
    requestId: string;
    success: boolean;
    actions: AIRecoveryAction[];
    confidence: number;         // 0-1
    reasoning: string;
    error?: string;
}

/**
 * AI Recovery Action - Individual Puppeteer action to execute
 */
export interface AIRecoveryAction {
    type: 'click' | 'type' | 'focus' | 'waitForSelector' | 'pressKey' | 'scroll' | 'evaluate';
    selector?: string;
    selectorType?: 'css' | 'xpath';
    value?: string;             // For 'type' actions
    key?: string;               // For 'pressKey' actions  
    timeout?: number;           // For 'waitForSelector'
    reason: string;
}