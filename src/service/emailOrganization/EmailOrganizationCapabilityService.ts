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
    if (canFetchFullSource && !smtpConfigured) {
      reasonCodes.push("SMTP_NOT_CONFIGURED");
    }

    let moveCapability = false;
    let trashFolderPath: string | null = null;
    let receiveConfigPresent = false;
    if (protocol === "imap") {
      const receiveConfig = await this.serviceModule.getEmailServiceReceiveConfig(
        emailServiceId
      );
      receiveConfigPresent = receiveConfig !== null;
      if (receiveConfig) {
        const probe = await this.adapter.probeCapabilities(receiveConfig);
        moveCapability = probe.moveCapability;
        if (!probe.moveCapability) {
          reasonCodes.push("MOVE_CAPABILITY_MISSING");
        }
        // R08: fail closed on ambiguity — multiple \\Trash advertisements
        // cannot be resolved by guessing the first one.
        // R4-15: the Trash destination must be writable — a read-only
        // advertised Trash is unusable for mutation.
        const trashFolders = probe.folders.filter(
          (folder) => folder.specialUse === "\\Trash" && folder.writable
        );
        if (trashFolders.length === 1) {
          trashFolderPath = trashFolders[0].path;
        } else if (trashFolders.length > 1) {
          reasonCodes.push("TRASH_AMBIGUOUS");
        } else {
          reasonCodes.push("TRASH_NOT_CONFIGURED");
        }
        if (probe.reasonCode !== null) {
          reasonCodes.push(probe.reasonCode);
        }
      } else {
        reasonCodes.push("RECEIVE_NOT_ENABLED");
      }
    }

    // Forwarding needs full source retrieval AND a usable send identity AND
    // an enabled receive configuration (materialization fetches via IMAP).
    const canSendForward =
      canFetchFullSource && smtpConfigured && receiveConfigPresent;

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
