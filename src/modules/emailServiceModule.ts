import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { SortBy } from "@/entityTypes/commonType";
import { ListData } from "@/entityTypes/commonType";
import { EmailServiceModuleInterface } from "@/modules/interface/EmailServiceModuleInterface";
import {
  EmailReceiveConnectionConfig,
  EmailReceiveProtocol,
} from "@/entityTypes/emailReceiveTypes";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";

export class EmailServiceModule
  extends BaseModule
  implements EmailServiceModuleInterface
{
  private emailServiceModel: EmailServiceModel;

  constructor() {
    super();
    this.emailServiceModel = new EmailServiceModel(this.dbpath);
  }

  async createEmailService(service: EmailServiceEntity): Promise<number> {
    try {
      const encryptedService = await this.encryptCredentialsForStorage(service);
      return await this.emailServiceModel.create(encryptedService);
    } catch (error) {
      log.error("Error creating email service:", error);
      throw error;
    }
  }

  async getEmailService(id: number): Promise<EmailServiceEntity | undefined> {
    try {
      const service = await this.emailServiceModel.read(id);
      return await this.decryptServiceCredentials(service);
    } catch (error) {
      log.error("Error getting email service:", error);
      throw error;
    }
  }

  async updateEmailService(
    id: number,
    service: EmailServiceEntity
  ): Promise<void> {
    try {
      const encryptedService = await this.encryptCredentialsForStorage(service);
      await this.emailServiceModel.update(id, encryptedService);
    } catch (error) {
      log.error("Error updating email service:", error);
      throw error;
    }
  }

  async deleteEmailService(id: number): Promise<void> {
    try {
      // Retention consistency (P4.4): purge ALL reply-reliability data for this
      // mailbox BEFORE deleting the service row, so nothing is orphaned. Runs
      // in one transaction; a failure aborts the mailbox deletion.
      const { EmailReplyRetentionService } = await import(
        "@/service/emailReply/EmailReplyRetentionService"
      );
      const purged = await new EmailReplyRetentionService().purgeMailboxData(
        id
      );
      console.log(
        `[reply-retention] mailbox ${id} deleted: purged ${purged.drafts} drafts, ` +
          `${purged.revisions} revisions, ${purged.approvals} approvals, ` +
          `${purged.attempts} attempts, ${purged.messages} messages, ` +
          `${purged.conversations} conversations, ${purged.auditRows} audit rows`
      );
      await this.emailServiceModel.delete(id);
    } catch (error) {
      log.error("Error deleting email service:", error);
      throw error;
    }
  }

  async updateEmailServiceStatus(id: number, status: number): Promise<void> {
    try {
      await this.emailServiceModel.updateServiceStatus(id, status);
    } catch (error) {
      log.error("Error updating email service status:", error);
      throw error;
    }
  }

  async listEmailServices(
    page: number,
    size: number,
    search?: string,
    sort?: SortBy
  ): Promise<ListData<EmailServiceEntity>> {
    try {
      const records = await this.emailServiceModel.listEmailServices(
        page,
        size,
        search,
        sort
      );
      const num = await this.emailServiceModel.countEmailServices();

      return {
        records: await this.decryptServiceCredentialsList(records),
        num,
      };
    } catch (error) {
      log.error("Error listing email services:", error);
      throw error;
    }
  }

  async countEmailServices(): Promise<number> {
    try {
      return await this.emailServiceModel.countEmailServices();
    } catch (error) {
      log.error("Error counting email services:", error);
      throw error;
    }
  }

  async findEmailServiceByName(
    name: string
  ): Promise<EmailServiceEntity | undefined> {
    try {
      const service = await this.emailServiceModel.findByName(name);
      return await this.decryptServiceCredentials(service);
    } catch (error) {
      log.error("Error finding email service by name:", error);
      throw error;
    }
  }

  async findEmailServicesByHost(host: string): Promise<EmailServiceEntity[]> {
    try {
      const services = await this.emailServiceModel.findByHost(host);
      return await this.decryptServiceCredentialsList(services);
    } catch (error) {
      log.error("Error finding email services by host:", error);
      throw error;
    }
  }

  async getActiveEmailServices(): Promise<EmailServiceEntity[]> {
    try {
      const allServices = await this.emailServiceModel.listEmailServices(
        0,
        1000
      );
      const decryptedServices = await this.decryptServiceCredentialsList(
        allServices
      );
      return decryptedServices.filter((service) => service.status === 1);
    } catch (error) {
      log.error("Error getting active email services:", error);
      throw error;
    }
  }

  /** Services with inbound receive enabled. */
  async listReceiveEnabledServices(): Promise<EmailServiceEntity[]> {
    try {
      await this.ensureConnection();
      const services = await this.emailServiceModel.listReceiveEnabled();
      return await this.decryptServiceCredentialsList(services);
    } catch (error) {
      log.error("Error listing receive-enabled services:", error);
      throw error;
    }
  }

  /** Update receive sync tracking (timestamp + sanitized error). */
  async updateReceiveSyncState(
    id: number,
    lastReceiveSyncAt: Date | null,
    lastReceiveSyncError: string | null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.emailServiceModel.updateReceiveSyncState(
        id,
        lastReceiveSyncAt,
        lastReceiveSyncError
      );
    } catch (error) {
      log.error("Error updating receive sync state:", error);
      throw error;
    }
  }

  /**
   * Resolve the receive connection config for an email service.
   * Main-process only — the result carries the receive password and must
   * never be returned to the renderer or surfaced in an AI tool result.
   * Returns null when the service is missing, receive is disabled, or required
   * fields are absent.
   */
  async getEmailServiceReceiveConfig(
    id: number
  ): Promise<EmailReceiveConnectionConfig | null> {
    try {
      await this.ensureConnection();
      const service = await this.getEmailService(id);
      if (!service || service.receiveEnabled !== 1) return null;

      const protocol: EmailReceiveProtocol =
        service.receiveProtocol === "pop3" ? "pop3" : "imap";
      const host = protocol === "imap" ? service.imapHost : service.pop3Host;
      const portStr = protocol === "imap" ? service.imapPort : service.pop3Port;
      const ssl = protocol === "imap" ? service.imapSsl : service.pop3Ssl;
      if (!host || !portStr) return null;

      // Username defaults to the SMTP `from` address when not provided.
      const username =
        service.receiveUsername && service.receiveUsername.trim().length > 0
          ? service.receiveUsername
          : service.from ?? "";
      // Password defaults to the SMTP password when not provided.
      const password =
        service.receivePassword && service.receivePassword.length > 0
          ? service.receivePassword
          : service.password ?? "";
      if (!username || !password) return null;

      return {
        emailServiceId: service.id,
        protocol,
        host,
        port: Number(portStr),
        ssl: ssl === 1,
        username,
        password,
        folder: service.receiveFolder || "INBOX",
      };
    } catch (error) {
      log.error("Error resolving receive connection config:", error);
      throw error;
    }
  }

  async validateEmailService(
    service: EmailServiceEntity
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!service.name || service.name.trim().length === 0) {
      errors.push("Service name is required");
    }

    if (!service.from || service.from.trim().length === 0) {
      errors.push("From email is required");
    } else if (!this.isValidEmail(service.from)) {
      errors.push("From email format is invalid");
    }

    if (!service.password || service.password.trim().length === 0) {
      errors.push("Password is required");
    }

    if (!service.host || service.host.trim().length === 0) {
      errors.push("Host is required");
    }

    if (!service.port || service.port.trim().length === 0) {
      errors.push("Port is required");
    } else if (isNaN(Number(service.port))) {
      errors.push("Port must be a valid number");
    }

    // Receive settings are only validated when receive is enabled.
    if (service.receiveEnabled === 1) {
      const protocol: EmailReceiveProtocol =
        service.receiveProtocol === "pop3" ? "pop3" : "imap";
      const host = protocol === "imap" ? service.imapHost : service.pop3Host;
      const portStr = protocol === "imap" ? service.imapPort : service.pop3Port;
      if (!host || host.trim().length === 0) {
        errors.push(
          `Receive ${protocol.toUpperCase()} host is required when receive is enabled`
        );
      }
      if (!portStr || portStr.trim().length === 0 || isNaN(Number(portStr))) {
        errors.push(
          `Receive ${protocol.toUpperCase()} port must be a valid number when receive is enabled`
        );
      }
      const rxUser =
        service.receiveUsername && service.receiveUsername.trim().length > 0
          ? service.receiveUsername
          : service.from;
      if (!rxUser || rxUser.trim().length === 0) {
        errors.push("Receive username is required when receive is enabled");
      }
      const rxPass =
        service.receivePassword && service.receivePassword.length > 0
          ? service.receivePassword
          : service.password;
      if (!rxPass || rxPass.length === 0) {
        errors.push("Receive password is required when receive is enabled");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async encryptCredentialsForStorage(
    service: EmailServiceEntity
  ): Promise<EmailServiceEntity> {
    const encryptedService = new EmailServiceEntity();
    Object.assign(encryptedService, service);
    encryptedService.password = await this.encryptRequiredCredential(
      service.password
    );
    encryptedService.receivePassword = await this.encryptOptionalCredential(
      service.receivePassword
    );
    return encryptedService;
  }

  private async decryptServiceCredentials(
    service: EmailServiceEntity | undefined
  ): Promise<EmailServiceEntity | undefined> {
    if (!service) return undefined;

    const decryptedService = new EmailServiceEntity();
    Object.assign(decryptedService, service);
    decryptedService.password = await this.decryptRequiredCredential(
      service.password,
      service.id,
      "password"
    );
    decryptedService.receivePassword = await this.decryptOptionalCredential(
      service.receivePassword,
      service.id,
      "receivePassword"
    );
    return decryptedService;
  }

  private async decryptServiceCredentialsList(
    services: EmailServiceEntity[]
  ): Promise<EmailServiceEntity[]> {
    const decryptedServices = await Promise.all(
      services.map((service) => this.decryptServiceCredentials(service))
    );
    return decryptedServices.filter(
      (service): service is EmailServiceEntity => service !== undefined
    );
  }

  private async encryptRequiredCredential(
    plaintext: string | null | undefined
  ): Promise<string> {
    if (plaintext == null || plaintext === "") {
      return plaintext ?? "";
    }
    if (FieldCipher.isEncrypted(plaintext)) {
      return plaintext;
    }
    const key = await userSecretKeyService.getKey();
    return FieldCipher.encrypt(plaintext, key);
  }

  private async encryptOptionalCredential(
    plaintext: string | null | undefined
  ): Promise<string | null> {
    if (plaintext == null || plaintext === "") {
      return plaintext ?? null;
    }
    if (FieldCipher.isEncrypted(plaintext)) {
      return plaintext;
    }
    const key = await userSecretKeyService.getKey();
    return FieldCipher.encrypt(plaintext, key);
  }

  private async decryptRequiredCredential(
    stored: string | null | undefined,
    serviceId: number | undefined,
    fieldName: string
  ): Promise<string> {
    if (stored == null) return "";
    if (!FieldCipher.isEncrypted(stored)) {
      return stored;
    }
    return await this.decryptStoredCredential(stored, serviceId, fieldName);
  }

  private async decryptOptionalCredential(
    stored: string | null | undefined,
    serviceId: number | undefined,
    fieldName: string
  ): Promise<string | null> {
    if (stored == null) return null;
    if (!FieldCipher.isEncrypted(stored)) {
      return stored;
    }
    return await this.decryptStoredCredential(stored, serviceId, fieldName);
  }

  private async decryptStoredCredential(
    stored: string,
    serviceId: number | undefined,
    fieldName: string
  ): Promise<string> {
    try {
      const key = await userSecretKeyService.getKey();
      return FieldCipher.decrypt(stored, key);
    } catch (error) {
      if (error instanceof SecretKeyUnavailableError) {
        log.warn(
          `[EmailServiceModule] decrypt ${fieldName}: secret key unavailable`,
          error.message
        );
      } else {
        log.error(
          `[EmailServiceModule] decrypt ${fieldName}: failed for service`,
          serviceId,
          error
        );
      }
      return stored;
    }
  }
}
