import { BaseModule } from "@/modules/baseModule";
import {
  EmailReceivedMessageModel,
  ReceivedMessageListInput,
} from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";
import { normalizeStoredMessageId } from "@/service/emailReceive/EmailReplyIdentity";

/**
 * Business-logic facade over {@link EmailReceivedMessageModel}.
 * IPC handlers and AI tools call this — never the model or repository directly.
 */
export class EmailReceivedMessageModule extends BaseModule {
  private messageModel: EmailReceivedMessageModel;

  constructor() {
    super();
    this.messageModel = new EmailReceivedMessageModel(this.dbpath);
  }

  async upsertByProviderUid(
    entity: EmailReceivedMessageEntity
  ): Promise<EmailReceivedMessageEntity> {
    try {
      await this.ensureConnection();
      return await this.messageModel.upsertByProviderUid(entity);
    } catch (error) {
      console.error("Error upserting received message:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReceivedMessageEntity | null> {
    try {
      await this.ensureConnection();
      return await this.messageModel.read(id);
    } catch (error) {
      console.error("Error reading received message:", error);
      throw error;
    }
  }

  async updateReplyStatus(
    id: number,
    status: EmailReplyStatus,
    processedAt: Date | null = null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.updateReplyStatus(id, status, processedAt);
    } catch (error) {
      console.error("Error updating reply status:", error);
      throw error;
    }
  }

  async updateClassification(
    id: number,
    classification: EmailMessageClassification | null,
    confidence: number | null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.updateClassification(
        id,
        classification,
        confidence
      );
    } catch (error) {
      console.error("Error updating classification:", error);
      throw error;
    }
  }

  async updateClassificationProvenance(
    id: number,
    source: string,
    version: string
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.updateClassificationProvenance(
        id,
        source,
        version
      );
    } catch (error) {
      console.error("Error updating classification provenance:", error);
      throw error;
    }
  }

  async setConversation(
    messageId: number,
    conversationId: number
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.setConversation(messageId, conversationId);
    } catch (error) {
      console.error("Error setting message conversation:", error);
      throw error;
    }
  }

  async listWithoutConversation(
    emailServiceId?: number
  ): Promise<EmailReceivedMessageEntity[]> {
    try {
      await this.ensureConnection();
      return await this.messageModel.listWithoutConversation(emailServiceId);
    } catch (error) {
      console.error("Error listing messages without conversation:", error);
      throw error;
    }
  }

  async updateNormalization(
    messageId: number,
    fields: {
      normalizedMessageId?: string | null;
      normalizedInReplyTo?: string | null;
      normalizedReferencesJson?: string | null;
      normalizedBodyText?: string | null;
      newContentText?: string | null;
      autoSubmittedHeader?: string | null;
      precedenceHeader?: string | null;
      listIdHeader?: string | null;
      listUnsubscribeHeader?: string | null;
      hasAttachments?: number;
      attachmentMetadataJson?: string | null;
      conversationId?: number | null;
    }
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.updateNormalization(messageId, fields);
    } catch (error) {
      console.error("Error updating message normalization:", error);
      throw error;
    }
  }

  async markRead(id: number, isUnread: boolean): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.markRead(id, isUnread);
    } catch (error) {
      console.error("Error marking message read:", error);
      throw error;
    }
  }

  /**
   * Detection-owned evidence write (FR-030/FR-031). Sticky positive: once
   * `replyDetectedAt` is set it is never cleared; negatives only land while
   * no positive evidence exists. See the model for the full fence semantics.
   */
  async updateReplyEvidence(input: {
    id: number;
    replyDetectedAt?: Date | null;
    replyDetectionSource?: string | null;
    replyMatchedMessageId?: string | null;
    replyNegativeCheckAt?: Date | null;
    replyNegativeContextHash?: string | null;
    replyNegativeOwnerExpiresAt?: Date | null;
    isAnswered?: number;
    answeredFlagCheckedAt?: Date | null;
  }): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.messageModel.updateReplyEvidence(input);
    } catch (error) {
      console.error("Error updating reply evidence:", error);
      throw error;
    }
  }

  /**
   * N02: confirm a staged pending negative into a matchable one —
   * conditional at the model transaction boundary (exact staged
   * instant + PENDING marker + still-live owner). See the model for the
   * full predicate semantics.
   */
  async confirmStagedNegativeEvidence(input: {
    id: number;
    replyNegativeCheckAt: Date;
    replyNegativeContextHash: string;
    replyNegativeOwnerExpiresAt?: Date | null;
    now?: Date | (() => number);
  }): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.messageModel.confirmStagedNegativeEvidence(input);
    } catch (error) {
      console.error("Error confirming staged negative evidence:", error);
      throw error;
    }
  }

  /**
   * Adopt a legacy bare-UID row into the namespaced providerUid scheme.
   * Collision-safe: refuses (false, no write) when another row already holds
   * the target namespaced key. Caller must validate the source identity
   * first (step 3).
   */
  async updateProviderUidNamespacing(input: {
    id: number;
    emailServiceId: number;
    providerUid: string;
    providerFolder: string | null;
    providerUidValidity: string | null;
  }): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.messageModel.updateProviderUidNamespacing(input);
    } catch (error) {
      console.error("Error namespacing provider uid:", error);
      throw error;
    }
  }

  /** Legacy bare-UID row lookup for adoption consideration (step 3). */
  async findLegacyBareUidRow(input: {
    emailServiceId: number;
    bareUid: string;
  }): Promise<EmailReceivedMessageEntity | null> {
    try {
      await this.ensureConnection();
      return await this.messageModel.findLegacyBareUidRow(input);
    } catch (error) {
      console.error("Error finding legacy bare-uid row:", error);
      throw error;
    }
  }

  async listByEmailService(
    input: ReceivedMessageListInput
  ): Promise<{ records: EmailReceivedMessageEntity[]; total: number }> {
    try {
      await this.ensureConnection();
      const records = await this.messageModel.listByEmailService(input);
      const total = await this.messageModel.countByEmailService(input);
      return { records, total };
    } catch (error) {
      console.error("Error listing received messages:", error);
      throw error;
    }
  }

  /**
   * Resolve every received-message row in the same configured email service that
   * shares the canonical inbound reply identity with the seed row (FR-029/
   * FR-038, technical design §4.1).
   *
   * This is the cluster the duplicate guard inspects TOGETHER — equivalent rows,
   * their drafts, and their send attempts — instead of just the single seed row.
   * Subject, sender alone, and the whole conversation are explicitly NOT the
   * duplicate key; only the normalized RFC Message-ID (or the `row:<id>`
   * singleton fallback when no RFC ID exists).
   *
   * R03: the seed row is ALWAYS included in the result, even when normalized
   * equivalents exist. The previous `if (equivalents.length > 0) return
   * equivalents` branch omitted the seed itself when a newer normalized
   * sibling existed — a legacy seed with a valid raw RFC ID and sent/unknown
   * history became invisible to its own cluster. Now the seed is merged into
   * the equivalents list (deduplicated by id) so the guard's cluster read
   * always includes it.
   *
   * Legacy rows whose `normalizedMessageId` column was never populated are
   * normalized on the fly from the raw stored `messageId` header so they join
   * the right cluster. An incomplete legacy identity scan surfaces as a
   * conflict in the guard, not silent eligibility (§4.1).
   */
  async findCanonicalEquivalents(
    seedRow: EmailReceivedMessageEntity
  ): Promise<EmailReceivedMessageEntity[]> {
    try {
      await this.ensureConnection();
      const normalizedId =
        seedRow.normalizedMessageId ??
        normalizeStoredMessageId(seedRow.messageId);
      if (!normalizedId) {
        // No RFC id → singleton. Return the seed row alone as a `row:<id>`
        // singleton so the guard still inspects its own drafts/attempts.
        const self = await this.messageModel.read(seedRow.id);
        return self ? [self] : [];
      }
      const equivalents = await this.messageModel.findCanonicalEquivalents({
        emailServiceId: seedRow.emailServiceId,
        normalizedMessageId: normalizedId,
      });
      // R03: always include the seed row (deduplicated by id). A legacy seed
      // whose column was never populated must not disappear from its own
      // cluster when a newer normalized sibling exists.
      const hasSeed = equivalents.some((r) => r.id === seedRow.id);
      if (hasSeed) {
        return equivalents;
      }
      const seed = await this.messageModel.read(seedRow.id);
      return seed ? [seed, ...equivalents] : equivalents;
    } catch (error) {
      console.error("Error resolving canonical equivalents:", error);
      throw error;
    }
  }
}
