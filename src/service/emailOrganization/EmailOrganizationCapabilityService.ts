import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import type {
  EmailOrganizationCapabilityDto,
  EmailOrganizationFolderDto,
  EmailOrganizationProtocol,
} from "@/entityTypes/emailOrganizationTypes";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";
import type { EmailMailboxAdapter, MailboxCapabilityProbe } from "@/service/emailOrganization/EmailMailboxAdapter";
import { ImapEmailMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";

/**
 * Account capability resolution (technical design §5.1): independent
 * booleans with reason codes, briefly cached (5 min) but always
 * revalidated at mutation time by the action services.
 *
 * Stage B contract (PRD §12): POP3 accounts are read-only for organization
 * actions; IMAP accounts need native MOVE for trash/restore and a valid
 * SMTP identity for forwarding.
 */
export class EmailOrganizationCapabilityService extends BaseModule {
  private readonly serviceModule: EmailServiceModule;
  private readonly adapter: EmailMailboxAdapter;
  private readonly cache = new Map<
    number,
    { readonly dto: EmailOrganizationCapabilityDto; readonly expiresAt: number }
  >();

  constructor(options?: { adapter?: EmailMailboxAdapter }) {
    super();
    this.serviceModule = new EmailServiceModule();
    this.adapter = options?.adapter ?? new ImapEmailMailboxAdapter();
  }

  async getCapabilities(
    emailServiceId: number,
    options?: { forceRefresh?: boolean }
  ): Promise<EmailOrganizationCapabilityDto> {
    await this.ensureConnection();
    if (options?.forceRefresh !== true) {
      const cached = this.cache.get(emailServiceId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.dto;
      }
    }

    const service = await this.serviceModule.getEmailService(emailServiceId);
    if (!service) {
      return this.unavailable(emailServiceId, "imap", ["ACCOUNT_NOT_AVAILABLE"]);
    }

    const protocol: EmailOrganizationProtocol =
      service.receiveProtocol === "pop3" ? "pop3" : "imap";
    const reasonCodes: string[] = [];

    const smtpConfigured =
      typeof service.host === "string" &&
      service.host.trim().length > 0 &&
      Number.parseInt(service.port ?? "", 10) > 0;
    const canFetchFullSource = protocol === "imap";
    if (!canFetchFullSource) {
      reasonCodes.push("CAPABILITY_UNSUPPORTED_POP3");
    }
    const canSendForward = canFetchFullSource && smtpConfigured;
    if (canFetchFullSource && !smtpConfigured) {
      reasonCodes.push("SMTP_NOT_CONFIGURED");
    }

    let moveCapability = false;
    let trashFolderPath: string | null = null;
    if (protocol === "imap") {
      const receiveConfig = await this.serviceModule.getEmailServiceReceiveConfig(
        emailServiceId
      );
      if (receiveConfig) {
        const probe = await this.adapter.probeCapabilities(receiveConfig);
        moveCapability = probe.moveCapability;
        if (!probe.moveCapability) {
          reasonCodes.push("MOVE_CAPABILITY_MISSING");
        }
        trashFolderPath =
          probe.folders.find((folder) => folder.specialUse === "\\Trash")?.path ?? null;
        if (trashFolderPath === null) {
          reasonCodes.push("TRASH_NOT_CONFIGURED");
        }
        if (probe.reasonCode !== null) {
          reasonCodes.push(probe.reasonCode);
        }
      } else {
        reasonCodes.push("RECEIVE_NOT_ENABLED");
      }
    }

    const dto: EmailOrganizationCapabilityDto = {
      emailServiceId,
      protocol,
      canFetchFullSource,
      canSendForward,
      canMoveToTrash: protocol === "imap" && moveCapability && trashFolderPath !== null,
      canRestore: protocol === "imap" && moveCapability,
      trashFolderPath,
      reasonCodes,
      resolvedAt: new Date().toISOString(),
    };
    this.cache.set(emailServiceId, {
      dto,
      expiresAt: Date.now() + EMAIL_ORGANIZATION_LIMITS.capabilityCacheTtlMs,
    });
    return dto;
  }

  async listFolders(emailServiceId: number): Promise<EmailOrganizationFolderDto[]> {
    await this.ensureConnection();
    const receiveConfig = await this.serviceModule.getEmailServiceReceiveConfig(
      emailServiceId
    );
    if (!receiveConfig) {
      throw new Error(`account_not_available:${emailServiceId}`);
    }
    const result = await this.adapter.listFolders(receiveConfig);
    if (result.status !== "listed") {
      throw new Error(`folder_listing_failed:${result.reasonCode}`);
    }
    return result.folders.map((folder) => ({
      path: folder.path,
      name: folder.name,
      specialUse: folder.specialUse,
      writable: folder.writable,
    }));
  }

  invalidateCache(emailServiceId?: number): void {
    if (emailServiceId === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(emailServiceId);
    }
  }

  /** Adapter access for action services (revalidation before mutation). */
  getAdapter(): EmailMailboxAdapter {
    return this.adapter;
  }

  /** Exposed for action services: the resolved receive config of an account. */
  async getReceiveConfig(
    emailServiceId: number
  ): Promise<EmailReceiveConnectionConfig | null> {
    await this.ensureConnection();
    return await this.serviceModule.getEmailServiceReceiveConfig(emailServiceId);
  }

  private unavailable(
    emailServiceId: number,
    protocol: EmailOrganizationProtocol,
    reasonCodes: string[]
  ): EmailOrganizationCapabilityDto {
    return {
      emailServiceId,
      protocol,
      canFetchFullSource: false,
      canSendForward: false,
      canMoveToTrash: false,
      canRestore: false,
      trashFolderPath: null,
      reasonCodes,
      resolvedAt: new Date().toISOString(),
    };
  }
}

/** Re-exported for reuse by tests/tools. */
export type { MailboxCapabilityProbe };
