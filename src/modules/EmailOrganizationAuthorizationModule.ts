import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import {
  EmailOrganizationAuthorizationModel,
  type IssueAuthorizationInput,
} from "@/model/EmailOrganizationAuthorization.model";
import { EmailOrganizationAuthorizationEntity } from "@/entity/EmailOrganizationAuthorization.entity";

/** Business facade for request-scoped action authorizations. */
export class EmailOrganizationAuthorizationModule extends BaseModule {
  private authorizationModel: EmailOrganizationAuthorizationModel;

  constructor() {
    super();
    this.authorizationModel = new EmailOrganizationAuthorizationModel(this.dbpath);
  }

  async issue(input: IssueAuthorizationInput): Promise<EmailOrganizationAuthorizationEntity> {
    try {
      await this.ensureConnection();
      return await this.authorizationModel.issue(input);
    } catch (error) {
      log.error("Error issuing organization authorization:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailOrganizationAuthorizationEntity | null> {
    try {
      await this.ensureConnection();
      return await this.authorizationModel.read(id);
    } catch (error) {
      log.error("Error reading organization authorization:", error);
      throw error;
    }
  }

  isSpendable(
    authorization: EmailOrganizationAuthorizationEntity,
    now: Date
  ): boolean {
    return this.authorizationModel.isSpendable(authorization, now);
  }

  async consume(id: number, now: Date): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.authorizationModel.consume(id, now);
    } catch (error) {
      log.error("Error consuming organization authorization:", error);
      throw error;
    }
  }

  async revoke(id: number, reason: string, now: Date): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.authorizationModel.revoke(id, reason, now);
    } catch (error) {
      log.error("Error revoking organization authorization:", error);
      throw error;
    }
  }

  async revokeAllForDraft(draftId: number, reason: string, now: Date): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.authorizationModel.revokeAllForDraft(draftId, reason, now);
    } catch (error) {
      log.error("Error revoking authorizations for draft:", error);
      throw error;
    }
  }

  async findActiveForRevision(
    draftId: number,
    revisionId: number
  ): Promise<EmailOrganizationAuthorizationEntity[]> {
    try {
      await this.ensureConnection();
      return await this.authorizationModel.findActiveForRevision(draftId, revisionId);
    } catch (error) {
      log.error("Error finding active authorizations:", error);
      throw error;
    }
  }
}
