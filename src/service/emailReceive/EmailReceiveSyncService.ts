import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailReceiveFetchOptions } from "@/entityTypes/emailReceiveTypes";
import { EmailReceiveClientFactory } from "@/service/emailReceive/EmailReceiveClientFactory";
import { ParsedInboundEmail } from "@/service/emailReceive/EmailReceiveClient";
import {
  buildSnippet,
  encodeAddresses,
} from "@/service/emailReceive/EmailMessageParser";

/** Result of a manual or AI-triggered sync. */
export interface EmailReceiveSyncResult {
  readonly emailServiceId: number;
  readonly fetched: number;
  readonly stored: number;
  readonly messageIds: number[];
}

/** Hard cap on messages per sync regardless of caller limit. */
const SYNC_LIMIT_CAP = 50;

/**
 * Orchestrates a bounded inbound receive sync:
 *
 *   load config → connect via client → fetch → upsert → audit → update sync state
 *
 * Runs entirely in the main process. Credentials never leave this service.
 */
export class EmailReceiveSyncService {
  private serviceModule: EmailServiceModule;
  private messageModule: EmailReceivedMessageModule;
  private auditModule: EmailReplyAuditLogModule;

  constructor() {
    this.serviceModule = new EmailServiceModule();
    this.messageModule = new EmailReceivedMessageModule();
    this.auditModule = new EmailReplyAuditLogModule();
  }

  /**
   * Test connectivity for a receive-enabled service. Does NOT mutate stored
   * sync state — it is a pure connectivity probe for the UI "Test Connection".
   */
  async testConnection(emailServiceId: number): Promise<{ success: boolean; error: string | null }> {
    try {
      const config = await this.serviceModule.getEmailServiceReceiveConfig(emailServiceId);
      if (!config) {
        return { success: false, error: "Receive is not configured for this service." };
      }
      const client = EmailReceiveClientFactory.createClient(config.protocol);
      await client.testConnection(config);
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: sanitizeError(error) };
    }
  }

  /**
   * Fetch and persist a bounded set of messages. Duplicate provider messages
   * are upserted, never duplicated. Errors are recorded on the service's sync
   * state and rethrown so callers can surface them.
   */
  async syncUnread(
    emailServiceId: number,
    options: { limit?: number; unreadOnly?: boolean; since?: Date }
  ): Promise<EmailReceiveSyncResult> {
    const fetchOptions: EmailReceiveFetchOptions = {
      limit: Math.max(1, Math.min(options.limit ?? 10, SYNC_LIMIT_CAP)),
      unreadOnly: options.unreadOnly ?? true,
      since: options.since,
    };

    const config = await this.serviceModule.getEmailServiceReceiveConfig(emailServiceId);
    if (!config) {
      throw new Error("Receive is not configured or enabled for this service.");
    }

    const client = EmailReceiveClientFactory.createClient(config.protocol);
    let parsed: ParsedInboundEmail[];
    try {
      parsed = await client.fetchMessages(config, fetchOptions);
    } catch (error) {
      const message = sanitizeError(error);
      await this.serviceModule.updateReceiveSyncState(emailServiceId, new Date(), message);
      await this.writeAudit(emailServiceId, null, "message_fetched", "system", message);
      throw error;
    }

    const messageIds: number[] = [];
    for (const p of parsed) {
      const entity = this.toEntity(emailServiceId, p);
      const saved = await this.messageModule.upsertByProviderUid(entity);
      messageIds.push(saved.id);
      await this.writeAudit(
        emailServiceId,
        saved.id,
        "message_fetched",
        "system",
        `Fetched "${truncate(p.subject, 80)}" from ${p.fromAddress}`
      );
    }

    await this.serviceModule.updateReceiveSyncState(emailServiceId, new Date(), null);

    return {
      emailServiceId,
      fetched: parsed.length,
      stored: messageIds.length,
      messageIds,
    };
  }

  private toEntity(
    emailServiceId: number,
    p: ParsedInboundEmail
  ): EmailReceivedMessageEntity {
    const entity = new EmailReceivedMessageEntity();
    entity.emailServiceId = emailServiceId;
    entity.providerUid = p.providerUid;
    entity.messageId = p.messageId;
    entity.threadKey = p.threadKey;
    entity.inReplyTo = p.inReplyTo;
    entity.referencesHeader = p.referencesHeader;
    entity.fromAddress = p.fromAddress;
    entity.fromName = p.fromName;
    entity.replyToAddress = p.replyToAddress;
    entity.toAddressesJson = encodeAddresses(p.toAddresses);
    entity.ccAddressesJson = p.ccAddresses.length > 0 ? encodeAddresses(p.ccAddresses) : null;
    entity.subject = p.subject;
    entity.bodyText = p.bodyText;
    entity.bodyHtmlSanitized = p.bodyHtmlSanitized;
    // Defensive: always recompute snippet from body to keep it bounded.
    entity.snippet = buildSnippet(p.bodyText);
    entity.receivedAt = p.receivedAt;
    entity.isUnread = p.isUnread ? 1 : 0;
    entity.replyStatus = "not_started";
    return entity;
  }

  private async writeAudit(
    emailServiceId: number,
    messageId: number | null,
    action: EmailReplyAuditLogEntity["action"],
    actor: EmailReplyAuditLogEntity["actor"],
    reason: string | null
  ): Promise<void> {
    try {
      const log = new EmailReplyAuditLogEntity();
      log.emailServiceId = emailServiceId;
      log.messageId = messageId;
      log.action = action;
      log.actor = actor;
      log.reason = reason;
      await this.auditModule.create(log);
    } catch (e) {
      // Audit failure must not break the sync.
      console.error("Failed to write receive audit log:", e);
    }
  }
}

/** Reduce an unknown error to a short, safe string (no stack traces leaked). */
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message || error.name;
    return msg.length > 240 ? msg.slice(0, 240) + "…" : msg;
  }
  return String(error).slice(0, 240);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max) + "…";
}
