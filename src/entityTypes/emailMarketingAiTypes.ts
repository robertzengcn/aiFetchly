import { z } from "zod";
import { EmailItem } from "@/entityTypes/emailmarketingType";

export const DIRECT_EMAIL_SOURCE = "ai_chat_direct_input";

export const emailMarketingPaginationSchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
});

export const emailMarketingIdSchema = z.coerce.number().int().positive();

export const emailMarketingEmailItemSchema = z.object({
  address: z.string().trim().email(),
  title: z.string().trim().optional(),
  source: z.string().trim().min(1).optional(),
});

export const emailMarketingEmailInputSchema = z.union([
  z.string().trim().email(),
  emailMarketingEmailItemSchema,
]);

export const getEmailSearchTaskEmailsInputSchema = z.object({
  email_search_task_id: emailMarketingIdSchema,
});

export const getEmailServiceConfigInputSchema = z.object({
  service_id: emailMarketingIdSchema,
});

export const bulkEmailContentSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(50000),
});

const bulkEmailBaseSchema = z.object({
  email_search_task_id: emailMarketingIdSchema.optional(),
  emails: z.array(emailMarketingEmailInputSchema).min(1).optional(),
  template_ids: z.array(emailMarketingIdSchema).optional(),
  email_subject: z.string().trim().min(1).max(500).optional(),
  email_html_content: z.string().trim().min(1).max(50000).optional(),
  filter_ids: z.array(emailMarketingIdSchema).default([]),
  service_ids: z.array(emailMarketingIdSchema).min(1),
  not_duplicate: z.boolean().default(true),
});

export const bulkEmailTaskInputSchema = bulkEmailBaseSchema.superRefine(
  (data, ctx) => {
    const hasSearchTask =
      data.email_search_task_id !== undefined && data.email_search_task_id > 0;
    const hasEmails = data.emails !== undefined && data.emails.length > 0;
    const hasTemplates =
      data.template_ids !== undefined && data.template_ids.length > 0;
    const hasSubject =
      data.email_subject !== undefined && data.email_subject.trim().length > 0;
    const hasHtml =
      data.email_html_content !== undefined &&
      data.email_html_content.trim().length > 0;
    const hasInlineContent = hasSubject && hasHtml;

    if (hasSearchTask === hasEmails) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of email_search_task_id or emails",
        path: ["email_search_task_id"],
      });
    }

    if (!hasTemplates && !hasInlineContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either template_ids or email_subject and email_html_content",
        path: ["template_ids"],
      });
    }
  }
);

export type EmailMarketingPaginationInput = z.infer<
  typeof emailMarketingPaginationSchema
>;
export type GetEmailSearchTaskEmailsInput = z.infer<
  typeof getEmailSearchTaskEmailsInputSchema
>;
export type GetEmailServiceConfigInput = z.infer<
  typeof getEmailServiceConfigInputSchema
>;
export type BulkEmailTaskInput = z.infer<typeof bulkEmailTaskInputSchema>;
export type EmailMarketingDirectEmailInput = z.infer<
  typeof emailMarketingEmailInputSchema
>;
export type EmailRecipientInput = EmailMarketingDirectEmailInput;

/** Summary of an email search task */
export interface EmailSearchTaskSummary {
  id: number;
  status: number;
  status_name: string;
  type_id: number;
  type_name: string;
  record_time: string;
  search_result_id: number;
  concurrency: number;
  page_length: number;
}

/** Sanitized email service (password excluded) */
export interface SanitizedEmailService {
  id: number;
  name: string;
  address: string;
  source: string;
  port: string;
  ssl: number;
  status: number;
}

/** Email service config returned to AI tools */
export interface EmailServiceConfigSummary {
  service: SanitizedEmailService;
}

/** Email marketing template summary for AI tools */
export interface EmailMarketingTemplateSummary {
  id: number;
  title: string;
  description: string | null;
  status: number;
}

/** Email marketing filter summary for AI tools */
export interface EmailMarketingFilterSummary {
  id: number;
  name: string;
  description: string | null;
  status: number;
  filterDetails: string[];
}

/** Paginated list result for AI tools */
export interface EmailMarketingListResult<T> {
  success: boolean;
  records: T[];
  total: number;
  error?: string;
  validation_errors?: string[];
}

/** Result wrapper for AI tool responses */
export type EmailMarketingAiToolResult<T> =
  | ({ success: true } & T & Record<string, unknown>)
  | { success: false; error: string; validation_errors?: string[] };

/** AI tool result for listing email search tasks */
export interface AiListEmailSearchTasksResult {
  records: EmailSearchTaskSummary[];
  total: number;
}

/** AI tool result for getting search task emails */
export interface AiEmailSearchTaskEmailsResult {
  email_search_task_id: number;
  total: number;
  emails: EmailItem[];
}

export type {
  BulkEmailPreviewResult,
  BulkEmailStartResult,
  Buckemailstruct,
  BuckemailTaskStartInput,
} from "@/entityTypes/emailmarketingType";
