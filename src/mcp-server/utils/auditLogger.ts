/**
 * Audit Logger for MCP Tools
 * Comprehensive logging for all MCP tool calls, security events, and performance metrics
 */

interface AuditLogEntry {
    id: string;
    timestamp: string;
    userId?: string;
    userEmail?: string;
    toolName: string;
    requestId: string;
    method: string;
    parameters: any;
    response?: any;
    status: 'success' | 'error' | 'rate_limited' | 'auth_failed';
    statusCode?: number;
    errorMessage?: string;
    processingTime: number;
    ipAddress?: string;
    userAgent?: string;
    securityEvent?: string;
    performanceMetrics?: {
        memoryUsage: NodeJS.MemoryUsage;
        cpuUsage?: NodeJS.CpuUsage;
    };
}

interface SecurityEvent {
    type: 'auth_failure' | 'rate_limit_exceeded' | 'invalid_request' | 'suspicious_activity';
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    metadata?: any;
}

class AuditLogger {
    private logs: AuditLogEntry[] = [];
    private maxLogs: number = 10000; // Keep last 10k logs in memory
    private securityEvents: SecurityEvent[] = [];
    private maxSecurityEvents: number = 1000; // Keep last 1k security events

    /**
     * Log MCP tool call
     */
    logToolCall(
        request: any,
        toolName: string,
        startTime: number,
        response?: any,
        error?: any
    ): void {
        const endTime = Date.now();
        const processingTime = endTime - startTime;

        const logEntry: AuditLogEntry = {
            id: this.generateId(),
            timestamp: new Date().toISOString(),
            userId: request.user?.id,
            userEmail: request.user?.email,
            toolName,
            requestId: request.id,
            method: request.method || 'unknown',
            parameters: this.sanitizeParameters(request.params?.arguments || {}),
            response: response ? this.sanitizeResponse(response) : undefined,
            status: this.determineStatus(response, error),
            statusCode: this.getStatusCode(response, error),
            errorMessage: error?.message,
            processingTime,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent,
            performanceMetrics: {
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            }
        };

        this.addLogEntry(logEntry);

        // Log security events if applicable
        if (this.isSecurityEvent(logEntry)) {
            this.logSecurityEvent(logEntry);
        }

        // Log to console for development
        this.logToConsole(logEntry);
    }

    /**
     * Log security event
     */
    logSecurityEvent(logEntry: AuditLogEntry): void {
        let securityEvent: SecurityEvent;

        if (logEntry.status === 'auth_failed') {
            securityEvent = {
                type: 'auth_failure',
                description: `Authentication failed for user ${logEntry.userId || 'anonymous'} on tool ${logEntry.toolName}`,
                severity: 'medium',
                metadata: {
                    toolName: logEntry.toolName,
                    userId: logEntry.userId,
                    ipAddress: logEntry.ipAddress
                }
            };
        } else if (logEntry.status === 'rate_limited') {
            securityEvent = {
                type: 'rate_limit_exceeded',
                description: `Rate limit exceeded for user ${logEntry.userId || 'anonymous'} on tool ${logEntry.toolName}`,
                severity: 'low',
                metadata: {
                    toolName: logEntry.toolName,
                    userId: logEntry.userId,
                    ipAddress: logEntry.ipAddress
                }
            };
        } else if (logEntry.statusCode && logEntry.statusCode >= 400) {
            securityEvent = {
                type: 'invalid_request',
                description: `Invalid request for tool ${logEntry.toolName}: ${logEntry.errorMessage}`,
                severity: 'low',
                metadata: {
                    toolName: logEntry.toolName,
                    userId: logEntry.userId,
                    statusCode: logEntry.statusCode,
                    errorMessage: logEntry.errorMessage
                }
            };
        } else {
            return; // Not a security event
        }

        this.addSecurityEvent(securityEvent);
    }

    /**
     * Log authentication failure
     */
    logAuthFailure(request: any, reason: string): void {
        const logEntry: AuditLogEntry = {
            id: this.generateId(),
            timestamp: new Date().toISOString(),
            userId: request.user?.id,
            userEmail: request.user?.email,
            toolName: request.params?.name || 'unknown',
            requestId: request.id,
            method: request.method || 'unknown',
            parameters: this.sanitizeParameters(request.params?.arguments || {}),
            status: 'auth_failed',
            statusCode: 401,
            errorMessage: reason,
            processingTime: 0,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent
        };

        this.addLogEntry(logEntry);

        const securityEvent: SecurityEvent = {
            type: 'auth_failure',
            description: `Authentication failure: ${reason}`,
            severity: 'medium',
            metadata: {
                userId: logEntry.userId,
                ipAddress: logEntry.ipAddress,
                toolName: logEntry.toolName,
                reason
            }
        };

        this.addSecurityEvent(securityEvent);
        this.logToConsole(logEntry);
    }

    /**
     * Log rate limit exceeded
     */
    logRateLimitExceeded(request: any, toolName: string, rateLimitInfo: any): void {
        const logEntry: AuditLogEntry = {
            id: this.generateId(),
            timestamp: new Date().toISOString(),
            userId: request.user?.id,
            userEmail: request.user?.email,
            toolName,
            requestId: request.id,
            method: request.method || 'unknown',
            parameters: this.sanitizeParameters(request.params?.arguments || {}),
            status: 'rate_limited',
            statusCode: 429,
            errorMessage: rateLimitInfo.message,
            processingTime: 0,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent
        };

        this.addLogEntry(logEntry);

        const securityEvent: SecurityEvent = {
            type: 'rate_limit_exceeded',
            description: `Rate limit exceeded for tool ${toolName}`,
            severity: 'low',
            metadata: {
                toolName,
                userId: logEntry.userId,
                ipAddress: logEntry.ipAddress,
                rateLimitInfo
            }
        };

        this.addSecurityEvent(securityEvent);
        this.logToConsole(logEntry);
    }

    /**
     * Get audit logs
     */
    getAuditLogs(filters?: {
        userId?: string;
        toolName?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
        limit?: number;
    }): AuditLogEntry[] {
        let filteredLogs = [...this.logs];

        if (filters) {
            if (filters.userId) {
                filteredLogs = filteredLogs.filter(log => log.userId === filters.userId);
            }
            if (filters.toolName) {
                filteredLogs = filteredLogs.filter(log => log.toolName === filters.toolName);
            }
            if (filters.status) {
                filteredLogs = filteredLogs.filter(log => log.status === filters.status);
            }
            if (filters.startDate) {
                filteredLogs = filteredLogs.filter(log => log.timestamp >= filters.startDate!);
            }
            if (filters.endDate) {
                filteredLogs = filteredLogs.filter(log => log.timestamp <= filters.endDate!);
            }
        }

        if (filters?.limit) {
            filteredLogs = filteredLogs.slice(-filters.limit);
        }

        return filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    /**
     * Get security events
     */
    getSecurityEvents(filters?: {
        type?: string;
        severity?: string;
        startDate?: string;
        endDate?: string;
        limit?: number;
    }): SecurityEvent[] {
        let filteredEvents = [...this.securityEvents];

        if (filters) {
            if (filters.type) {
                filteredEvents = filteredEvents.filter(event => event.type === filters.type);
            }
            if (filters.severity) {
                filteredEvents = filteredEvents.filter(event => event.severity === filters.severity);
            }
            if (filters.startDate) {
                filteredEvents = filteredEvents.filter(event => event.description.includes(filters.startDate!));
            }
            if (filters.endDate) {
                filteredEvents = filteredEvents.filter(event => event.description.includes(filters.endDate!));
            }
        }

        if (filters?.limit) {
            filteredEvents = filteredEvents.slice(-filters.limit);
        }

        return filteredEvents.sort((a, b) => b.description.localeCompare(a.description));
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats(timeWindow?: number): {
        totalRequests: number;
        averageResponseTime: number;
        errorRate: number;
        topTools: Array<{ toolName: string; count: number }>;
        topErrors: Array<{ error: string; count: number }>;
    } {
        const now = Date.now();
        const windowMs = timeWindow || 24 * 60 * 60 * 1000; // 24 hours default
        const cutoffTime = new Date(now - windowMs).toISOString();

        const recentLogs = this.logs.filter(log => log.timestamp >= cutoffTime);

        const totalRequests = recentLogs.length;
        const averageResponseTime = recentLogs.reduce((sum, log) => sum + log.processingTime, 0) / totalRequests || 0;
        const errorCount = recentLogs.filter(log => log.status === 'error' || log.status === 'auth_failed').length;
        const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

        // Top tools
        const toolCounts: Record<string, number> = {};
        recentLogs.forEach(log => {
            toolCounts[log.toolName] = (toolCounts[log.toolName] || 0) + 1;
        });
        const topTools = Object.entries(toolCounts)
            .map(([toolName, count]) => ({ toolName, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Top errors
        const errorCounts: Record<string, number> = {};
        recentLogs
            .filter(log => log.status === 'error' || log.status === 'auth_failed')
            .forEach(log => {
                const error = log.errorMessage || 'Unknown error';
                errorCounts[error] = (errorCounts[error] || 0) + 1;
            });
        const topErrors = Object.entries(errorCounts)
            .map(([error, count]) => ({ error, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            totalRequests,
            averageResponseTime: Math.round(averageResponseTime),
            errorRate: Math.round(errorRate * 100) / 100,
            topTools,
            topErrors
        };
    }

    /**
     * Clear old logs
     */
    clearOldLogs(): void {
        const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
        this.logs = this.logs.filter(log => log.timestamp >= cutoffTime);
        this.securityEvents = this.securityEvents.filter(event => 
            event.description.includes(cutoffTime) || event.description.includes('Authentication failure')
        );
    }

    // Private methods

    private addLogEntry(logEntry: AuditLogEntry): void {
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
    }

    private addSecurityEvent(securityEvent: SecurityEvent): void {
        this.securityEvents.push(securityEvent);
        if (this.securityEvents.length > this.maxSecurityEvents) {
            this.securityEvents = this.securityEvents.slice(-this.maxSecurityEvents);
        }
    }

    private generateId(): string {
        return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private sanitizeParameters(params: any): any {
        if (!params || typeof params !== 'object') {
            return params;
        }

        const sanitized = { ...params };
        
        // Remove sensitive fields
        const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    private sanitizeResponse(response: any): any {
        if (!response || typeof response !== 'object') {
            return response;
        }

        const sanitized = { ...response };
        
        // Remove sensitive fields from response
        const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    private determineStatus(response: any, error: any): 'success' | 'error' | 'rate_limited' | 'auth_failed' {
        if (error) {
            if (error.code === 'RATE_LIMIT_EXCEEDED') {
                return 'rate_limited';
            }
            if (error.code === 'USER_NOT_LOGGED_IN') {
                return 'auth_failed';
            }
            return 'error';
        }
        return 'success';
    }

    private getStatusCode(response: any, error: any): number | undefined {
        if (error) {
            if (error.code === 'RATE_LIMIT_EXCEEDED') return 429;
            if (error.code === 'USER_NOT_LOGGED_IN') return 401;
            return 500;
        }
        return 200;
    }

    private isSecurityEvent(logEntry: AuditLogEntry): boolean {
        return logEntry.status === 'auth_failed' || 
               logEntry.status === 'rate_limited' || 
               (logEntry.statusCode !== undefined && logEntry.statusCode >= 400);
    }

    private logToConsole(logEntry: AuditLogEntry): void {
        const logLevel = logEntry.status === 'success' ? 'info' : 'warn';
        const message = `[AUDIT] ${logEntry.toolName} - ${logEntry.status} - ${logEntry.processingTime}ms`;
        
        if (logLevel === 'info') {
            console.log(message);
        } else {
            console.warn(message, {
                userId: logEntry.userId,
                error: logEntry.errorMessage,
                ipAddress: logEntry.ipAddress
            });
        }
    }
}

// Global audit logger instance
export const auditLogger = new AuditLogger();

// Cleanup old logs every hour
setInterval(() => {
    auditLogger.clearOldLogs();
}, 60 * 60 * 1000);

