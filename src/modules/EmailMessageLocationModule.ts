import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import {
  EmailMessageLocationModel,
  type ApplyMoveInput,
  type LegacyBackfillEntry,
  type UpsertLocationInput,
  type UpsertLocationResult,
} from "@/model/EmailMessageLocation.model";
import { EmailMessageLocationEntity } from "@/entity/EmailMessageLocation.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";

/**
 * Business facade over the message-location model (technical design §3.1).
 * IPC handlers and services call this module; database access stays here.
 */
export class EmailMessageLocationModule extends BaseModule {
  private locationModel: EmailMessageLocationModel;
  private receivedMessageModule: EmailReceivedMessageModule;

  constructor() {
    super();
    this.locationModel = new EmailMessageLocationModel(this.dbpath);
    this.receivedMessageModule = new EmailReceivedMessageModule();
  }

  async upsertLocation(input: UpsertLocationInput): Promise<UpsertLocationResult> {
    try {
      await this.ensureConnection();
      return await this.locationModel.upsertLocation(input);
    } catch (error) {
      log.error("Error upserting message location:", error);
      throw error;
    }
  }

  async readByMessageId(messageId: number): Promise<EmailMessageLocationEntity | null> {
    try {
      await this.ensureConnection();
      return await this.locationModel.readByMessageId(messageId);
    } catch (error) {
      log.error("Error reading message location:", error);
      throw error;
    }
  }

  async readByMessageIds(
    messageIds: readonly number[]
  ): Promise<EmailMessageLocationEntity[]> {
    try {
      await this.ensureConnection();
      return await this.locationModel.readByMessageIds(messageIds);
    } catch (error) {
      log.error("Error reading message locations:", error);
      throw error;
    }
  }

  /**
   * R05: adopts an exact verified destination occurrence for the message
   * that owns it, refreshing that message's provider fields instead of
   * inserting a duplicate identity. Returns the adopted row or null when
   * no verified tuple owner exists.
   */
  async adoptVerifiedOccurrence(input: {
    emailServiceId: number;
    folderPath: string;
    uidValidity: string;
    providerUid: string;
    entity: EmailReceivedMessageEntity;
  }): Promise<EmailReceivedMessageEntity | null> {
    try {
      await this.ensureConnection();
      const location = await this.locationModel.readByTuple(
        input.emailServiceId,
        input.folderPath,
        input.uidValidity,
        input.providerUid
      );
      if (!location || location.state !== "verified") return null;
      return await this.receivedMessageModule.updateProviderFieldsForSync(
        location.messageId,
        input.entity
      );
    } catch (error) {
      log.error("Error adopting verified occurrence:", error);
      throw error;
    }
  }

  async applyMove(input: ApplyMoveInput): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.locationModel.applyMove(input);
    } catch (error) {
      log.error("Error applying location move:", error);
      throw error;
    }
  }

  async markStale(messageId: number): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.locationModel.markStale(messageId);
    } catch (error) {
      log.error("Error marking location stale:", error);
      throw error;
    }
  }

  async backfillLegacyLocations(entries: readonly LegacyBackfillEntry[]): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.locationModel.backfillLegacyLocations(entries);
    } catch (error) {
      log.error("Error backfilling legacy locations:", error);
      throw error;
    }
  }

  async findMessageIdsWithoutLocation(
    messageIds: readonly number[]
  ): Promise<number[]> {
    try {
      await this.ensureConnection();
      return await this.locationModel.findMessageIdsWithoutLocation(messageIds);
    } catch (error) {
      log.error("Error finding messages without location:", error);
      throw error;
    }
  }
}
