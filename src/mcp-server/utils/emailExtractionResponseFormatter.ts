import { 
    MCPEmailExtractionResponse, 
    MCPEmailValidationResponse,
    EmailExtractionData,
    EmailValidationData,
    ExtractedEmail,
    EmailValidationResult
} from '../schemas/emailExtractionSchemas';
import { MCPResponse, MCPEmailExtractionData, MCPExtractedEmail } from '../types/mcpTypes';

/**
 * Response formatter for Email Extraction MCP tools
 * Transforms raw data from EmailExtractionController into standardized MCP response format
 */
export class EmailExtractionResponseFormatter {
    /**
     * Format email extraction response
     */
    static formatEmailExtractionResponse(
        rawData: MCPResponse<MCPEmailExtractionData>,
        websites: string[],
        processingTime: number = 0
    ): MCPEmailExtractionResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    success: false,
                    message: rawData?.message || 'Email extraction failed',
                    data: null,
                    error: {
                        code: 'EXTRACTION_FAILED',
                        message: rawData?.message || 'Email extraction failed'
                    }
                };
            }

            const extractionData: EmailExtractionData = {
                emails: this.formatExtractedEmails(rawData.data?.emails || []),
                totalFound: rawData.data?.totalFound || 0,
                processedWebsites: rawData.data?.processedWebsites || 0,
                failedWebsites: rawData.data?.failedWebsites || [],
                processingTime: processingTime,
                extractionStats: {
                    totalPages: 0,
                    successfulExtractions: rawData.data?.processedWebsites || 0,
                    failedExtractions: rawData.data?.failedWebsites?.length || 0,
                    averageConfidence: this.calculateAverageConfidence(rawData.data?.emails || [])
                }
            };

            return {
                success: true,
                message: 'Email extraction completed successfully',
                data: extractionData
            };
        } catch (error) {
            console.error('Error formatting email extraction response:', error);
            return {
                success: false,
                message: 'Failed to format email extraction response',
                data: null,
                error: {
                    code: 'FORMAT_ERROR',
                    message: 'Failed to format email extraction response',
                    details: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Format email validation response
     */
    static formatEmailValidationResponse(
        rawData: MCPResponse<any>,
        emails: string[],
        processingTime: number = 0
    ): MCPEmailValidationResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    success: false,
                    message: rawData?.message || 'Email validation failed',
                    data: null,
                    error: {
                        code: 'VALIDATION_FAILED',
                        message: rawData?.message || 'Email validation failed'
                    }
                };
            }

            const validationData: EmailValidationData = {
                results: this.formatValidationResults(rawData.data?.results || []),
                totalValidated: emails.length,
                validEmails: rawData.data?.validEmails || 0,
                invalidEmails: rawData.data?.invalidEmails || 0,
                disposableEmails: rawData.data?.disposableEmails || 0,
                processingTime: processingTime,
                validationStats: {
                    averageConfidence: this.calculateAverageValidationConfidence(rawData.data?.results || []),
                    commonIssues: this.extractCommonIssues(rawData.data?.results || []),
                    suggestedActions: this.generateSuggestedActions(rawData.data?.results || [])
                }
            };

            return {
                success: true,
                message: 'Email validation completed successfully',
                data: validationData
            };
        } catch (error) {
            console.error('Error formatting email validation response:', error);
            return {
                success: false,
                message: 'Failed to format email validation response',
                data: null,
                error: {
                    code: 'FORMAT_ERROR',
                    message: 'Failed to format email validation response',
                    details: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Format extracted emails array
     */
    private static formatExtractedEmails(rawEmails: MCPExtractedEmail[]): ExtractedEmail[] {
        return rawEmails.map(email => this.formatExtractedEmail(email));
    }

    /**
     * Format individual extracted email
     */
    private static formatExtractedEmail(rawEmail: MCPExtractedEmail): ExtractedEmail {
        return {
            email: this.sanitizeEmail(rawEmail.email),
            website: this.sanitizeUrl(rawEmail.website),
            context: rawEmail.context ? this.sanitizeString(rawEmail.context) : undefined,
            confidence: Math.max(0, Math.min(1, rawEmail.confidence || 0.5)),
            source: (rawEmail.source as 'page_content' | 'contact_form' | 'about_page' | 'footer' | 'header' | 'metadata') || 'page_content',
            foundAt: new Date().toISOString(),
            pageTitle: undefined,
            pageUrl: this.sanitizeUrl(rawEmail.website)
        };
    }

    /**
     * Format validation results array
     */
    private static formatValidationResults(rawResults: any[]): EmailValidationResult[] {
        return rawResults.map(result => this.formatValidationResult(result));
    }

    /**
     * Format individual validation result
     */
    private static formatValidationResult(rawResult: any): EmailValidationResult {
        return {
            email: this.sanitizeEmail(rawResult.email),
            isValid: Boolean(rawResult.isValid),
            isDisposable: rawResult.isDisposable ? Boolean(rawResult.isDisposable) : undefined,
            isMXValid: rawResult.isMXValid ? Boolean(rawResult.isMXValid) : undefined,
            isSMTPValid: rawResult.isSMTPValid ? Boolean(rawResult.isSMTPValid) : undefined,
            confidence: Math.max(0, Math.min(1, rawResult.confidence || 0.5)),
            reasons: rawResult.reasons ? rawResult.reasons.map((r: string) => this.sanitizeString(r)) : undefined,
            suggestedCorrection: rawResult.suggestedCorrection ? this.sanitizeEmail(rawResult.suggestedCorrection) : undefined
        };
    }

    /**
     * Calculate average confidence from extracted emails
     */
    private static calculateAverageConfidence(emails: MCPExtractedEmail[]): number {
        if (emails.length === 0) return 0;
        const totalConfidence = emails.reduce((sum, email) => sum + (email.confidence || 0.5), 0);
        return totalConfidence / emails.length;
    }

    /**
     * Calculate average validation confidence
     */
    private static calculateAverageValidationConfidence(results: any[]): number {
        if (results.length === 0) return 0;
        const totalConfidence = results.reduce((sum, result) => sum + (result.confidence || 0.5), 0);
        return totalConfidence / results.length;
    }

    /**
     * Extract common issues from validation results
     */
    private static extractCommonIssues(results: any[]): string[] {
        const issues: string[] = [];
        const issueCounts: Record<string, number> = {};

        results.forEach(result => {
            if (result.reasons) {
                result.reasons.forEach((reason: string) => {
                    issueCounts[reason] = (issueCounts[reason] || 0) + 1;
                });
            }
        });

        // Get most common issues (appearing in more than 10% of results)
        const threshold = Math.max(1, Math.floor(results.length * 0.1));
        Object.entries(issueCounts)
            .filter(([_, count]) => count >= threshold)
            .sort(([_, a], [__, b]) => b - a)
            .slice(0, 5)
            .forEach(([issue, _]) => issues.push(issue));

        return issues;
    }

    /**
     * Generate suggested actions based on validation results
     */
    private static generateSuggestedActions(results: any[]): string[] {
        const actions: string[] = [];
        const invalidCount = results.filter(r => !r.isValid).length;
        const disposableCount = results.filter(r => r.isDisposable).length;
        const totalCount = results.length;

        if (invalidCount > totalCount * 0.5) {
            actions.push('Review email collection process - high invalid email rate');
        }
        if (disposableCount > totalCount * 0.3) {
            actions.push('Consider filtering out disposable email addresses');
        }
        if (invalidCount > 0) {
            actions.push('Implement email validation before collection');
        }
        if (results.some(r => r.suggestedCorrection)) {
            actions.push('Review suggested corrections for common typos');
        }

        return actions;
    }

    /**
     * Create error response for email extraction operations
     */
    static createEmailExtractionErrorResponse(message: string, code: string = 'EMAIL_EXTRACTION_ERROR'): MCPEmailExtractionResponse {
        return {
            success: false,
            message,
            data: null,
            error: {
                code,
                message
            }
        };
    }

    /**
     * Create error response for email validation operations
     */
    static createEmailValidationErrorResponse(message: string, code: string = 'EMAIL_VALIDATION_ERROR'): MCPEmailValidationResponse {
        return {
            success: false,
            message,
            data: null,
            error: {
                code,
                message
            }
        };
    }

    /**
     * Sanitize email address
     */
    private static sanitizeEmail(email: string): string {
        return email.trim().toLowerCase();
    }

    /**
     * Sanitize URL
     */
    private static sanitizeUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.toString();
        } catch {
            return url;
        }
    }

    /**
     * Sanitize string data
     */
    private static sanitizeString(str: string): string {
        return str.trim().replace(/\s+/g, ' ');
    }
}

