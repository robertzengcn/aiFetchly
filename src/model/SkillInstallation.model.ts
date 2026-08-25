import { BaseDb } from "@/model/Basedb";
import {
  SkillInstallationEntity,
} from "@/entity/SkillInstallation.entity";
import {
  SkillInstallationSessionEntity,
} from "@/entity/SkillInstallationSession.entity";
import {
  SkillInstallationEventEntity,
} from "@/entity/SkillInstallationEvent.entity";
import { Repository } from "typeorm";

export class SkillInstallationModel extends BaseDb {
  public repository: Repository<SkillInstallationEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      SkillInstallationEntity
    );
  }

  async findByIdentity(input: {
    sourceUri: string;
    sourceRevision: string;
    sourceSubdirectory: string;
    scope: string;
    workspaceId: number;
    activationMode: string;
  }): Promise<SkillInstallationEntity | null> {
    return this.repository.findOneBy({
      sourceUri: input.sourceUri,
      sourceRevision: input.sourceRevision,
      sourceSubdirectory: input.sourceSubdirectory,
      scope: input.scope,
      workspaceId: input.workspaceId,
      activationMode: input.activationMode,
    });
  }

  async findByInstallationId(
    installationId: string
  ): Promise<SkillInstallationEntity | null> {
    return this.repository.findOneBy({ installationId });
  }

  async save(
    entity: SkillInstallationEntity
  ): Promise<SkillInstallationEntity> {
    return this.repository.save(entity);
  }

  async setStatus(
    installationId: string,
    status: string
  ): Promise<void> {
    await this.repository.update({ installationId }, { status });
  }

  async listByScope(
    scope: string,
    workspaceId: number
  ): Promise<SkillInstallationEntity[]> {
    return this.repository.find({
      where: { scope, workspaceId },
      order: { updatedAt: "DESC" },
    });
  }
}

export class SkillInstallationSessionModel extends BaseDb {
  public repository: Repository<SkillInstallationSessionEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      SkillInstallationSessionEntity
    );
  }

  async create(
    entity: SkillInstallationSessionEntity
  ): Promise<SkillInstallationSessionEntity> {
    return this.repository.save(entity);
  }

  async findBySessionId(
    sessionId: string
  ): Promise<SkillInstallationSessionEntity | null> {
    return this.repository.findOneBy({ sessionId });
  }

  async findActiveByCanonicalUri(
    canonicalUri: string
  ): Promise<SkillInstallationSessionEntity[]> {
    // Active = not terminal. Plan JSON carries the canonicalUri; a simple
    // LIKE keeps this on one index-free scan of a small table.
    return this.repository
      .createQueryBuilder("s")
      .where("s.state NOT IN (:...terminal)", {
        terminal: ["ready", "failed", "cancelled", "rollback_required"],
      })
      .andWhere("s.planJson LIKE :uri", { uri: `%"${canonicalUri}"%` })
      .getMany();
  }

  /**
   * Compare-and-set state transition: succeeds only when the current
   * stateRevision matches, so duplicate model calls, renderer retries, and
   * late worker messages cannot repeat mutations (design §5.3).
   */
  async compareAndSetState(
    sessionId: string,
    expectedRevision: number,
    patch: Partial<SkillInstallationSessionEntity>
  ): Promise<SkillInstallationSessionEntity | null> {
    const current = await this.findBySessionId(sessionId);
    if (!current || current.stateRevision !== expectedRevision) return null;
    const result = await this.repository.update(
      { sessionId, stateRevision: expectedRevision },
      { ...patch, stateRevision: expectedRevision + 1 }
    );
    if (!result.affected) return null;
    return this.findBySessionId(sessionId);
  }

  async savePlan(
    sessionId: string,
    planRevision: string,
    planJson: string
  ): Promise<SkillInstallationSessionEntity | null> {
    const current = await this.findBySessionId(sessionId);
    if (!current) return null;
    current.planRevision = planRevision;
    current.planJson = planJson;
    return this.repository.save(current);
  }
}

export class SkillInstallationEventModel extends BaseDb {
  public repository: Repository<SkillInstallationEventEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      SkillInstallationEventEntity
    );
  }

  async append(
    entity: SkillInstallationEventEntity
  ): Promise<SkillInstallationEventEntity> {
    return this.repository.save(entity);
  }

  async listBySession(
    sessionId: string
  ): Promise<SkillInstallationEventEntity[]> {
    return this.repository.find({
      where: { sessionId },
      order: { seq: "ASC" },
    });
  }

  async nextSeq(sessionId: string): Promise<number> {
    const last = await this.repository.findOne({
      where: { sessionId },
      order: { seq: "DESC" },
    });
    return (last?.seq ?? 0) + 1;
  }
}
