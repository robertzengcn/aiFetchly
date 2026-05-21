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

const bulkEmailBaseSchema = z.object({
  email_search_task_id: emailMarketingIdSchema.optional(),
  emails: z.array(emailMarketingEmailInputSchema).min(1).optional(),
  template_ids: z.array(emailMarketingIdSchema).min(1),
  filter_ids: z.array(emailMarketingIdSchema).default([]),
  service_ids: z.array(emailMarketingIdSchema).min(1),
  not_duplicate: z.boolean().default(true),
});

export const bulkEmailTaskInputSchema = bulkEmailBaseSchema.refine(
  (value) =>
    (value.email_search_task_id !== undefined) !==
    (value.emails !== undefined && value.emails.length > 0),
  {
    message: "Provide exactly one of email_search_task_id or emails",
    path: ["email_search_task_id"],
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

export type SanitizedEmailService = {
  id: number;
  name: string;
  from: string;
  host: string;
  port: string;
  ssl: number;
  status: number;
};

export type EmailServiceConfigSummary = {
  service: SanitizedEmailService;
};

export type EmailMarketingTemplateSummary = {
  id: number;
  title: string;
  description: string | null;
  status: number;
};

export type EmailMarketingFilterSummary = {
  id: number;
  name: string;
  description: string | null;
  status: number;
  filterDetails?: string[];
};

export type EmailSearchTaskSummary = {
  id: number;
  status: number;
  status_name: string;
  type_id: number;
  type_name: string;
  record_time: string;
  search_result_id: number;
  concurrency: number;
  page_length: number;
};

export type ListEmailSearchTasksResult =
  EmailMarketingListResult<EmailSearchTaskSummary>;

export type EmailMarketingListResult<T> = {
  success: true;
  records: T[];
  total: number;
};

export type EmailMarketingFailureResult = {
  success: false;
  error: string;
  validation_errors?: string[];
};

export type EmailMarketingAiToolResult<T> =
  | (T & { success: true })
  | EmailMarketingFailureResult;

export type EmailSearchTaskEmailsResult = {
  success: true;
  email_search_task_id: number;
  total: number;
  emails: EmailItem[];
};

export type BulkEmailPreviewResult = {
  success: true;
  recipient_source: "email_search_task" | "direct";
  recipient_count: number;
  template_ids: number[];
  filter_ids: number[];
  service_ids: number[];
  not_duplicate: boolean;
};

export type BulkEmailStartResult = BulkEmailPreviewResult & {
  task_id: number;
};
