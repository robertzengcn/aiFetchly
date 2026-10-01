import { BaseDb } from "@/model/Basedb";
import { Repository, In, Not } from "typeorm";
import { EmailServiceTagRelationEntity } from "@/entity/EmailServiceTagRelation.entity";
import { EmailServiceTagEntity } from "@/entity/EmailServiceTag.entity";

/**
 * A tag attached to an email service, with the tag definition expanded.
 * Used for detail/list views where the caller needs names, not just IDs.
 */
export interface ServiceTagView {
  id: number;
  name: string;
}

/**
 * Data-access layer for the email_service ↔ tag junction table.
 * Owns all many-to-many assignment queries. Mirrors EmailServiceTag.model.ts.
 */
export class EmailServiceTagRelationModel extends BaseDb {
  private relationRepository: Repository<EmailServiceTagRelationEntity>;
  private tagRepository: Repository<EmailServiceTagEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.relationRepository = this.sqliteDb.connection.getRepository(
      EmailServiceTagRelationEntity
    );
    this.tagRepository =
      this.sqliteDb.connection.getRepository(EmailServiceTagEntity);
  }

  protected override onSqliteDbRebound(): void {
    this.relationRepository = this.sqliteDb.connection.getRepository(
      EmailServiceTagRelationEntity
    );
    this.tagRepository =
      this.sqliteDb.connection.getRepository(EmailServiceTagEntity);
  }

  /**
   * Fully replace the tag set for a service. Computes the diff against the
   * current set so unchanged pairs are not churned (preserves createdAt).
   * `tagIds` is the authoritative new set — missing current rows are removed.
   */
  async replaceTags(serviceId: number, tagIds: number[]): Promise<void> {
    const current = await this.relationRepository.find({
      where: { emailServiceId: serviceId },
    });
    const currentTagIds = new Set(current.map((r) => r.tagId));
    const desiredTagIds = new Set(tagIds);

    const toRemove = current
      .filter((r) => !desiredTagIds.has(r.tagId))
      .map((r) => r.id);
    const toAdd = tagIds.filter((id) => !currentTagIds.has(id));

    if (toRemove.length > 0) {
      await this.relationRepository.delete(toRemove);
    }
    if (toAdd.length > 0) {
      const rows = toAdd.map((tagId) => {
        const entity = new EmailServiceTagRelationEntity();
        entity.emailServiceId = serviceId;
        entity.tagId = tagId;
        return entity;
      });
      await this.relationRepository.save(rows);
    }
  }

  /** Add a single tag to a service without disturbing existing assignments. */
  async assignTag(serviceId: number, tagId: number): Promise<void> {
    const existing = await this.relationRepository.findOne({
      where: { emailServiceId: serviceId, tagId },
    });
    if (existing) return;
    const entity = new EmailServiceTagRelationEntity();
    entity.emailServiceId = serviceId;
    entity.tagId = tagId;
    try {
      await this.relationRepository.save(entity);
    } catch (error: unknown) {
      // Unique constraint — already assigned concurrently; treat as success.
      if (!this.isUniqueConstraintError(error)) throw error;
    }
  }

  /** Remove a single tag from a service. No-op if not assigned. */
  async unassignTag(serviceId: number, tagId: number): Promise<void> {
    await this.relationRepository.delete({
      emailServiceId: serviceId,
      tagId,
    });
  }

  /** Remove every tag assignment for a service (e.g. before reassignment). */
  async clearTags(serviceId: number): Promise<void> {
    await this.relationRepository.delete({ emailServiceId: serviceId });
  }

  /** Tag IDs attached to a single service, ordered by tag id for determinism. */
  async getTagIdsForService(serviceId: number): Promise<number[]> {
    const rows = await this.relationRepository.find({
      where: { emailServiceId: serviceId },
      order: { tagId: "ASC" },
    });
    return rows.map((r) => r.tagId);
  }

  /** Expanded tag definitions (id + name) for a single service. */
  async getTagsForService(serviceId: number): Promise<ServiceTagView[]> {
    const rows = await this.relationRepository
      .createQueryBuilder("relation")
      .innerJoinAndSelect("relation.tag", "tag")
      .where("relation.emailServiceId = :serviceId", { serviceId })
      .orderBy("tag.name", "ASC")
      .getMany();
    return rows.map((r) => ({ id: r.tag.id, name: r.tag.name }));
  }

  /**
   * Batch-expanded tags for many services at once (list view). Returns a map
   * keyed by emailServiceId so the caller can attach `tags` to each row
   * without N+1 queries.
   */
  async getTagsForServices(
    serviceIds: number[]
  ): Promise<Map<number, ServiceTagView[]>> {
    const result = new Map<number, ServiceTagView[]>();
    if (serviceIds.length === 0) return result;
    const rows = await this.relationRepository
      .createQueryBuilder("relation")
      .innerJoinAndSelect("relation.tag", "tag")
      .where("relation.emailServiceId IN (:...serviceIds)", { serviceIds })
      .orderBy("tag.name", "ASC")
      .getMany();
    for (const row of rows) {
      const list = result.get(row.emailServiceId) ?? [];
      list.push({ id: row.tag.id, name: row.tag.name });
      result.set(row.emailServiceId, list);
    }
    return result;
  }

  /**
   * Count services sharing a given tag (used by the tag management UI's
   * "used by N services" badge and the delete-tag confirmation).
   */
  async countServicesForTag(tagId: number): Promise<number> {
    return await this.relationRepository.count({ where: { tagId } });
  }

  /**
   * Service IDs that have ANY of the given tag IDs. Used by the list filter
   * ("services having this tag"). Returns distinct service IDs.
   */
  async getServiceIdsForTag(tagId: number): Promise<number[]> {
    const rows = await this.relationRepository.find({
      where: { tagId },
      select: ["emailServiceId"],
    });
    return [...new Set(rows.map((r) => r.emailServiceId))];
  }

  /**
   * Service IDs that have at least one tag (inverse of "untagged").
   * Used by the untagged list filter.
   */
  async getServiceIdsWithAnyTag(): Promise<Set<number>> {
    const rows = await this.relationRepository.find({
      select: ["emailServiceId"],
    });
    return new Set(rows.map((r) => r.emailServiceId));
  }

  /**
   * Count services that still have at least one tag after excluding the
   * provided tag (used for the delete-tag confirmation message — services
   * that would lose their only tag become untagged).
   */
  async countServicesLosingOnlyTag(tagId: number): Promise<number> {
    // Services that have this tag AND no other tag.
    const relationsRepo = this.relationRepository;
    const targetServices = await relationsRepo.find({
      where: { tagId },
      select: ["emailServiceId"],
    });
    if (targetServices.length === 0) return 0;
    const serviceIds = [...new Set(targetServices.map((r) => r.emailServiceId))];
    const withOtherTag = await relationsRepo.count({
      where: {
        emailServiceId: In(serviceIds),
        tagId: Not(tagId),
      },
    });
    return serviceIds.length - withOtherTag;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error && /unique constraint/i.test(error.message)
    );
  }
}