import { z } from 'zod';

/**
 * Zod schemas for Email Marketing Task MCP tools
 */

// Email marketing task creation parameters
export const CreateEmailTaskSchema = z.object({
    name: z.string().min(1, 'Task name cannot be empty').max(255, 'Task name too long'),
    description: z.string().optional(),
    type: z.enum(['email_campaign', 'email_sequence', 'email_blast', 'email_newsletter'], {
        errorMap: () => ({ message: 'Type must be one of: email_campaign, email_sequence, email_blast, email_newsletter' })
    }),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    scheduledAt: z.string().datetime().optional(),
    parameters: z.record(z.any()).optional().default({}),
    targetAudience: z.string().optional(),
    subjectLine: z.string().optional(),
    templateId: z.string().optional()
});

// Email marketing task update parameters
export const UpdateEmailTaskSchema = z.object({
    taskId: z.string().min(1, 'Task ID cannot be empty'),
    name: z.string().min(1, 'Task name cannot be empty').max(255, 'Task name too long').optional(),
    description: z.string().optional(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    scheduledAt: z.string().datetime().optional(),
    parameters: z.record(z.any()).optional(),
    targetAudience: z.string().optional(),
    subjectLine: z.string().optional(),
    templateId: z.string().optional()
});

// Email marketing task retrieval parameters
export const GetEmailTaskSchema = z.object({
    taskId: z.string().min(1, 'Task ID cannot be empty')
});

// Email marketing task deletion parameters
export const DeleteEmailTaskSchema = z.object({
    taskId: z.string().min(1, 'Task ID cannot be empty')
});

// Email marketing task list parameters
export const ListEmailTasksSchema = z.object({
    page: z.number().int().min(1).optional().default(1),
    size: z.number().int().min(1).max(100).optional().default(20),
    sortBy: z.string().optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    type: z.enum(['email_campaign', 'email_sequence', 'email_blast', 'email_newsletter']).optional()
});

// Email marketing task entity schema
export const EmailMarketingTaskSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.enum(['email_campaign', 'email_sequence', 'email_blast', 'email_newsletter']),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
    priority: z.enum(['low', 'medium', 'high']),
    parameters: z.record(z.any()),
    targetAudience: z.string().optional(),
    subjectLine: z.string().optional(),
    templateId: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    resultsCount: z.number().int().min(0).optional(),
    errorMessage: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    userId: z.string().optional()
});

// Email marketing task list response schema
export const EmailMarketingTaskListDataSchema = z.object({
    tasks: z.array(EmailMarketingTaskSchema),
    pagination: z.object({
        page: z.number().int().min(1),
        size: z.number().int().min(1),
        total: z.number().int().min(0),
        totalPages: z.number().int().min(0)
    })
});

// MCP Email Marketing Task response schemas
export const MCPEmailMarketingTaskResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: EmailMarketingTaskSchema.optional().nullable(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional()
    }).optional()
});

export const MCPEmailMarketingTaskListResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: EmailMarketingTaskListDataSchema.optional().nullable(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional()
    }).optional()
});

// Type exports
export type CreateEmailTaskParams = z.infer<typeof CreateEmailTaskSchema>;
export type UpdateEmailTaskParams = z.infer<typeof UpdateEmailTaskSchema>;
export type GetEmailTaskParams = z.infer<typeof GetEmailTaskSchema>;
export type DeleteEmailTaskParams = z.infer<typeof DeleteEmailTaskSchema>;
export type ListEmailTasksParams = z.infer<typeof ListEmailTasksSchema>;
export type EmailMarketingTask = z.infer<typeof EmailMarketingTaskSchema>;
export type EmailMarketingTaskListData = z.infer<typeof EmailMarketingTaskListDataSchema>;
export type MCPEmailMarketingTaskResponse = z.infer<typeof MCPEmailMarketingTaskResponseSchema>;
export type MCPEmailMarketingTaskListResponse = z.infer<typeof MCPEmailMarketingTaskListResponseSchema>;

