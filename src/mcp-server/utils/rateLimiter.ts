/**
 * Rate Limiter for MCP Tools
 * Implements rate limiting to prevent abuse and ensure fair usage
 */

interface RateLimitConfig {
    windowMs: number; // Time window in milliseconds
    maxRequests: number; // Maximum requests per window
    keyGenerator?: (request: any) => string; // Custom key generator
    skipSuccessfulRequests?: boolean; // Skip counting successful requests
    skipFailedRequests?: boolean; // Skip counting failed requests
}

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

class RateLimiter {
    private store: Map<string, RateLimitEntry> = new Map();
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Clean up expired entries every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }

    /**
     * Check if request is within rate limit
     */
    isAllowed(request: any, config: RateLimitConfig): { allowed: boolean; remaining: number; resetTime: number } {
        const key = this.getKey(request, config);
        const now = Date.now();
        const windowStart = now - config.windowMs;

        // Get or create entry
        let entry = this.store.get(key);
        if (!entry || entry.resetTime < now) {
            entry = {
                count: 0,
                resetTime: now + config.windowMs
            };
            this.store.set(key, entry);
        }

        // Check if within limit
        const allowed = entry.count < config.maxRequests;
        
        if (allowed) {
            entry.count++;
        }

        return {
            allowed,
            remaining: Math.max(0, config.maxRequests - entry.count),
            resetTime: entry.resetTime
        };
    }

    /**
     * Get rate limit key for request
     */
    private getKey(request: any, config: RateLimitConfig): string {
        if (config.keyGenerator) {
            return config.keyGenerator(request);
        }

        // Default key generation based on user ID or IP
        const userId = request.user?.id || 'anonymous';
        const toolName = request.params?.name || 'unknown';
        return `${userId}:${toolName}`;
    }

    /**
     * Clean up expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (entry.resetTime < now) {
                this.store.delete(key);
            }
        }
    }

    /**
     * Get current rate limit status for a key
     */
    getStatus(key: string): { count: number; remaining: number; resetTime: number } | null {
        const entry = this.store.get(key);
        if (!entry) {
            return null;
        }

        const now = Date.now();
        if (entry.resetTime < now) {
            this.store.delete(key);
            return null;
        }

        return {
            count: entry.count,
            remaining: Math.max(0, 100 - entry.count), // Assuming max 100 for now
            resetTime: entry.resetTime
        };
    }

    /**
     * Reset rate limit for a key
     */
    reset(key: string): void {
        this.store.delete(key);
    }

    /**
     * Destroy the rate limiter and cleanup
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.store.clear();
    }
}

// Rate limit configurations for different tool types
export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
    // Search tools - more restrictive due to external API calls
    'search_google': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 10,
        keyGenerator: (request) => `search:${request.user?.id || 'anonymous'}`
    },
    'search_bing': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 10,
        keyGenerator: (request) => `search:${request.user?.id || 'anonymous'}`
    },
    
    // Yellow pages tools - moderate limits
    'scrape_yellow_pages': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 20,
        keyGenerator: (request) => `yellowpages:${request.user?.id || 'anonymous'}`
    },
    'get_business_details': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 30,
        keyGenerator: (request) => `yellowpages:${request.user?.id || 'anonymous'}`
    },
    
    // Email extraction tools - more restrictive due to web scraping
    'extract_emails_from_website': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 5,
        keyGenerator: (request) => `email_extraction:${request.user?.id || 'anonymous'}`
    },
    'validate_email_list': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 50,
        keyGenerator: (request) => `email_validation:${request.user?.id || 'anonymous'}`
    },
    
    // Email marketing tools - moderate limits
    'create_email_task': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 20,
        keyGenerator: (request) => `email_marketing:${request.user?.id || 'anonymous'}`
    },
    'get_email_task': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100,
        keyGenerator: (request) => `email_marketing:${request.user?.id || 'anonymous'}`
    },
    'update_email_task': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 50,
        keyGenerator: (request) => `email_marketing:${request.user?.id || 'anonymous'}`
    },
    'delete_email_task': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 30,
        keyGenerator: (request) => `email_marketing:${request.user?.id || 'anonymous'}`
    },
    'list_email_tasks': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100,
        keyGenerator: (request) => `email_marketing:${request.user?.id || 'anonymous'}`
    },
    
    // System tools - higher limits
    'get_system_status': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 200,
        keyGenerator: (request) => `system:${request.user?.id || 'anonymous'}`
    },
    'test_connection': {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100,
        keyGenerator: (request) => `system:${request.user?.id || 'anonymous'}`
    }
};

// Global rate limiter instance
export const rateLimiter = new RateLimiter();

/**
 * Rate limiting middleware for MCP tools
 */
export function checkRateLimit(request: any, toolName: string): { allowed: boolean; error?: any } {
    const config = RATE_LIMIT_CONFIGS[toolName];
    if (!config) {
        // No rate limiting for unknown tools
        return { allowed: true };
    }

    const result = rateLimiter.isAllowed(request, config);
    
    if (!result.allowed) {
        return {
            allowed: false,
            error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: `Rate limit exceeded for tool '${toolName}'. Try again in ${Math.ceil((result.resetTime - Date.now()) / 1000)} seconds.`,
                retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
                limit: config.maxRequests,
                remaining: result.remaining,
                resetTime: result.resetTime
            }
        };
    }

    return { allowed: true };
}

/**
 * Get rate limit status for a user and tool
 */
export function getRateLimitStatus(userId: string, toolName: string): any {
    const config = RATE_LIMIT_CONFIGS[toolName];
    if (!config) {
        return null;
    }

    const key = `${userId}:${toolName}`;
    return rateLimiter.getStatus(key);
}

/**
 * Reset rate limit for a user and tool
 */
export function resetRateLimit(userId: string, toolName: string): void {
    const config = RATE_LIMIT_CONFIGS[toolName];
    if (!config) {
        return;
    }

    const key = `${userId}:${toolName}`;
    rateLimiter.reset(key);
}

/**
 * Cleanup rate limiter on process exit
 */
process.on('SIGINT', () => {
    rateLimiter.destroy();
});

process.on('SIGTERM', () => {
    rateLimiter.destroy();
});

