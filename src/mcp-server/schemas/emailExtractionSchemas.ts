import { z } from 'zod';

/**
 * Zod schemas for Email Extraction MCP tools
 */

// Email extraction request parameters
export const EmailExtractionSchema = z.object({
    websites: z.array(z.string().url('Invalid website URL')).min(1, 'At least one website URL is required'),
    maxDepth: z.number().int().min(1).max(5).optional().default(2),
    includeSubdomains: z.boolean().optional().default(true),
    excludePatterns: z.array(z.string()).optional().default([]),
    timeout: z.number().int().min(1000).max(30000).optional().default(10000) // 1-30 seconds
});

// Email validation request parameters
export const EmailValidationSchema = z.object({
    emails: z.array(z.string().email('Invalid email format')).min(1, 'At least one email address is required'),
    checkDisposable: z.boolean().optional().default(true),
    checkMX: z.boolean().optional().default(false),
    checkSMTP: z.boolean().optional().default(false)
});

// Extracted email data schema
export const ExtractedEmailSchema = z.object({
    email: z.string().email(),
    website: z.string().url(),
    context: z.string().optional(),
    confidence: z.number().min(0).max(1),
    source: z.enum(['page_content', 'contact_form', 'about_page', 'footer', 'header', 'metadata']),
    foundAt: z.string().datetime(),
    pageTitle: z.string().optional(),
    pageUrl: z.string().url()
});

// Email validation result schema
export const EmailValidationResultSchema = z.object({
    email: z.string().email(),
    isValid: z.boolean(),
    isDisposable: z.boolean().optional(),
    isMXValid: z.boolean().optional(),
    isSMTPValid: z.boolean().optional(),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()).optional(),
    suggestedCorrection: z.string().optional()
});

// Email extraction response data schema
export const EmailExtractionDataSchema = z.object({
    emails: z.array(ExtractedEmailSchema),
    totalFound: z.number().int().min(0),
    processedWebsites: z.number().int().min(0),
    failedWebsites: z.array(z.string().url()),
    processingTime: z.number().min(0),
    extractionStats: z.object({
        totalPages: z.number().int().min(0),
        successfulExtractions: z.number().int().min(0),
        failedExtractions: z.number().int().min(0),
        averageConfidence: z.number().min(0).max(1)
    })
});

// Email validation response data schema
export const EmailValidationDataSchema = z.object({
    results: z.array(EmailValidationResultSchema),
    totalValidated: z.number().int().min(0),
    validEmails: z.number().int().min(0),
    invalidEmails: z.number().int().min(0),
    disposableEmails: z.number().int().min(0),
    processingTime: z.number().min(0),
    validationStats: z.object({
        averageConfidence: z.number().min(0).max(1),
        commonIssues: z.array(z.string()),
        suggestedActions: z.array(z.string())
    })
});

// MCP Email Extraction response schema
export const MCPEmailExtractionResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: EmailExtractionDataSchema.optional().nullable(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional()
    }).optional()
});

// MCP Email Validation response schema
export const MCPEmailValidationResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: EmailValidationDataSchema.optional().nullable(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional()
    }).optional()
});

// Type exports
export type EmailExtractionParams = z.infer<typeof EmailExtractionSchema>;
export type EmailValidationParams = z.infer<typeof EmailValidationSchema>;
export type ExtractedEmail = z.infer<typeof ExtractedEmailSchema>;
export type EmailValidationResult = z.infer<typeof EmailValidationResultSchema>;
export type EmailExtractionData = z.infer<typeof EmailExtractionDataSchema>;
export type EmailValidationData = z.infer<typeof EmailValidationDataSchema>;
export type MCPEmailExtractionResponse = z.infer<typeof MCPEmailExtractionResponseSchema>;
export type MCPEmailValidationResponse = z.infer<typeof MCPEmailValidationResponseSchema>;


