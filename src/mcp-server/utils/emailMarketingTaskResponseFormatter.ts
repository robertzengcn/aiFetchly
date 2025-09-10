import { 
    MCPEmailMarketingTaskResponse, 
    MCPEmailMarketingTaskListResponse,
    EmailMarketingTask,
    EmailMarketingTaskListData
} from '../schemas/emailMarketingTaskSchemas';
import { MCPResponse, MCPTask } from '../types/mcpTypes';

/**
 * Response formatter for Email Marketing Task MCP tools
 * Transforms raw data from EmailMarketingController into standardized MCP response format
 */
export class EmailMarketingTaskResponseFormatter {
    /**
     * Format single email marketing task response
     */
    static formatEmailMarketingTaskResponse(
        rawData: MCPResponse<MCPTask>,
        message: string = 'Email marketing task operation completed successfully'
    ): MCPEmailMarketingTaskResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    success: false,
                    message: rawData?.message || 'Email marketing task operation failed',
                    data: null,
                    error: {
                        code: 'TASK_OPERATION_FAILED',
                        message: rawData?.message || 'Email marketing task operation failed'
                    }
                };
            }

            const task: EmailMarketingTask = this.formatEmailMarketingTask(rawData.data!);

            return {
                success: true,
                message,
                data: task
            };
        } catch (error) {
            console.error('Error formatting email marketing task response:', error);
            return {
                success: false,
                message: 'Failed to format email marketing task response',
                data: null,
                error: {
                    code: 'FORMAT_ERROR',
                    message: 'Failed to format email marketing task response',
                    details: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Format email marketing task list response
     */
    static formatEmailMarketingTaskListResponse(
        rawData: MCPResponse<any>,
        message: string = 'Email marketing task list retrieved successfully'
    ): MCPEmailMarketingTaskListResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    success: false,
                    message: rawData?.message || 'Email marketing task list retrieval failed',
                    data: null,
                    error: {
                        code: 'LIST_RETRIEVAL_FAILED',
                        message: rawData?.message || 'Email marketing task list retrieval failed'
                    }
                };
            }

            const listData: EmailMarketingTaskListData = {
                tasks: this.formatEmailMarketingTasks(rawData.data?.tasks || []),
                pagination: {
                    page: rawData.data?.pagination?.page || 1,
                    size: rawData.data?.pagination?.size || 20,
                    total: rawData.data?.pagination?.total || 0,
                    totalPages: rawData.data?.pagination?.totalPages || 0
                }
            };

            return {
                success: true,
                message,
                data: listData
            };
        } catch (error) {
            console.error('Error formatting email marketing task list response:', error);
            return {
                success: false,
                message: 'Failed to format email marketing task list response',
                data: null,
                error: {
                    code: 'FORMAT_ERROR',
                    message: 'Failed to format email marketing task list response',
                    details: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Format email marketing tasks array
     */
    private static formatEmailMarketingTasks(rawTasks: MCPTask[]): EmailMarketingTask[] {
        return rawTasks.map(task => this.formatEmailMarketingTask(task));
    }

    /**
     * Format individual email marketing task
     */
    private static formatEmailMarketingTask(rawTask: MCPTask): EmailMarketingTask {
        return {
            id: rawTask.id,
            name: this.sanitizeString(rawTask.name),
            description: rawTask.description ? this.sanitizeString(rawTask.description) : undefined,
            type: this.mapTaskType(rawTask.type),
            status: this.mapTaskStatus(rawTask.status),
            priority: this.mapTaskPriority(rawTask.priority),
            parameters: rawTask.parameters || {},
            targetAudience: rawTask.parameters?.targetAudience ? this.sanitizeString(rawTask.parameters.targetAudience) : undefined,
            subjectLine: rawTask.parameters?.subjectLine ? this.sanitizeString(rawTask.parameters.subjectLine) : undefined,
            templateId: rawTask.parameters?.templateId ? this.sanitizeString(rawTask.parameters.templateId) : undefined,
            createdAt: rawTask.createdAt,
            updatedAt: rawTask.updatedAt,
            startedAt: rawTask.startedAt,
            completedAt: rawTask.completedAt,
            resultsCount: rawTask.resultsCount,
            errorMessage: rawTask.errorMessage ? this.sanitizeString(rawTask.errorMessage) : undefined,
            progress: rawTask.progress,
            userId: rawTask.parameters?.userId ? this.sanitizeString(rawTask.parameters.userId) : undefined
        };
    }

    /**
     * Map task type to email marketing task type
     */
    private static mapTaskType(type: string): 'email_campaign' | 'email_sequence' | 'email_blast' | 'email_newsletter' {
        switch (type) {
            case 'email_campaign':
            case 'email_sequence':
            case 'email_blast':
            case 'email_newsletter':
                return type;
            default:
                return 'email_campaign';
        }
    }

    /**
     * Map task status to email marketing task status
     */
    private static mapTaskStatus(status: string): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' {
        switch (status) {
            case 'pending':
            case 'running':
            case 'completed':
            case 'failed':
            case 'cancelled':
                return status;
            default:
                return 'pending';
        }
    }

    /**
     * Map task priority to email marketing task priority
     */
    private static mapTaskPriority(priority: string): 'low' | 'medium' | 'high' {
        switch (priority) {
            case 'low':
            case 'medium':
            case 'high':
                return priority;
            default:
                return 'medium';
        }
    }

    /**
     * Create error response for email marketing task operations
     */
    static createEmailMarketingTaskErrorResponse(message: string, code: string = 'EMAIL_MARKETING_TASK_ERROR'): MCPEmailMarketingTaskResponse {
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
     * Create error response for email marketing task list operations
     */
    static createEmailMarketingTaskListErrorResponse(message: string, code: string = 'EMAIL_MARKETING_TASK_LIST_ERROR'): MCPEmailMarketingTaskListResponse {
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
     * Sanitize string data
     */
    private static sanitizeString(str: string): string {
        return str.trim().replace(/\s+/g, ' ');
    }

    /**
     * Validate and sanitize task parameters
     */
    private static sanitizeTaskParameters(parameters: Record<string, any>): Record<string, any> {
        const sanitized: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(parameters)) {
            if (typeof value === 'string') {
                sanitized[key] = this.sanitizeString(value);
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeTaskParameters(value);
            } else {
                sanitized[key] = value;
            }
        }
        
        return sanitized;
    }

    /**
     * Extract email marketing specific parameters
     */
    private static extractEmailMarketingParameters(parameters: Record<string, any>): {
        targetAudience?: string;
        subjectLine?: string;
        templateId?: string;
        userId?: string;
    } {
        return {
            targetAudience: parameters.targetAudience ? this.sanitizeString(parameters.targetAudience) : undefined,
            subjectLine: parameters.subjectLine ? this.sanitizeString(parameters.subjectLine) : undefined,
            templateId: parameters.templateId ? this.sanitizeString(parameters.templateId) : undefined,
            userId: parameters.userId ? this.sanitizeString(parameters.userId) : undefined
        };
    }
}


