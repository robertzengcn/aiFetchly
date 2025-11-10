/**
 * Type definitions for PDF extraction functionality
 */

export interface PdfExtractionResult {
    success: boolean;
    content: string | null;
    pageCount: number;
    processedPages: number;
    error?: string;
}

export interface PdfPageInfo {
    pageNumber: number;
    content: string;
    hasContent: boolean;
}

export interface PdfExtractionOptions {
    includePageNumbers?: boolean;
    pageSeparator?: string;
    maxPages?: number;
    skipEmptyPages?: boolean;
}
