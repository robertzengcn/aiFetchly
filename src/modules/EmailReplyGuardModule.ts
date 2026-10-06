import { BaseModule } from "@/modules/baseModule";
import {
  EmailReplyGuardModel,
  ReservationAcquireResult,
  AcquireReservationInput,
} from "@/model/EmailReplyGuard.model";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";

/** Business-logic facade over {@link EmailReplyGuardModel}. */
export class EmailReplyGuardModule extends BaseModule {
  private guardModel: EmailReplyGuardModel;

  constructor() {
    super();
    this.guardModel = new EmailReplyGuardModel(this.dbpath);
  }

  async acquireReservation(
    input: AcquireReservationInput
  ): Promise<ReservationAcquireResult> {
    try {
      await this.ensureConnection();
      return await this.guardModel.acquireReservation(input);
    } catch (error) {
      console.error("Error acquiring reply generation reservation:", error);
      throw error;
    }
  }

  async extendLease(input: {
    guardId: number;
    ownerToken: string;
    newExpiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.guardModel.extendLease(input);
    } catch (error) {
      console.error("Error extending reply guard lease:", error);
      throw error;
    }
  }

  async releaseReservation(input: {
    guardId: number;
    ownerToken: string;
    now: Date;
  }): Promise<void> {
    try {
      await this.ensureConnection();
      await this.guardModel.releaseReservation(input);
    } catch (error) {
      console.error("Error releasing reply guard reservation:", error);
      throw error;
    }
  }

  async commitDraftToGuard(input: {
    guardId: number;
    ownerToken: string;
    now: Date;
    activeDraftId: number;
  }): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.guardModel.commitDraftToGuard(input);
    } catch (error) {
      console.error("Error committing draft to reply guard:", error);
      throw error;
    }
  }

  async listStaleReservations(
    threshold: Date
  ): Promise<EmailReplyGuardEntity[]> {
    try {
      await this.ensureConnection();
      return await this.guardModel.listStaleReservations(threshold);
    } catch (error) {
      console.error("Error listing stale reply guard reservations:", error);
      throw error;
    }
  }

  async reclaimExpiredReservation(input: {
    guardId: number;
    now: Date;
  }): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.guardModel.reclaimExpiredReservation(input);
    } catch (error) {
      console.error("Error reclaiming expired reply guard reservation:", error);
      throw error;
    }
  }

  async read(guardId: number): Promise<EmailReplyGuardEntity | null> {
    try {
      await this.ensureConnection();
      return await this.guardModel.read(guardId);
    } catch (error) {
      console.error("Error reading reply guard:", error);
      throw error;
    }
  }

  async findByReplyKey(
    emailServiceId: number,
    replyKey: string
  ): Promise<EmailReplyGuardEntity | null> {
    try {
      await this.ensureConnection();
      return await this.guardModel.findByReplyKey(emailServiceId, replyKey);
    } catch (error) {
      console.error("Error finding reply guard by replyKey:", error);
      throw error;
    }
  }
}
