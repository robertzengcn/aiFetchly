import { BaseDb } from "@/model/Basedb";
import { SkillInstallationEntity } from "@/entity/SkillInstallation.entity";
import { SkillInstallationSessionEntity } from "@/entity/SkillInstallationSession.entity";
import { SkillInstallationEventEntity } from "@/entity/SkillInstallationEvent.entity";
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

  /**
   * Healthy ready installations for a source (PRD §10.2: a duplicate prepare
   * reports the verified ready installation instead of re-acquiring).
   */
  async findReadyBySourceUri(
    sourceUri: string
  ): Promise<SkillInstallationEntity[]> {
    return this.repository.find({
      where: { sourceUri, status: "ready", enabled: true },
      order: { updatedAt: "DESC" },
    });
  }

  async save(
    entity: SkillInstallationEntity
  ): Promise<SkillInstallationEntity> {
    return this.repository.save(entity);
  }

  async setStatus(installationId: string, status: string): Promise<void> {
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

  /**
   * Most recent session (any state) for a canonical source — a new session
   * inherits its same-cause failure streak so the FR-20 three-failure stop
   * rule spans retries across session rows. Ordered by the monotonic row id:
   * updatedAt has second precision and retries within the same second would
   * make "latest" ambiguous.
   */
  async findLatestByCanonicalUri(
    canonicalUri: string
  ): Promise<SkillInstallationSessionEntity | null> {
    return this.repository.findOne({
      where: { canonicalUri },
      order: { id: "DESC" },
    });
  }

  /**
   * FR-30: the most recent NON-TERMINAL session bound to a conversation —
   * the persisted routing decision the tool boundary enforces across
   * follow-up turns and restarts (latest by monotonic id).
   */
  async findActiveByConversation(
    conversationId: string
  ): Promise<SkillInstallationSessionEntity | null> {
    const rows = await this.repository
      .createQueryBuilder("s")
      .where("s.conversationId = :cid", { cid: conversationId })
      .andWhere("s.state NOT IN (:...terminal)", {
        terminal: ["ready", "failed", "cancelled", "rollback_required"],
      })
      .orderBy("s.id", "DESC")
      .getMany();
    return rows[0] ?? null;
  }

  async findActiveByCanonicalUri(
    canonicalUri: string
  ): Promise<SkillInstallationSessionEntity[]> {
    // Active = not terminal. The canonicalUri column (persisted AT CREATION,
    // FR-02/NFR-01) makes this an indexed exact match — an acquiring session
    // with no plan JSON is still found.
    return this.repository
      .createQueryBuilder("s")
      .where("s.state NOT IN (:...terminal)", {
        terminal: ["ready", "failed", "cancelled", "rollback_required"],
      })
      .andWhere("s.canonicalUri = :uri", { uri: canonicalUri })
      .getMany();
  }

  /**
   * Transactional active-session claim (FR-02/NFR-01): inside ONE SQLite
   * transaction, (1) fail active sessions whose mutation lease has expired
   * (stale owner — crashed mid-mutation), then (2) return the remaining
   * live active session, or insert the new entity when none exists. Two
   * concurrent prepares for the same source therefore yield exactly one
   * active session and one acquisition pipeline.
   */
  async claimOrCreateSession(
    entity: SkillInstallationSessionEntity,
    options: { readonly nowMs: number }
  ): Promise<{
    readonly created: boolean;
    readonly session: SkillInstallationSessionEntity;
    readonly staleTakenOver: readonly string[];
  }> {
    return this.repository.manager.transaction(async (em) => {
      const repo = em.getRepository(SkillInstallationSessionEntity);
      const staleTakenOver: string[] = [];
      const active = await repo
        .createQueryBuilder("s")
        .where("s.state NOT IN (:...terminal)", {
          terminal: ["ready", "failed", "cancelled", "rollback_required"],
        })
        .andWhere("s.canonicalUri = :uri", { uri: entity.canonicalUri })
        .getMany();
      const live = active.filter((s) => {
        const expires = s.leaseExpiresAt ? Number(s.leaseExpiresAt) : null;
        const stale = expires !== null && expires < options.nowMs;
        if (stale) staleTakenOver.push(s.sessionId);
        return !stale;
      });
      for (const stale of active) {
        if (!live.includes(stale)) {
          stale.state = "failed";
          stale.failureCode = "LEASE_STALE";
          stale.failureDetail =
            "The previous installation attempt stopped responding; its mutation lease expired and a new attempt took over.";
          await repo.save(stale);
        }
      }
      if (live.length > 0) {
        return { created: false, session: live[0], staleTakenOver };
      }
      return {
        created: true,
        session: await repo.save(entity),
        staleTakenOver,
      };
    });
  }

  /**
   * Extend the mutation lease (heartbeat): long acquisitions and activations
   * call this so another prepare cannot take the session over mid-work.
   */
  async heartbeatLease(
    sessionId: string,
    extendMs: number,
    nowMs: number
  ): Promise<void> {
    await this.repository.update(
      { sessionId },
      { leaseExpiresAt: String(nowMs + extendMs) }
    );
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
