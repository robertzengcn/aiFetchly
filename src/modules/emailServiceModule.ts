import { BaseModule } from "@/modules/baseModule";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { SortBy } from "@/entityTypes/commonType";
import { ListData } from "@/entityTypes/commonType";
import { EmailServiceModuleInterface } from "@/modules/interface/EmailServiceModuleInterface";
import {
  EmailReceiveConnectionConfig,
  EmailReceiveProtocol,
} from "@/entityTypes/emailReceiveTypes";

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
      return await this.emailServiceModel.create(service);
    } catch (error) {
      console.error("Error creating email service:", error);
      throw error;
    }
  }

  async getEmailService(id: number): Promise<EmailServiceEntity | undefined> {
    try {
      return await this.emailServiceModel.read(id);
    } catch (error) {
      console.error("Error getting email service:", error);
      throw error;
    }
  }

  async updateEmailService(
    id: number,
    service: EmailServiceEntity
  ): Promise<void> {
    try {
      await this.emailServiceModel.update(id, service);
    } catch (error) {
      console.error("Error updating email service:", error);
      throw error;
    }
  }

  async deleteEmailService(id: number): Promise<void> {
    try {
      await this.emailServiceModel.delete(id);
    } catch (error) {
      console.error("Error deleting email service:", error);
      throw error;
    }
  }

  async updateEmailServiceStatus(id: number, status: number): Promise<void> {
    try {
      await this.emailServiceModel.updateServiceStatus(id, status);
    } catch (error) {
      console.error("Error updating email service status:", error);
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
        records,
        num,
      };
    } catch (error) {
      console.error("Error listing email services:", error);
      throw error;
    }
  }

  async countEmailServices(): Promise<number> {
    try {
      return await this.emailServiceModel.countEmailServices();
    } catch (error) {
      console.error("Error counting email services:", error);
      throw error;
    }
  }

  async findEmailServiceByName(
    name: string
  ): Promise<EmailServiceEntity | undefined> {
    try {
      return await this.emailServiceModel.findByName(name);
    } catch (error) {
      console.error("Error finding email service by name:", error);
      throw error;
    }
  }

  async findEmailServicesByHost(host: string): Promise<EmailServiceEntity[]> {
    try {
      return await this.emailServiceModel.findByHost(host);
    } catch (error) {
      console.error("Error finding email services by host:", error);
      throw error;
    }
  }

  async getActiveEmailServices(): Promise<EmailServiceEntity[]> {
    try {
      const allServices = await this.emailServiceModel.listEmailServices(
        0,
        1000
      );
      return allServices.filter((service) => service.status === 1);
    } catch (error) {
      console.error("Error getting active email services:", error);
      throw error;
    }
  }

  /** Services with inbound receive enabled. */
  async listReceiveEnabledServices(): Promise<EmailServiceEntity[]> {
    try {
      await this.ensureConnection();
      return await this.emailServiceModel.listReceiveEnabled();
    } catch (error) {
      console.error("Error listing receive-enabled services:", error);
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
      console.error("Error updating receive sync state:", error);
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
      const service = await this.emailServiceModel.read(id);
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
      console.error("Error resolving receive connection config:", error);
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
}
