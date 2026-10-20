import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReplyIdentityProfileEntity } from "@/entity/EmailReplyIdentityProfile.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyIdentityProfileWriteSchema } from "@/schemas/entity/emailReplyIdentityProfile";

export class EmailReplyIdentityProfileModel extends BaseDb {
  /**
   * Resolved per access: BaseDb rebinds `this.sqliteDb` to the live
   * singleton before every guarded async call, so a repository captured
   * at construction could stay bound to a replaced (never-initialized or
   * destroyed) DataSource — the describe-scope module construction pattern
   * in tests hits exactly that. A getter cannot go stale.
   */
  private get repository(): Repository<EmailReplyIdentityProfileEntity> {
    return this.sqliteDb.connection.getRepository(
      EmailReplyIdentityProfileEntity
    );
  }

  constructor(filepath: string) {
    super(filepath);
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
