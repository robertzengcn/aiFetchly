import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import { EmailReplyIdentityProfileModel } from "@/model/EmailReplyIdentityProfile.model";
import { EmailReplyIdentityProfileEntity } from "@/entity/EmailReplyIdentityProfile.entity";

/** Business-logic facade over {@link EmailReplyIdentityProfileModel}. */
export class EmailReplyIdentityProfileModule extends BaseModule {
  private profileModel: EmailReplyIdentityProfileModel;

  constructor() {
    super();
    this.profileModel = new EmailReplyIdentityProfileModel(this.dbpath);
  }

  async getByEmailServiceId(
    emailServiceId: number
  ): Promise<EmailReplyIdentityProfileEntity | null> {
    try {
      await this.ensureConnection();
      return await this.profileModel.getByEmailServiceId(emailServiceId);
    } catch (error) {
      log.error("Error reading reply identity profile:", error);
      throw error;
    }
  }

  async upsertForEmailService(
    entity: EmailReplyIdentityProfileEntity
  ): Promise<EmailReplyIdentityProfileEntity> {
    try {
      await this.ensureConnection();
      return await this.profileModel.upsertForEmailService(entity);
    } catch (error) {
      log.error("Error upserting reply identity profile:", error);
      throw error;
    }
  }
}
