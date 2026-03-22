/**
 * Email Template Variables Registry
 *
 * Central registry of all approved template variables that can be used in AI-generated email templates.
 * Variables must follow the pattern {$variable_name} and will be validated during generation.
 *
 * @module config/emailTemplateVariables
 */

/**
 * All available email template variables
 */
export const EMAIL_TEMPLATE_VARIABLES = {
    SEND_TIME: '{$send_time}',
    SENDER: '{$sender}',
    RECEIVER_EMAIL: '{$receiver_email}',
    RECEIVER_NAME: '{$receiver_name}',
    URL: '{$url}',
    DESCRIPTION: '{$description}',
    COMPANY_NAME: '{$company_name}',
    CAMPAIGN_NAME: '{$campaign_name}'
} as const;

/**
 * Type representing a single email template variable
 */
export type EmailTemplateVariable = typeof EMAIL_TEMPLATE_VARIABLES[keyof typeof EMAIL_TEMPLATE_VARIABLES];

/**
 * Array of all available template variables for validation
 */
export const EMAIL_TEMPLATE_VARIABLE_LIST: EmailTemplateVariable[] = Object.values(EMAIL_TEMPLATE_VARIABLES);

/**
 * Human-readable descriptions for each template variable
 */
export const VARIABLE_DESCRIPTIONS: Record<EmailTemplateVariable, string> = {
    [EMAIL_TEMPLATE_VARIABLES.SEND_TIME]: 'Replaced with send timestamp (YYYY-MM-DD HH:mm:ss)',
    [EMAIL_TEMPLATE_VARIABLES.SENDER]: 'Replaced with sender email/name',
    [EMAIL_TEMPLATE_VARIABLES.RECEIVER_EMAIL]: 'Replaced with recipient email address',
    [EMAIL_TEMPLATE_VARIABLES.RECEIVER_NAME]: 'Replaced with recipient name for personalization',
    [EMAIL_TEMPLATE_VARIABLES.URL]: 'Replaced with source URL or landing page',
    [EMAIL_TEMPLATE_VARIABLES.DESCRIPTION]: 'Replaced with contextual description',
    [EMAIL_TEMPLATE_VARIABLES.COMPANY_NAME]: 'Replaced with recipient company name',
    [EMAIL_TEMPLATE_VARIABLES.CAMPAIGN_NAME]: 'Replaced with campaign name'
};

/**
 * Variable categories for UI organization
 */
export const VARIABLE_CATEGORIES = {
    REQUIRED: [EMAIL_TEMPLATE_VARIABLES.SEND_TIME, EMAIL_TEMPLATE_VARIABLES.SENDER, EMAIL_TEMPLATE_VARIABLES.RECEIVER_EMAIL],
    PERSONALIZATION: [EMAIL_TEMPLATE_VARIABLES.RECEIVER_NAME, EMAIL_TEMPLATE_VARIABLES.COMPANY_NAME],
    CONTENT: [EMAIL_TEMPLATE_VARIABLES.URL, EMAIL_TEMPLATE_VARIABLES.DESCRIPTION, EMAIL_TEMPLATE_VARIABLES.CAMPAIGN_NAME]
} as const;
