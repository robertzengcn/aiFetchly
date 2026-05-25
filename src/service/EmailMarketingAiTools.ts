import { ZodError } from "zod";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import { EmailItem } from "@/entityTypes/emailmarketingType";
import {
  Buckemailstruct,
  BulkEmailPreviewResult,
  BulkEmailStartResult,
  mapBuckemailTaskStartInputToEntity,
} from "@/entityTypes/emailmarketingType";
import { EmailFilterModule } from "@/modules/EmailFilterModule";
import { EmailFilterDetailModule } from "@/modules/EmailFilterDetailModule";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailTemplateModule } from "@/modules/EmailTemplateModule";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import {
  DIRECT_EMAIL_SOURCE,
  EmailSearchTaskSummary,
  EmailServiceConfigSummary,
  EmailMarketingAiToolResult,
  EmailMarketingDirectEmailInput,
  EmailMarketingFilterSummary,
  EmailMarketingListResult,
  EmailMarketingTemplateSummary,
  SanitizedEmailService,
  AiListEmailSearchTasksResult,
  AiEmailSearchTaskEmailsResult,
  bulkEmailTaskInputSchema,
  emailMarketingPaginationSchema,
  getEmailServiceConfigInputSchema,
  getEmailSearchTaskEmailsInputSchema,
} from "@/entityTypes/emailMarketingAiTypes";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function validationFailure(error: ZodError): {
  success: false;
  error: string;
  validation_errors: string[];
} {
  return {
    success: false,
    error: "Invalid email marketing tool input",
    validation_errors: error.issues.map((issue) => issue.message),
  };
}

function failure(error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: formatError(error),
  };
}

function normalizeDirectEmail(
  email: EmailMarketingDirectEmailInput
): EmailItem {
  if (typeof email === "string") {
    return {
      address: email.trim(),
      source: DIRECT_EMAIL_SOURCE,
    };
  }

  return {
    title: email.title,
    address: email.address.trim(),
    source: email.source?.trim() || DIRECT_EMAIL_SOURCE,
  };
}

export function dedupeEmailList(
  emails: EmailItem[],
  notDuplicate: boolean
): EmailItem[] {
  if (!notDuplicate) {
    return emails;
  }

  const seen = new Set<string>();
  const deduped: EmailItem[] = [];

  for (const email of emails) {
    const address = email.address.trim();
    const normalizedAddress = address.toLowerCase();

    if (seen.has(normalizedAddress)) {
      continue;
    }

    seen.add(normalizedAddress);
    deduped.push({
      ...email,
      address,
    });
  }

  return deduped;
}

async function getSearchTaskRecipients(
  taskId: number,
  existingModule?: EmailSearchTaskModule
): Promise<{ emails: EmailItem[]; module: EmailSearchTaskModule }> {
  const module = existingModule ?? new EmailSearchTaskModule();
  await module.ensureConnection();
  const emails = await module.getAllEmails(taskId);

  if (emails.length === 0) {
    throw new Error("Email search task has no recipients");
  }

  return { emails, module };
}

interface ParsedBulkEmailTaskInput {
  email_search_task_id?: number;
  emails?: EmailMarketingDirectEmailInput[];
  template_ids: number[];
  filter_ids: number[];
  service_ids: number[];
  not_duplicate: boolean;
  email_subject?: string;
  email_html_content?: string;
  uses_templates: boolean;
  uses_inline_content: boolean;
}

function parseBulkEmailTaskInput(args: unknown): ParsedBulkEmailTaskInput {
  const parsed = bulkEmailTaskInputSchema.parse(args);
  const hasSearchTask = parsed.email_search_task_id !== undefined;
  const hasDirectEmails =
    parsed.emails !== undefined && parsed.emails.length > 0;

  if (hasSearchTask === hasDirectEmails) {
    throw new Error("Provide exactly one of email_search_task_id or emails");
  }

  const templateIds = parsed.template_ids ?? [];
  const subject = parsed.email_subject?.trim();
  const html = parsed.email_html_content?.trim();
  const usesTemplates = templateIds.length > 0;
  const usesInlineContent = Boolean(subject && html);

  if (!usesTemplates && !usesInlineContent) {
    throw new Error(
      "Provide either template_ids or email_subject and email_html_content"
    );
  }

  return {
    email_search_task_id: parsed.email_search_task_id,
    emails: parsed.emails,
    template_ids: templateIds,
    filter_ids: parsed.filter_ids ?? [],
    service_ids: parsed.service_ids,
    not_duplicate: parsed.not_duplicate,
    email_subject: usesInlineContent ? subject : undefined,
    email_html_content: usesInlineContent ? html : undefined,
    uses_templates: usesTemplates,
    uses_inline_content: usesInlineContent,
  };
}

export async function resolveBulkRecipients(input: {
  email_search_task_id?: number;
  emails?: EmailMarketingDirectEmailInput[];
  not_duplicate: boolean;
  searchTaskModule?: EmailSearchTaskModule;
}): Promise<{
  recipientSource: "email_search_task" | "direct";
  recipients: EmailItem[];
  searchTaskModule?: EmailSearchTaskModule;
}> {
  const hasSearchTask = input.email_search_task_id !== undefined;
  const hasDirectEmails = input.emails !== undefined && input.emails.length > 0;

  if (hasSearchTask === hasDirectEmails) {
    throw new Error("Provide exactly one of email_search_task_id or emails");
  }

  if (input.email_search_task_id !== undefined) {
    const { emails, module } = await getSearchTaskRecipients(
      input.email_search_task_id,
      input.searchTaskModule
    );
    return {
      recipientSource: "email_search_task",
      recipients: emails.map((email) => toEmailItem(email)),
      searchTaskModule: module,
    };
  }

  const directEmails = (input.emails ?? []).map((email) =>
    toEmailItem(normalizeDirectEmail(email))
  );

  return {
    recipientSource: "direct",
    recipients: dedupeEmailList(directEmails, input.not_duplicate),
  };
}

function toEmailItem(email: EmailMarketingDirectEmailInput): EmailItem {
  if (typeof email === "string") {
    return {
      address: email.trim(),
      source: DIRECT_EMAIL_SOURCE,
    };
  }
  return {
    title: email.title,
    address: email.address,
    source: email.source ?? DIRECT_EMAIL_SOURCE,
  };
}

function toEmailItemFromSearchResult(
  item: string | { address: string; source?: string; title?: string }
): EmailItem {
  if (typeof item === "string") {
    return { title: item, address: item, source: DIRECT_EMAIL_SOURCE };
  }
  const title =
    "title" in item && typeof item.title === "string"
      ? item.title
      : item.address;
  return {
    title,
    address: item.address,
    source: item.source ?? DIRECT_EMAIL_SOURCE,
  };
}

function isEmailServiceEntity(item: unknown): item is {
  id: number;
  name: string;
  from: string;
  host: string;
  port: string;
  ssl: number;
  status: number;
} {
  return (
    typeof item === "object" && item !== null && "id" in item && "name" in item
  );
}

function sanitizeEmailService(service: {
  id: number;
  name: string;
  from: string;
  host: string;
  port: string;
  ssl: number;
  status: number;
}): SanitizedEmailService {
  return {
    id: service.id,
    name: service.name,
    address: service.from,
    source: service.host,
    port: String(service.port),
    ssl: service.ssl,
    status: service.status,
  };
}

function makeBuckEmailTaskInput(input: {
  email_search_task_id?: number;
  emails?: EmailItem[];
  template_ids?: number[];
  filter_ids?: number[];
  service_ids?: number[];
  not_duplicate?: boolean;
  email_subject?: string;
  email_html_content?: string;
}): Buckemailstruct {
  const taskInput: Buckemailstruct = {
    EmailBtype: BuckEmailType.EXTRACTEMAIL,
    EmailtaskentityId: input.email_search_task_id,
    EmailList: input.emails,
    EmailTemplateslist: input.template_ids ?? [],
    EmailFilterlist: input.filter_ids ?? [],
    EmailServicelist: input.service_ids ?? [],
    NotDuplicate: input.not_duplicate ?? false,
  };
  if (input.email_subject !== undefined) {
    taskInput.email_subject = input.email_subject;
  }
  if (input.email_html_content !== undefined) {
    taskInput.email_html_content = input.email_html_content;
  }
  return taskInput;
}

export async function listEmailTemplates(
  args: unknown
): Promise<
  EmailMarketingAiToolResult<
    EmailMarketingListResult<EmailMarketingTemplateSummary>
  >
> {
  try {
    const input = emailMarketingPaginationSchema.parse(args);
    const module = new EmailTemplateModule();
    await module.ensureConnection();

    const records = await module.listEmailTemplates(
      input.page,
      input.size,
      input.search
    );
    const total = await module.countEmailTemplates();

    return {
      success: true,
      records: records.map((template) => ({
        id: template.id,
        title: template.title,
        description: template.description,
        status: template.status,
      })),
      total,
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

export async function listEmailFilters(
  args: unknown
): Promise<
  EmailMarketingAiToolResult<
    EmailMarketingListResult<EmailMarketingFilterSummary>
  >
> {
  try {
    const input = emailMarketingPaginationSchema.parse(args);
    const module = new EmailFilterModule();
    const detailModule = new EmailFilterDetailModule();
    await module.ensureConnection();

    const filters = await module.listEmailFilters(
      input.page,
      input.size,
      input.search
    );
    const total = await module.countEmailFilters();

    // Batch-load all filter details in one query instead of N+1
    const filterIds = filters.map((f) => f.id);
    const allDetails =
      filterIds.length > 0
        ? await detailModule.getEmailFilterDetailsByFilterIds(filterIds)
        : [];

    // Group details by filter_id
    const detailsByFilterId = new Map<number, string[]>();
    for (const detail of allDetails) {
      const existing = detailsByFilterId.get(detail.filter_id) ?? [];
      existing.push(detail.content);
      detailsByFilterId.set(detail.filter_id, existing);
    }

    const records: EmailMarketingFilterSummary[] = filters.map((filter) => ({
      id: filter.id,
      name: filter.name,
      description: filter.description,
      status: filter.status,
      filterDetails: detailsByFilterId.get(filter.id) ?? [],
    }));

    return {
      success: true,
      records,
      total,
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

export async function listEmailServices(
  args: unknown
): Promise<
  EmailMarketingAiToolResult<EmailMarketingListResult<SanitizedEmailService>>
> {
  try {
    const input = emailMarketingPaginationSchema.parse(args);
    const module = new EmailServiceModule();
    await module.ensureConnection();

    const result = await module.listEmailServices(
      input.page,
      input.size,
      input.search
    );

    return {
      success: true,
      records: result.records.map((service) => sanitizeEmailService(service)),
      total: result.num,
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

export async function getEmailServiceConfig(
  args: unknown
): Promise<EmailMarketingAiToolResult<EmailServiceConfigSummary>> {
  try {
    const input = getEmailServiceConfigInputSchema.parse(args);
    const module = new EmailServiceModule();
    await module.ensureConnection();

    const service = await module.getEmailService(input.service_id);
    if (!service) {
      throw new Error(`Email service ${input.service_id} not found`);
    }

    return {
      success: true,
      service: sanitizeEmailService(service),
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

export async function getEmailSearchTaskEmails(
  args: unknown
): Promise<EmailMarketingAiToolResult<AiEmailSearchTaskEmailsResult>> {
  try {
    const input = getEmailSearchTaskEmailsInputSchema.parse(args);
    const { emails } = await getSearchTaskRecipients(
      input.email_search_task_id
    );

    return {
      success: true,
      email_search_task_id: input.email_search_task_id,
      total: emails.length,
      emails: emails as EmailItem[],
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

export async function listEmailSearchTasks(
  args: unknown
): Promise<EmailMarketingAiToolResult<AiListEmailSearchTasksResult>> {
  try {
    const input = emailMarketingPaginationSchema.parse(args);
    const module = new EmailSearchTaskModule();
    await module.ensureConnection();

    const result = await module.listSearchtask(input.page, input.size);

    return {
      success: true,
      records: result.records.map(
        (task): EmailSearchTaskSummary => ({
          id: task.id,
          status: task.status,
          status_name: module.taskstatusConvert(task.status),
          type_id: task.type_id,
          type_name: module.taskTypeconvert(task.type_id),
          record_time: task.record_time,
          search_result_id: task.search_result_id,
          concurrency: task.concurrency,
          page_length: task.page_length,
        })
      ),
      total: result.total,
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

export { DIRECT_EMAIL_SOURCE } from "@/entityTypes/emailMarketingAiTypes";

export async function previewBulkEmailSendTask(
  args: unknown
): Promise<EmailMarketingAiToolResult<BulkEmailPreviewResult>> {
  try {
    const input = bulkEmailTaskInputSchema.parse(args);
    const recipients = await resolveBulkRecipients(input);

    return {
      success: true,
      recipient_source: recipients.recipientSource,
      recipient_count: recipients.recipients.length,
      template_ids: input.template_ids,
      filter_ids: input.filter_ids,
      service_ids: input.service_ids,
      not_duplicate: input.not_duplicate,
      ...(input.email_subject !== undefined &&
      input.email_html_content !== undefined
        ? {
            email_subject: input.email_subject,
            email_html_content: input.email_html_content,
          }
        : {}),
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

export async function startBulkEmailSendTask(
  args: unknown
): Promise<EmailMarketingAiToolResult<BulkEmailStartResult>> {
  try {
    const input = bulkEmailTaskInputSchema.parse(args);
    const recipients = await resolveBulkRecipients(input);
    const module = new BuckEmailTaskModule();
    await module.ensureConnection();

    const taskInput = makeBuckEmailTaskInput({
      ...input,
      // emailtaskentityId, so we pass undefined here to avoid storing a
      // redundant copy in email_list_json. For direct sends, the EmailList is
      // serialized to email_list_json so prepareData() can load it without a
      // search task.
      emails:
        recipients.recipientSource === "direct"
          ? recipients.recipients
          : undefined,
    });
    const entity = mapBuckemailTaskStartInputToEntity(taskInput);
    const taskId = await module.startBuckEmailTask(entity, {
      waitForExit: true,
    });

    return {
      success: true,
      task_id: taskId,
      recipient_source: recipients.recipientSource,
      recipient_count: recipients.recipients.length,
      template_ids: input.template_ids,
      filter_ids: input.filter_ids,
      service_ids: input.service_ids,
      not_duplicate: input.not_duplicate,
      ...(input.email_subject !== undefined &&
      input.email_html_content !== undefined
        ? {
            email_subject: input.email_subject,
            email_html_content: input.email_html_content,
          }
        : {}),
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}
