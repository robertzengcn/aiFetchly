import { z } from 'zod';

/**
 * MCP (Model Context Protocol) Type Definitions
 * 
 * This file contains TypeScript interfaces and Zod schemas for MCP requests and responses
 * used throughout the aiFetchly MCP server implementation.
 */

// ============================================================================
// Base MCP Types
// ============================================================================

/**
 * Base MCP request structure
 */
export interface MCPRequest {
    tool: string;
    parameters: Record<string, any>;
    requestId?: string;
    timestamp?: string;
}

/**
 * Base MCP response structure
 */
export interface MCPResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: MCPError;
    requestId?: string;
    timestamp: string;
}

/**
 * MCP error structure
 */
export interface MCPError {
    code: string;
    message: string;
    details?: any;
    stack?: string;
}

/**
 * Login state error response format
 * Used for authentication and application state failures
 */
export interface LoginStateError {
    type: 'LoginStateError';
    code: 'AUTH_REQUIRED' | 'SESSION_EXPIRED' | 'INVALID_STATE' | 'PERMISSION_DENIED';
    message: string;
    details?: {
        requiredState?: string;
        currentState?: string;
        action?: string;
        loginUrl?: string;
    };
    timestamp: string;
}

/**
 * MCP pagination parameters
 */
export interface MCPPaginationParams {
    page?: number;
    size?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

/**
 * MCP paginated response
 */
export interface MCPPaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    size: number;
    totalPages: number;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

/**
 * Base MCP request schema
 */
export const MCPRequestSchema = z.object({
    tool: z.string().min(1),
    parameters: z.record(z.any()),
    requestId: z.string().optional(),
    timestamp: z.string().optional()
});

/**
 * Base MCP response schema
 */
export const MCPResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.any().optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional(),
        stack: z.string().optional()
    }).optional(),
    requestId: z.string().optional(),
    timestamp: z.string()
});

/**
 * MCP pagination schema
 */
export const MCPPaginationSchema = z.object({
    page: z.number().int().min(1).optional().default(1),
    size: z.number().int().min(1).max(100).optional().default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

// ============================================================================
// Search Engine MCP Types
// ============================================================================

/**
 * Search engine MCP request parameters
 */
export interface MCPSearchRequest {
    query: string;
    pages?: number;
    language?: string;
    resultType?: 'organic' | 'ads' | 'all';
    engine?: 'google' | 'bing';
}

/**
 * Search result item
 */
export interface MCPSearchResult {
    title: string;
    url: string;
    description: string;
    position: number;
    domain: string;
    type: 'organic' | 'ad';
    snippet?: string;
    publishedDate?: string;
}

/**
 * Search metadata
 */
export interface MCPSearchMetadata {
    query: string;
    totalResults: number;
    processingTime: number;
    page: number;
    engine: string;
    timestamp: string;
}

/**
 * Search response data
 */
export interface MCPSearchData {
    results: MCPSearchResult[];
    metadata: MCPSearchMetadata;
    relatedSearches?: string[];
}

// ============================================================================
// Email Extraction MCP Types
// ============================================================================

/**
 * Email extraction MCP request parameters
 */
export interface MCPEmailExtractionRequest {
    websites: string[];
    maxDepth?: number;
    includeSubdomains?: boolean;
    excludePatterns?: string[];
    timeout?: number;
}

/**
 * Extracted email data
 */
export interface MCPExtractedEmail {
    email: string;
    website: string;
    context?: string;
    confidence: number;
    source: string;
}

/**
 * Email extraction response data
 */
export interface MCPEmailExtractionData {
    emails: MCPExtractedEmail[];
    totalFound: number;
    processedWebsites: number;
    failedWebsites: string[];
    processingTime: number;
}

// ============================================================================
// Yellow Pages MCP Types
// ============================================================================

/**
 * Yellow Pages MCP request parameters
 */
export interface MCPYellowPagesRequest {
    query: string;
    location: string;
    platform: 'yelp' | 'yellowpages' | 'google_business';
    maxResults?: number;
    radius?: number;
    sortBy?: 'relevance' | 'distance' | 'rating';
}

/**
 * Business listing data
 */
export interface MCPBusinessListing {
    name: string;
    address: string;
    phone?: string;
    website?: string;
    email?: string;
    rating?: number;
    reviewCount?: number;
    categories: string[];
    hours?: Record<string, string> | object;
    coordinates?: {
        latitude: number;
        longitude: number;
    };
    platform: string;
    listingUrl: string;
}

/**
 * Yellow Pages response data
 */
export interface MCPYellowPagesData {
    businesses: MCPBusinessListing[];
    totalFound: number;
    platform: string;
    location: string;
    searchQuery: string;
    processingTime: number;
}

// ============================================================================
// Task Management MCP Types
// ============================================================================

/**
 * Task creation MCP request
 */
export interface MCPTaskCreateRequest {
    name: string;
    description?: string;
    type: 'search' | 'email_extraction' | 'yellow_pages' | 'website_scraping';
    parameters: Record<string, any>;
    priority?: 'low' | 'medium' | 'high';
    scheduledAt?: string;
}

/**
 * Task update MCP request
 */
export interface MCPTaskUpdateRequest {
    taskId: string;
    name?: string;
    description?: string;
    parameters?: Record<string, any>;
    priority?: 'low' | 'medium' | 'high';
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
}

/**
 * Task entity
 */
export interface MCPTask {
    id: string;
    name: string;
    description?: string;
    type: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    parameters: Record<string, any>;
    priority: 'low' | 'medium' | 'high';
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    resultsCount?: number;
    errorMessage?: string;
    progress?: number;
}

/**
 * Task list response
 */
export interface MCPTaskListData {
    tasks: MCPTask[];
    pagination: MCPPaginatedResponse<MCPTask>;
}

// ============================================================================
// System Status MCP Types
// ============================================================================

/**
 * System status information
 */
export interface MCPSystemStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    uptime: number;
    memory: {
        used: number;
        total: number;
        percentage: number;
    };
    cpu: {
        usage: number;
        cores: number;
    };
    disk: {
        used: number;
        total: number;
        percentage: number;
    };
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
    lastHealthCheck: string;
}

// ============================================================================
// User Management MCP Types
// ============================================================================

/**
 * User profile data
 */
export interface MCPUserProfile {
    id: string;
    email: string;
    name?: string;
    createdAt: string;
    lastLoginAt?: string;
    preferences: Record<string, any>;
    isActive: boolean;
}

/**
 * User settings data
 */
export interface MCPUserSettings {
    theme: 'light' | 'dark' | 'auto';
    language: string;
    timezone: string;
    notifications: {
        email: boolean;
        push: boolean;
        taskUpdates: boolean;
    };
    scraping: {
        defaultConcurrency: number;
        defaultTimeout: number;
        showBrowser: boolean;
    };
}

// ============================================================================
// System Settings MCP Types
// ============================================================================


/**
 * System settings group
 */
export interface MCPSystemSettingsGroup {
    name: string;
    description?: string;
    settings: MCPSystemSetting[];
    updatedAt: string;
}

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Standard MCP error codes
 */
export enum MCPErrorCode {
    // Authentication errors
    AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
    INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    
    // Validation errors
    INVALID_PARAMETERS = 'INVALID_PARAMETERS',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
    INVALID_FORMAT = 'INVALID_FORMAT',
    
    // Business logic errors
    TASK_NOT_FOUND = 'TASK_NOT_FOUND',
    TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
    INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
    
    // System errors
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    TIMEOUT = 'TIMEOUT',
    RATE_LIMITED = 'RATE_LIMITED',
    
    // External service errors
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
    PARSING_ERROR = 'PARSING_ERROR'
}

// ============================================================================
// User Management MCP Types
// ============================================================================

/**
 * User login MCP request
 */
export interface MCPUserLoginRequest {
    username: string;
    password: string;
}

/**
 * User information MCP response
 */
export interface MCPUserInfo {
    name: string;
    email: string;
    roles?: string[];
    isAuthenticated: boolean;
}

/**
 * User login MCP response
 */
export interface MCPUserLoginResponse {
    user: MCPUserInfo;
    token?: string;
    expiresAt?: string;
}

// ============================================================================
// System Settings MCP Types
// ============================================================================

/**
 * System setting option MCP response
 */
export interface MCPSystemSettingOption {
    id: number;
    value: string;
    label: string;
}

/**
 * System setting MCP response
 */
export interface MCPSystemSetting {
    id: number;
    key: string;
    value: string;
    description: string;
    type: 'input' | 'select' | 'radio' | 'checkbox';
    options?: MCPSystemSettingOption[];
}

/**
 * System setting group MCP response
 */
export interface MCPSystemSettingGroup {
    id: number;
    name: string;
    description: string;
    settings: MCPSystemSetting[];
}

/**
 * System setting update MCP request
 */
export interface MCPSystemSettingUpdateRequest {
    settingId: number;
    value: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a standardized MCP success response
 */
export function createMCPSuccessResponse<T>(
    data: T,
    message: string = 'Operation completed successfully',
    requestId?: string
): MCPResponse<T> {
    return {
        success: true,
        message,
        data,
        requestId,
        timestamp: new Date().toISOString()
    };
}

/**
 * Create a standardized MCP error response
 */
export function createMCPErrorResponse(
    error: MCPError,
    message: string = 'Operation failed',
    requestId?: string
): MCPResponse {
    return {
        success: false,
        message,
        error,
        requestId,
        timestamp: new Date().toISOString()
    };
}

/**
 * Create an MCP error object
 */
export function createMCPError(
    code: MCPErrorCode | string,
    message: string,
    details?: any,
    stack?: string
): MCPError {
    return {
        code,
        message,
        details,
        stack
    };
}

/**
 * Create a LoginStateError response
 */
export function createLoginStateError(
    code: 'AUTH_REQUIRED' | 'SESSION_EXPIRED' | 'INVALID_STATE' | 'PERMISSION_DENIED',
    message: string,
    details?: {
        requiredState?: string;
        currentState?: string;
        action?: string;
        loginUrl?: string;
    }
): LoginStateError {
    return {
        type: 'LoginStateError',
        code,
        message,
        details,
        timestamp: new Date().toISOString()
    };
}

/**
 * Create a standardized authentication required error
 */
export function createAuthRequiredError(
    action: string,
    loginUrl?: string
): LoginStateError {
    return createLoginStateError(
        'AUTH_REQUIRED',
        `Authentication required to perform action: ${action}`,
        {
            action,
            loginUrl,
            requiredState: 'authenticated'
        }
    );
}

/**
 * Create a session expired error
 */
export function createSessionExpiredError(): LoginStateError {
    return createLoginStateError(
        'SESSION_EXPIRED',
        'Your session has expired. Please log in again.',
        {
            requiredState: 'authenticated',
            currentState: 'expired'
        }
    );
}

/**
 * Create an invalid state error
 */
export function createInvalidStateError(
    currentState: string,
    requiredState: string,
    action: string
): LoginStateError {
    return createLoginStateError(
        'INVALID_STATE',
        `Invalid application state for action: ${action}`,
        {
            currentState,
            requiredState,
            action
        }
    );
}

/**
 * Create a permission denied error
 */
export function createPermissionDeniedError(
    action: string,
    requiredPermission?: string
): LoginStateError {
    return createLoginStateError(
        'PERMISSION_DENIED',
        `Permission denied for action: ${action}`,
        {
            action,
            requiredState: requiredPermission || 'authorized'
        }
    );
}

// ============================================================================
// Type Exports
// ============================================================================

export type MCPRequestType = z.infer<typeof MCPRequestSchema>;
export type MCPResponseType = z.infer<typeof MCPResponseSchema>;
export type MCPPaginationType = z.infer<typeof MCPPaginationSchema>;
