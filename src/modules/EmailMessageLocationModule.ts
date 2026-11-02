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

/**
 * Business facade over the message-location model (technical design §3.1).
 * IPC handlers and services call this module; database access stays here.
 */
export class EmailMessageLocationModule extends BaseModule {
  private locationModel: EmailMessageLocationModel;

  constructor() {
    super();
    this.locationModel = new EmailMessageLocationModel(this.dbpath);
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
