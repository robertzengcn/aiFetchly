import type { EmailOrganizationErrorCode } from "@/entityTypes/emailOrganizationTypes";

/**
 * Typed failure for organization actions. `code` is a stable reason code the
 * UI maps to localized text; `sanitizedMessage` never contains credentials,
 * raw provider dumps or message bodies.
 */
export class EmailOrganizationActionError extends Error {
  public readonly code: EmailOrganizationErrorCode;
  public readonly retryable: boolean;

  constructor(code: EmailOrganizationErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "EmailOrganizationActionError";
    this.code = code;
    this.retryable = retryable;
  }
}
