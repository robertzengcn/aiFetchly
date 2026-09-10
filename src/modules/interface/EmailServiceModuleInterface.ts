import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { SortBy, ListData } from "@/entityTypes/commonType";

export interface ValidateEmailServiceOptions {
  readonly mode: "create" | "update" | "send";
  readonly hasStoredPassword?: boolean;
}

export interface EmailServiceValidationError {
  readonly code: EmailServiceValidationCode;
  readonly message: string;
}

export type EmailServiceValidationCode =
  | "service_name_required"
  | "smtp_username_required" // co-fires with from_required (resolver falls back to From)
  | "smtp_username_too_long"
  | "from_required"
  | "from_invalid"
  | "reply_to_invalid"
  | "email_header_break_forbidden"
  | "password_required"
  | "host_required"
  | "port_required"
  | "port_invalid"
  | "receive_config_invalid";

export interface EmailServiceModuleInterface {
  /**
   * Create a new email service
   * @param service The email service entity
   * @returns The ID of the created service
   */
  createEmailService(service: EmailServiceEntity): Promise<number>;

  /**
   * Get an email service by ID
   * @param id The service ID
   * @returns The email service entity
   */
  getEmailService(id: number): Promise<EmailServiceEntity | undefined>;

  /**
   * Update an email service
   * @param id The service ID
   * @param service The email service entity to update
   */
  updateEmailService(id: number, service: EmailServiceEntity): Promise<void>;

  /**
   * Delete an email service
   * @param id The service ID
   */
  deleteEmailService(id: number): Promise<void>;

  /**
   * Update service status
   * @param id The service ID
   * @param status The new status
   */
  updateEmailServiceStatus(id: number, status: number): Promise<void>;

  /**
   * List email services with pagination and sorting
   * @param page Page number (offset)
   * @param size Page size (limit)
   * @param sort Sort parameters (optional)
   * @returns List data containing records and total count
   */
  listEmailServices(
    page: number,
    size: number,
    search?: string,
    sort?: SortBy
  ): Promise<ListData<EmailServiceEntity>>;

  /**
   * Get total number of email services
   * @returns Total count of services
   */
  countEmailServices(): Promise<number>;

  /**
   * Find email service by name
   * @param name The service name
   * @returns The email service entity
   */
  findEmailServiceByName(name: string): Promise<EmailServiceEntity | undefined>;

  /**
   * Find email services by host
   * @param host The host name
   * @returns Array of email service entities
   */
  findEmailServicesByHost(host: string): Promise<EmailServiceEntity[]>;

  /**
   * Get active email services
   * @returns Array of active email service entities
   */
  getActiveEmailServices(): Promise<EmailServiceEntity[]>;

  /**
   * Validate an email service configuration with operation context (§8.1).
   * @param service The entity to validate
   * @param options Operation mode + stored-password availability
   * @returns Validation result with stable field/error codes
   */
  validateEmailService(
    service: EmailServiceEntity,
    options: ValidateEmailServiceOptions
  ): Promise<{ valid: boolean; errors: EmailServiceValidationError[] }>;

  /**
   * Read the complete effective identity snapshot for a service (§22.2).
   * Returns null when the service does not exist.
   */
  readIdentity(id: number): Promise<{
    smtpUsername: string;
    fromAddress: string;
    replyToAddress: string | null;
    receiveUsername: string;
  } | null>;

  /**
   * List ALL email services for export (no pagination, no search filter).
   * Intended for the export feature; callers must project to non-secret
   * fields before the data leaves the main process.
   * @returns Array of email service entities
   */
  exportEmailServicesList(): Promise<EmailServiceEntity[]>;
}
