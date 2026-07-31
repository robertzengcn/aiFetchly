import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailAutoReplyRuleEntity } from "@/entity/EmailAutoReplyRule.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailAutoReplyRuleWriteSchema } from "@/schemas/entity/emailAutoReplyRule";

export class EmailAutoReplyRuleModel extends BaseDb {
  private repository: Repository<EmailAutoReplyRuleEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailAutoReplyRuleEntity
    );
  }

  async read(id: number): Promise<EmailAutoReplyRuleEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async listByEmailService(
    emailServiceId: number
  ): Promise<EmailAutoReplyRuleEntity[]> {
    return await this.repository.find({
      where: { emailServiceId },
      order: { id: "ASC" },
    });
  }

  /** First enabled rule for the service, or the first rule if none enabled. */
  async getEffectiveRule(
    emailServiceId: number
  ): Promise<EmailAutoReplyRuleEntity | null> {
    const rules = await this.listByEmailService(emailServiceId);
    if (rules.length === 0) return null;
    return rules.find((r) => r.enabled === 1) ?? rules[0];
  }

  async create(
    entity: EmailAutoReplyRuleEntity
  ): Promise<EmailAutoReplyRuleEntity> {
    const stripped = parseAndStrip(
      entity,
      emailAutoReplyRuleWriteSchema()
    ) as unknown as EmailAutoReplyRuleEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async update(
    id: number,
    entity: EmailAutoReplyRuleEntity
  ): Promise<void> {
    const existing = await this.repository.findOne({ where: { id } });
    if (!existing) return;
    const stripped = parseAndStrip(
      entity,
      emailAutoReplyRuleWriteSchema()
    ) as unknown as EmailAutoReplyRuleEntity;
    existing.name = stripped.name;
    existing.enabled = stripped.enabled;
    existing.allowedClassificationsJson = stripped.allowedClassificationsJson;
    existing.blockedSenderPatternsJson = stripped.blockedSenderPatternsJson;
    existing.blockedDomainPatternsJson = stripped.blockedDomainPatternsJson;
    existing.dailySendLimit = stripped.dailySendLimit;
    existing.perThreadReplyLimit = stripped.perThreadReplyLimit;
    existing.confidenceThreshold = stripped.confidenceThreshold;
    existing.quietHoursJson = stripped.quietHoursJson;
    existing.requireApprovalBelowThreshold =
      stripped.requireApprovalBelowThreshold;
    await this.repository.save(existing);
  }
}
