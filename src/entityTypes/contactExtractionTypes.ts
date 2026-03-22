/**
 * Contact Information Extraction Type Definitions
 * Feature: 001-ai-contact-extraction
 */

/**
 * Contact information extracted from a website
 */
export interface ContactInfo {
    emails?: string[];           // All email addresses found
    phones?: string[];           // All phone numbers found
    address?: string | null;     // Physical address
    socialLinks?: string[] | null; // Social media URLs
    source?: string;             // Where found: 'homepage', 'contact_page', 'ai_extraction'
    confidence?: number;         // 0-1 confidence score
}

/**
 * Extraction result from discovery pipeline
 */
export interface ExtractionResult {
    success: boolean;
    data?: ContactInfo;
    error?: string;
    method?: string; // 'stage1_homepage', 'stage2_heuristic', 'stage3_fallback', 'stage4_ai', 'failed'
}

/**
 * Contact extraction job for queue
 */
export interface ExtractionJob {
    resultId: number;
    url: string;
    title: string;
    retryCount: number;
    priority: number;
}

/**
 * Extraction progress update
 */
export interface ExtractionProgress {
    batchId: string;
    resultId: number;
    status: 'pending' | 'analyzing' | 'completed' | 'failed';
    data?: ContactInfo;
    error?: string;
    method?: string;
}

/**
 * Contact extraction request (IPC)
 */
export interface ContactExtractionRequest {
    resultIds: number[];
}

/**
 * Contact extraction response (IPC)
 */
export interface ContactExtractionResponse {
    success: boolean;
    batchId?: string;
    message?: string;
}

/**
 * Contact info display (for frontend)
 */
export interface ContactInfoDisplay {
    id: number;
    resultId: number;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    socialLinks?: string[] | null;
    extractionStatus: string;
    extractionError?: string | null;
    extractionDate?: string;
}

/**
 * Contact extraction request for AI API
 */
export interface AIContactExtractionRequest {
    pageContent: string;
    url: string;
    entityName?: string;
}

/**
 * Contact extraction response from AI API
 */
export interface AIContactExtractionResponse {
    emails: string[];
    phones: string[];
    address?: string;
    socialLinks?: string[];
    confidence?: number;
}
