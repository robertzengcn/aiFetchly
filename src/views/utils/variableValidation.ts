/**
 * Email Template Variable Validation Utilities
 *
 * Provides validation functions for AI-generated email templates to ensure
 * only approved template variables are used.
 *
 * @module views/utils/variableValidation
 */

import {
  EMAIL_TEMPLATE_VARIABLE_LIST,
  type EmailTemplateVariable,
} from "@/config/emailTemplateVariables";
import type {
  ValidationResult,
  AIEmailTemplateRequest,
} from "@/entityTypes/emailmarketingType";

/**
 * Validate AI output variables
 *
 * Checks if AI-generated content contains only valid template variables.
 * Returns validation result with list of invalid variables and sanitized content.
 *
 * @param content - The AI-generated content to validate
 * @returns ValidationResult with isValid flag, invalid variables list, and sanitized content
 */
export function validateAIOutputVariables(content: string): ValidationResult {
  const invalidVariables: string[] = [];
  const variablePattern = /\{\$([^}]+)\}/g;
  let match: RegExpExecArray | null;

  // Extract all variables from content
  while ((match = variablePattern.exec(content)) !== null) {
    const variable = `{$${match[1]}}`;
    if (
      !EMAIL_TEMPLATE_VARIABLE_LIST.includes(variable as EmailTemplateVariable)
    ) {
      invalidVariables.push(variable);
    }
  }

  // Auto-correction: strip invalid variables
  let sanitizedContent = content;
  if (invalidVariables.length > 0) {
    console.warn(`Invalid variables found: ${invalidVariables.join(", ")}`);
    sanitizedContent = content.replace(variablePattern, (matched) => {
      return EMAIL_TEMPLATE_VARIABLE_LIST.includes(
        matched as EmailTemplateVariable
      )
        ? matched
        : "";
    });
  }

  return {
    isValid: invalidVariables.length === 0,
    invalidVariables,
    sanitizedContent,
  };
}

/**
 * Validate AI request parameters
 *
 * Validates that the AI email template generation request contains all required
 * fields with valid values.
 *
 * @param request - The request to validate
 * @returns ValidationResult with isValid flag and list of errors
 */
export function validateAIRequest(
  request: AIEmailTemplateRequest
): ValidationResult {
  const errors: string[] = [];

  // Check required fields
  if (!request.prompt || request.prompt.trim().length < 10) {
    errors.push("Prompt must be at least 10 characters");
  }
  if (request.prompt.length > 500) {
    errors.push("Prompt must not exceed 500 characters");
  }

  // Validate tone
  const validTones: EmailTemplateTone[] = [
    "formal",
    "casual",
    "friendly",
    "professional",
  ];
  if (!validTones.includes(request.tone)) {
    errors.push(`Invalid tone value: ${request.tone}`);
  }

  // Validate template type
  const validTypes: EmailTemplateType[] = [
    "cold_outreach",
    "follow_up",
    "newsletter",
    "promotion",
    "custom",
  ];
  if (!validTypes.includes(request.templateType)) {
    errors.push(`Invalid template type: ${request.templateType}`);
  }

  // Validate RAG limit
  if (request.ragLimit !== undefined) {
    if (request.ragLimit < 1 || request.ragLimit > 20) {
      errors.push("RAG limit must be between 1 and 20");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Parse email template from AI stream content
 *
 * Extracts title and content from AI-generated text in the format:
 * Subject: [title]
 *
 * [content]
 *
 * @param streamContent - The full content from the AI stream
 * @returns Object with title and content
 */
export function parseEmailTemplateFromStream(streamContent: string): {
  title: string;
  content: string;
} {
  const lines = streamContent.split("\n");
  let title = "";
  let content = "";
  let foundSubject = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.toLowerCase().startsWith("subject:")) {
      title = line.replace(/^subject:\s*/i, "").trim();
      foundSubject = true;
    } else if (foundSubject) {
      // Skip empty lines after subject
      if (content || line.trim()) {
        content += (content ? "\n" : "") + line;
      }
    }
  }

  // If no subject line found, treat first line as title
  if (!foundSubject) {
    const firstLineBreak = streamContent.indexOf("\n");
    if (firstLineBreak > 0) {
      title = streamContent.substring(0, firstLineBreak).trim();
      content = streamContent.substring(firstLineBreak + 1).trim();
    } else {
      title = "Untitled Email";
      content = streamContent.trim();
    }
  }

  return { title: title || "Untitled Email", content: content.trim() };
}

/**
 * Extract all template variables from content
 *
 * Parses content and returns a list of all template variables found.
 *
 * @param content - The content to parse
 * @returns Array of template variables found in the content
 */
export function extractVariables(content: string): EmailTemplateVariable[] {
  const variables: EmailTemplateVariable[] = [];
  const variablePattern = /\{\$([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = variablePattern.exec(content)) !== null) {
    const variable = `{$${match[1]}}`;
    if (
      EMAIL_TEMPLATE_VARIABLE_LIST.includes(variable as EmailTemplateVariable)
    ) {
      if (!variables.includes(variable as EmailTemplateVariable)) {
        variables.push(variable as EmailTemplateVariable);
      }
    }
  }

  return variables;
}

/**
 * Type imports for type checking
 */
type EmailTemplateTone = "formal" | "casual" | "friendly" | "professional";
type EmailTemplateType =
  | "cold_outreach"
  | "follow_up"
  | "newsletter"
  | "promotion"
  | "custom";
