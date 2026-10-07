import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailConversationModule } from "@/modules/EmailConversationModule";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import {
  EmailReceiveFetchOptions,
  EmailReceiveConnectionConfig,
  EmailReceiveProtocol,
} from "@/entityTypes/emailReceiveTypes";
import { EmailReceiveClientFactory } from "@/service/emailReceive/EmailReceiveClientFactory";
import {
  ParsedInboundEmail,
  EmailReceiveClient,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  buildSnippet,
  encodeAddresses,
} from "@/service/emailReceive/EmailMessageParser";
import {
  normalizeThreadHeaders,
  resolveConversationRoot,
} from "@/service/emailReceive/EmailThreadResolver";
import { normalizeEmailBody } from "@/service/emailReceive/EmailBodyNormalizationService";
import { classifyDeterministic } from "@/service/emailReply/EmailMessageClassificationService";
import {
  isNamespacedProviderUid,
  parseNamespacedProviderUid,
  normalizeStoredMessageId,
  normalizedIdsMatch,
} from "@/service/emailReceive/EmailReplyIdentity";

/** Result of a manual or AI-triggered sync. */
export interface EmailReceiveSyncResult {
  readonly emailServiceId: number;
  readonly fetched: number;
  readonly stored: number;
  readonly messageIds: number[];
}

/** Hard cap on messages per sync regardless of caller limit. */
const SYNC_LIMIT_CAP = 50;
const IMAP_IMPLICIT_TLS_PORT = 993;
const POP3_IMPLICIT_TLS_PORT = 995;

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
  private conversationModule: EmailConversationModule;
  private readonly clientFactory: (
    protocol: EmailReceiveProtocol
  ) => EmailReceiveClient;

  constructor(options?: {
    /** Test seam: inject a fake receive client per protocol. */
    clientFactory?: (protocol: EmailReceiveProtocol) => EmailReceiveClient;
  }) {
    this.serviceModule = new EmailServiceModule();
    this.messageModule = new EmailReceivedMessageModule();
    this.conversationModule = new EmailConversationModule();
    this.auditModule = new EmailReplyAuditLogModule();
    this.clientFactory =
      options?.clientFactory ??
      ((protocol: EmailReceiveProtocol) =>
        EmailReceiveClientFactory.createClient(protocol));
  }

  /**
   * Test connectivity for a receive-enabled service. Does NOT mutate stored
   * sync state — it is a pure connectivity probe for the UI "Test Connection".
   * When `settings` is provided, tests using those settings directly (for
   * testing before the service has been saved).
   */
  async testConnection(
    emailServiceId: number,
    settings?: {
      protocol: string;
      host: string;
      port: number;
      ssl: boolean;
      username: string;
      password?: string;
      folder: string;
    }
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      let config: EmailReceiveConnectionConfig | null;
      if (settings) {
        const storedConfig =
          settings.password && settings.password.length > 0
            ? null
            : await this.serviceModule.getEmailServiceReceiveConfig(
                emailServiceId
              );
        const password =
          settings.password && settings.password.length > 0
            ? settings.password
            : storedConfig?.password ?? "";
        if (!password) {
          return {
            success: false,
            error: "Receive is not configured for this service.",
          };
        }
        config = {
          emailServiceId,
          protocol: settings.protocol as EmailReceiveProtocol,
          host: settings.host,
          port: settings.port,
          ssl: settings.ssl,
          username: settings.username,
          password,
          folder: settings.folder,
        };
      } else {
        config = await this.serviceModule.getEmailServiceReceiveConfig(
          emailServiceId
        );
      }
      if (!config) {
        return {
          success: false,
          error: "Receive is not configured for this service.",
        };
      }
      const normalizedConfig = normalizeReceiveConnectionConfig(config);
      const validationError = validateReceiveEndpointConfig(normalizedConfig);
      if (validationError) {
        return { success: false, error: validationError };
      }
      const client = this.clientFactory(normalizedConfig.protocol);
      await client.testConnection(normalizedConfig);
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

    const config = await this.serviceModule.getEmailServiceReceiveConfig(
      emailServiceId
    );
    if (!config) {
      throw new Error("Receive is not configured or enabled for this service.");
    }

    const normalizedConfig = normalizeReceiveConnectionConfig(config);
    const validationError = validateReceiveEndpointConfig(normalizedConfig);
    if (validationError) {
      throw new Error(validationError);
    }
    const client = this.clientFactory(normalizedConfig.protocol);
    let parsed: ParsedInboundEmail[];
    try {
      parsed = await client.fetchMessages(normalizedConfig, fetchOptions);
    } catch (error) {
      const message = sanitizeError(error);
      await this.serviceModule.updateReceiveSyncState(
        emailServiceId,
        new Date(),
        message
      );
      await this.writeAudit(
        emailServiceId,
        null,
        "message_fetched",
        "system",
        message
      );
      throw error;
    }

    const messageIds: number[] = [];
    for (const p of parsed) {
      const saved = await this.storeFetchedMessage(emailServiceId, p);
      messageIds.push(saved.id);
      await this.normalizeAndAssociate(emailServiceId, p, saved.id);
      await this.writeAudit(
        emailServiceId,
        saved.id,
        "message_fetched",
        "system",
        `Fetched "${truncate(p.subject, 80)}" from ${p.fromAddress}`
      );
    }

    await this.serviceModule.updateReceiveSyncState(
      emailServiceId,
      new Date(),
      null
    );

    return {
      emailServiceId,
      fetched: parsed.length,
      stored: messageIds.length,
      messageIds,
    };
  }

  /**
   * Store one fetched message, adopting a legacy bare-UID row when this sync
   * can prove it is the same message (FR-030, technical design §5.1).
   *
   * A namespaced providerUid (`imap:<folderHash>:<uidValidity>:<uid>`) will
   * normally upsert its own row. When it does NOT match an existing row, a
   * legacy row from pre-namespace syncs may exist under the bare UID. The
   * legacy row is adopted — rebased onto the namespaced key via a targeted
   * provenance-only update that preserves ALL local state (replyStatus,
   * classification, evidence) — ONLY when the fetched message's RFC Message-ID
   * matches the legacy row's stored/normalized ID. Any mismatch (or a missing
   * ID) means the UID was reused for a different message after a folder
   * rename / UIDVALIDITY bump: insert a fresh row and leave the legacy row
   * untouched (its canonical reply keys keep guarding against duplicates).
   */
  private async storeFetchedMessage(
    emailServiceId: number,
    p: ParsedInboundEmail
  ): Promise<EmailReceivedMessageEntity> {
    const entity = this.toEntity(emailServiceId, p);

    if (isNamespacedProviderUid(p.providerUid)) {
      const namespaced = parseNamespacedProviderUid(p.providerUid);
      if (namespaced) {
        const bareUid = namespaced.uid;
        const legacyRow = await this.messageModule.findLegacyBareUidRow({
          emailServiceId,
          bareUid,
        });
        if (
          legacyRow &&
          this.legacyRowMatchesFetchedMessage(legacyRow, p.messageId)
        ) {
          const adopted = await this.messageModule.updateProviderUidNamespacing({
            id: legacyRow.id,
            emailServiceId,
            providerUid: p.providerUid,
            providerFolder: p.providerFolder,
            providerUidValidity: p.providerUidValidity,
          });
          if (adopted) {
            // Refresh provider fields + answered provenance on the adopted
            // row through the normal targeted upsert path.
            return await this.messageModule.upsertByProviderUid(entity);
          }
        }
      }
    }

    return await this.messageModule.upsertByProviderUid(entity);
  }

  /**
   * Source-identity validation before adoption (§5.1): the fetched message's
   * RFC Message-ID must be equivalent (normalized token equality) to the
   * legacy row's stored ID. A legacy row with no usable ID can never be
   * proven the same message, so it is never adopted.
   */
  private legacyRowMatchesFetchedMessage(
    legacyRow: EmailReceivedMessageEntity,
    fetchedMessageId: string | null
  ): boolean {
    if (!fetchedMessageId) return false;
    const fetchedNormalized = normalizeStoredMessageId(fetchedMessageId);
    if (!fetchedNormalized) return false;
    const legacyNormalized =
      legacyRow.normalizedMessageId ??
      normalizeStoredMessageId(legacyRow.messageId);
    return normalizedIdsMatch(fetchedNormalized, legacyNormalized);
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
    entity.ccAddressesJson =
      p.ccAddresses.length > 0 ? encodeAddresses(p.ccAddresses) : null;
    entity.subject = p.subject;
    entity.bodyText = p.bodyText;
    entity.bodyHtmlSanitized = p.bodyHtmlSanitized;
    // Defensive: always recompute snippet from body to keep it bounded.
    entity.snippet = buildSnippet(p.bodyText);
    entity.receivedAt = p.receivedAt;
    entity.isUnread = p.isUnread ? 1 : 0;
    // Raw provider flag observation + provenance (FR-030 §5.1). The
    // replyStatus projection is NO LONGER derived from the flag here —
    // historical sent promotion happens only via the model's narrowed
    // shouldPromoteReplyStatusFromProvider path inside the upsert.
    entity.isAnswered = p.isAnswered ? 1 : 0;
    entity.answeredFlagCheckedAt = new Date();
    entity.providerFolder = p.providerFolder;
    entity.providerUidValidity = p.providerUidValidity;
    return entity;
  }

  /**
   * Persist-time normalization + classification + conversation resolution
   * (P1/P2, FR-001/007/020). Best-effort per message: a normalization failure
   * must never abort a receive sync — the raw fields are already stored.
   */
  private async normalizeAndAssociate(
    emailServiceId: number,
    p: ParsedInboundEmail,
    savedMessageId: number
  ): Promise<void> {
    try {
      const headers = normalizeThreadHeaders({
        messageId: p.messageId,
        inReplyTo: p.inReplyTo,
        references: p.referencesHeader,
      });
      const resolution = resolveConversationRoot({
        headers,
        providerUid: p.providerUid,
      });
      const body = normalizeEmailBody({
        plainText: p.bodyText,
        sanitizedHtml: p.bodyHtmlSanitized,
      });
      const classification = classifyDeterministic({
        fromAddress: p.fromAddress,
        subject: p.subject,
        bodyText: body.newContentText || body.safeText,
        replyToAddress: p.replyToAddress,
        autoSubmittedHeader: p.autoSubmitted,
        precedenceHeader: p.precedence,
        listIdHeader: p.listIdHeader,
        listUnsubscribeHeader: p.listUnsubscribeHeader,
      });

      const conversation = await this.conversationModule.resolveOrCreate({
        emailServiceId,
        rootKey: resolution.rootKey,
        matchCandidates: resolution.matchCandidates,
        confidence: resolution.confidence,
        ambiguityReason: resolution.ambiguityReason,
        displaySubject: p.subject,
        lastMessageAt: p.receivedAt,
      });

      await this.messageModule.updateNormalization(savedMessageId, {
        normalizedMessageId: headers.messageId,
        normalizedInReplyTo: headers.inReplyTo,
        normalizedReferencesJson: JSON.stringify(headers.references),
        normalizedBodyText: body.safeText,
        newContentText: body.newContentText,
        autoSubmittedHeader: p.autoSubmitted ?? null,
        precedenceHeader: p.precedence ?? null,
        listIdHeader: p.listIdHeader ?? null,
        listUnsubscribeHeader: p.listUnsubscribeHeader ?? null,
        hasAttachments: p.attachments?.length ? 1 : 0,
        attachmentMetadataJson: p.attachments?.length
          ? JSON.stringify(
              p.attachments.map((a) => ({
                filename: String(a.filename ?? "").slice(0, 255),
                contentType: String(a.contentType ?? "").slice(0, 255),
                size: Number(a.size ?? 0),
              }))
            )
          : null,
        conversationId: conversation.id,
      });

      // Persist the deterministic classification with provenance so draft
      // generation can never silently overwrite it (FR-007).
      await this.messageModule.updateClassification(
        savedMessageId,
        classification.classification,
        classification.confidence
      );
      await this.messageModule.updateClassificationProvenance(
        savedMessageId,
        classification.source,
        classification.version
      );
    } catch (error) {
      console.error(
        `Normalization/association failed for message ${savedMessageId}:`,
        error
      );
    }
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

/**
 * Keep receive security compatible with common email-client behavior.
 * Standard implicit TLS ports always require TLS, regardless of a stale or
 * incorrect stored toggle value.
 */
export function normalizeReceiveConnectionConfig(
  config: EmailReceiveConnectionConfig
): EmailReceiveConnectionConfig {
  const implicitTlsPort =
    config.protocol === "pop3"
      ? POP3_IMPLICIT_TLS_PORT
      : IMAP_IMPLICIT_TLS_PORT;

  if (config.port !== implicitTlsPort || config.ssl) {
    return config;
  }

  return {
    ...config,
    ssl: true,
  };
}

export function validateReceiveEndpointConfig(
  config: EmailReceiveConnectionConfig
): string | null {
  if (config.port === 465) {
    return (
      "Port 465 is for SMTP sending, not receiving. " +
      `For ${config.protocol.toUpperCase()} receive, use the provider's receive port. ` +
      "For Aliyun IMAP, use port 993 with SSL/TLS or port 143 without SSL/TLS."
    );
  }

  if (
    config.protocol === "imap" &&
    config.host.toLowerCase().startsWith("smtp.")
  ) {
    return "SMTP host is configured for IMAP receive. Use an IMAP host, such as imap.qiye.aliyun.com for Aliyun.";
  }

  if (
    config.protocol === "pop3" &&
    config.host.toLowerCase().startsWith("smtp.")
  ) {
    return "SMTP host is configured for POP3 receive. Use a POP3 host, such as pop.qiye.aliyun.com for Aliyun.";
  }

  return null;
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
