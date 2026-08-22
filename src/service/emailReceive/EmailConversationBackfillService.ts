import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailConversationModule } from "@/modules/EmailConversationModule";
import {
  normalizeThreadHeaders,
  resolveConversationRoot,
} from "@/service/emailReceive/EmailThreadResolver";

/**
 * Restartable, idempotent backfill that places each received message into a
 * canonical mailbox-scoped conversation (technical design §22.2, FR-001).
 *
 * Rules:
 *  - skip messages that already have a conversationId;
 *  - normalize RFC identifiers and resolve a root key (never subject-only);
 *  - associate the message with the resolved conversation;
 *  - persist the normalized header fields on the message for later policy use.
 */
export class EmailConversationBackfillService {
  private readonly messageModule = new EmailReceivedMessageModule();
  private readonly conversationModule = new EmailConversationModule();

  async backfillConversations(emailServiceId?: number): Promise<{
    processed: number;
    skipped: number;
    failed: number;
  }> {
    const records = await this.messageModule.listWithoutConversation(
      emailServiceId
    );
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const msg of records) {
      if (msg.conversationId) {
        skipped += 1;
        continue;
      }
      try {
        const headers = normalizeThreadHeaders({
          messageId: msg.messageId,
          inReplyTo: msg.inReplyTo,
          references: msg.referencesHeader,
        });
        const resolution = resolveConversationRoot({
          headers,
          providerUid: msg.providerUid,
        });
        const conversation = await this.conversationModule.resolveOrCreate({
          emailServiceId: msg.emailServiceId,
          rootKey: resolution.rootKey,
          matchCandidates: resolution.matchCandidates,
          confidence: resolution.confidence,
          ambiguityReason: resolution.ambiguityReason,
          displaySubject: msg.subject,
          lastMessageAt: msg.receivedAt,
        });
        await this.messageModule.updateNormalization(msg.id, {
          normalizedMessageId: headers.messageId,
          normalizedInReplyTo: headers.inReplyTo,
          normalizedReferencesJson: JSON.stringify(headers.references),
          conversationId: conversation.id,
        });
        processed += 1;
      } catch (error) {
        console.error(
          `Conversation backfill failed for message ${msg.id}:`,
          error
        );
        failed += 1;
      }
    }

    return { processed, skipped, failed };
  }
}
