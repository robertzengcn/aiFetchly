import { EmailServiceTagEntity } from "@/entity/EmailServiceTag.entity";
import { EmailServiceTagModel } from "@/model/EmailServiceTag.model";
import { BaseModule } from "@/modules/baseModule";
import type { EmailServiceTagSummary } from "@/entityTypes/emailmarketingType";
import { incrementEmailServiceMetric } from "@/modules/lib/EmailServiceMetrics";

export function normalizeEmailServiceTag(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function validateEmailServiceTagName(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("EMAIL_SERVICE_TAG_INVALID_CHARACTERS");
  }
  const name = value.trim();
  if (name.length === 0) {
    throw new Error("EMAIL_SERVICE_TAG_REQUIRED");
  }
  if (name.length > 64) {
    throw new Error("EMAIL_SERVICE_TAG_TOO_LONG");
  }
  return name;
}

export class EmailServiceTagModule extends BaseModule {
  private readonly tagModel: EmailServiceTagModel;

  constructor() {
    super();
    this.tagModel = new EmailServiceTagModel(this.dbpath);
  }

  async listTags(search?: string): Promise<EmailServiceTagSummary[]> {
    await this.ensureConnection();
    const tags = await this.tagModel.list(search);
    return await Promise.all(
      tags.map(async (tag) => ({
        id: tag.id,
        name: tag.name,
        normalizedName: tag.normalizedName,
        serviceCount: await this.tagModel.countServices(tag.id),
      }))
    );
  }

  async createTag(name: string): Promise<number> {
    await this.ensureConnection();
    const validatedName = validateEmailServiceTagName(name);
    const normalizedName = normalizeEmailServiceTag(validatedName);
    const existing = await this.tagModel.findByNormalizedName(normalizedName);
    if (existing) {
      throw new Error("EMAIL_SERVICE_TAG_DUPLICATE");
    }

    const entity = new EmailServiceTagEntity();
    entity.name = validatedName;
    entity.normalizedName = normalizedName;
    try {
      const id = await this.tagModel.create(entity);
      incrementEmailServiceMetric("tag_create");
      return id;
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        throw new Error("EMAIL_SERVICE_TAG_DUPLICATE");
      }
      throw error;
    }
  }

  async updateTag(id: number, name: string): Promise<void> {
    await this.ensureConnection();
    const validatedName = validateEmailServiceTagName(name);
    const normalizedName = normalizeEmailServiceTag(validatedName);
    const existing = await this.tagModel.read(id);
    if (!existing) {
      throw new Error("EMAIL_SERVICE_TAG_NOT_FOUND");
    }
    const duplicate = await this.tagModel.findByNormalizedName(normalizedName);
    if (duplicate && duplicate.id !== id) {
      throw new Error("EMAIL_SERVICE_TAG_DUPLICATE");
    }

    try {
      await this.tagModel.update(id, validatedName, normalizedName);
      incrementEmailServiceMetric("tag_update");
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        throw new Error("EMAIL_SERVICE_TAG_DUPLICATE");
      }
      throw error;
    }
  }

  async deleteTag(id: number): Promise<{ affectedServiceCount: number }> {
    await this.ensureConnection();
    const existing = await this.tagModel.read(id);
    if (!existing) {
      throw new Error("EMAIL_SERVICE_TAG_NOT_FOUND");
    }
    const affectedServiceCount = await this.tagModel.countServices(id);
    await this.tagModel.delete(id);
    incrementEmailServiceMetric("tag_delete");
    return { affectedServiceCount };
  }

  async getTag(id: number): Promise<EmailServiceTagEntity | undefined> {
    await this.ensureConnection();
    return await this.tagModel.read(id);
  }

  async findByName(name: string): Promise<EmailServiceTagEntity | undefined> {
    await this.ensureConnection();
    const normalizedName = normalizeEmailServiceTag(
      validateEmailServiceTagName(name)
    );
    return await this.tagModel.findByNormalizedName(normalizedName);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error &&
      /unique constraint/i.test(error.message)
    );
  }
}
