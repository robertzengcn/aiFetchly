import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReplyIdentityProfileEntity } from "@/entity/EmailReplyIdentityProfile.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyIdentityProfileWriteSchema } from "@/schemas/entity/emailReplyIdentityProfile";

export class EmailReplyIdentityProfileModel extends BaseDb {
  private repository: Repository<EmailReplyIdentityProfileEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplyIdentityProfileEntity
    );
  }

  async getByEmailServiceId(
    emailServiceId: number
  ): Promise<EmailReplyIdentityProfileEntity | null> {
    return await this.repository.findOne({ where: { emailServiceId } });
  }

  async upsertForEmailService(
    entity: EmailReplyIdentityProfileEntity
  ): Promise<EmailReplyIdentityProfileEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReplyIdentityProfileWriteSchema()
    ) as unknown as EmailReplyIdentityProfileEntity;

    const existing = await this.repository.findOne({
      where: { emailServiceId: stripped.emailServiceId },
    });
    if (existing) {
      existing.ownerName = stripped.ownerName;
      existing.ownerRole = stripped.ownerRole;
      existing.companyName = stripped.companyName;
      existing.preferredTone = stripped.preferredTone;
      existing.signature = stripped.signature;
      existing.styleNotes = stripped.styleNotes;
      existing.forbiddenPhrasesJson = stripped.forbiddenPhrasesJson;
      existing.discloseAutomation = stripped.discloseAutomation;
      return await this.repository.save(existing);
    }
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }
}
