import { BaseModule } from "@/modules/baseModule";
import { EmailReplySendAttemptModel } from "@/model/EmailReplySendAttempt.model";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";

/** Business-logic facade over {@link EmailReplySendAttemptModel}. */
export class EmailReplySendAttemptModule extends BaseModule {
  private attemptModel: EmailReplySendAttemptModel;

  constructor() {
    super();
    this.attemptModel = new EmailReplySendAttemptModel(this.dbpath);
  }

  async create(
    entity: EmailReplySendAttemptEntity
  ): Promise<EmailReplySendAttemptEntity> {
    try {
      await this.ensureConnection();
      return await this.attemptModel.create(entity);
    } catch (error) {
      console.error("Error creating reply send attempt:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReplySendAttemptEntity | null> {
    try {
      await this.ensureConnection();
      return await this.attemptModel.read(id);
    } catch (error) {
      console.error("Error reading reply send attempt:", error);
      throw error;
    }
  }

  async findByIdempotencyKey(
    key: string
  ): Promise<EmailReplySendAttemptEntity | null> {
    try {
      await this.ensureConnection();
      return await this.attemptModel.findByIdempotencyKey(key);
    } catch (error) {
      console.error(
        "Error finding reply send attempt by idempotency key:",
        error
      );
      throw error;
    }
  }

  async listByDraft(draftId: number): Promise<EmailReplySendAttemptEntity[]> {
    try {
      await this.ensureConnection();
      return await this.attemptModel.listByDraft(draftId);
    } catch (error) {
      console.error("Error listing reply send attempts:", error);
      throw error;
    }
  }

  /** Stale in-flight attempts older than {@link threshold} (recovery input). */
  async listStaleInFlight(
    threshold: Date
  ): Promise<EmailReplySendAttemptEntity[]> {
    try {
      await this.ensureConnection();
      return await this.attemptModel.listStaleInFlight(threshold);
    } catch (error) {
      console.error("Error listing stale reply send attempts:", error);
      throw error;
    }
  }

  async markSubmitted(id: number, at: Date): Promise<void> {
    try {
      await this.ensureConnection();
      await this.attemptModel.markSubmitted(id, at);
    } catch (error) {
      console.error("Error marking reply send attempt submitted:", error);
      throw error;
    }
  }

  async markOutcome(
    id: number,
    status: EmailReplySendAttemptStatus,
    fields: {
      completedAt?: Date;
      providerMessageId?: string | null;
      failureCode?: string | null;
      sanitizedError?: string | null;
    }
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.attemptModel.markOutcome(id, status, fields);
    } catch (error) {
      console.error("Error marking reply send attempt outcome:", error);
      throw error;
    }
  }

  async countSentByServiceSince(
    emailServiceId: number,
    since: Date
  ): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.attemptModel.countSentByServiceSince(
        emailServiceId,
        since
      );
    } catch (error) {
      console.error("Error counting sent reply attempts:", error);
      throw error;
    }
  }

  async countAttemptsForMessage(messageId: number): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.attemptModel.countAttemptsForMessage(messageId);
    } catch (error) {
      console.error("Error counting reply attempts for message:", error);
      throw error;
    }
  }
}
