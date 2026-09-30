import "reflect-metadata";
import { Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { AIToolOutputScopeEntity } from "@/entity/AIToolOutputScope.entity";
import { AIToolOutputEntity } from "@/entity/AIToolOutput.entity";
import { AIToolOutputReservationEntity } from "@/entity/AIToolOutputReservation.entity";
import { AIToolOutputGrantEntity } from "@/entity/AIToolOutputGrant.entity";
import { AIToolOutputRetrievalBudgetEntity } from "@/entity/AIToolOutputRetrievalBudget.entity";
import { AIToolResultProjectionEntity } from "@/entity/AIToolResultProjection.entity";

/**
 * Data access for preserved tool outputs (technical design §5).
 *
 * PURE data access: row reads, conditional (fenced) writes, and quota sums.
 * No business rules, no file I/O, no service decisions live here — those
 * belong to `ToolResultModule` so a rule can never be bypassed by calling the
 * Model from a different place.
 *
 * Every method is a plain async entry point, so the `BaseDb` connection guard
 * wraps it and a Model constructed before the DataSource finishes
 * initializing still works.
 */

/** Identity that makes artifact storage idempotent (technical design §5.1). */
export interface ToolOutputIdentity {
  readonly profileId: string;
  readonly conversationId: string;
  readonly outputEpoch: string;
  readonly executionId: string;
  readonly streamKey: string;
}

/** Sum of captured bytes currently charged to a quota bucket. */
export interface QuotaUsage {
  readonly conversationBytes: number;
  readonly profileBytes: number;
}

export class ToolResultModel extends BaseDb {
  public outputs: Repository<AIToolOutputEntity>;
  public scopes: Repository<AIToolOutputScopeEntity>;
  public reservations: Repository<AIToolOutputReservationEntity>;
  public grants: Repository<AIToolOutputGrantEntity>;
  public retrievalBudgets: Repository<AIToolOutputRetrievalBudgetEntity>;
  public projections: Repository<AIToolResultProjectionEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    const connection = this.sqliteDb.connection;
    this.outputs = connection.getRepository(AIToolOutputEntity);
    this.scopes = connection.getRepository(AIToolOutputScopeEntity);
    this.reservations = connection.getRepository(AIToolOutputReservationEntity);
    this.grants = connection.getRepository(AIToolOutputGrantEntity);
    this.retrievalBudgets = connection.getRepository(
      AIToolOutputRetrievalBudgetEntity
    );
    this.projections = connection.getRepository(AIToolResultProjectionEntity);
  }

  // -------------------------------------------------------------- scopes --

  async findScope(
    profileId: string,
    conversationId: string
  ): Promise<AIToolOutputScopeEntity | null> {
    return await this.scopes.findOne({ where: { profileId, conversationId } });
  }

  async saveScope(scope: AIToolOutputScopeEntity): Promise<AIToolOutputScopeEntity> {
    return await this.scopes.save(scope);
  }

  // ------------------------------------------------------------- outputs --

  async findOutputById(outputId: string): Promise<AIToolOutputEntity | null> {
    return await this.outputs.findOne({ where: { outputId } });
  }

  /** Look up by the unique artifact identity (dedup / conflict check). */
  async findOutputByIdentity(
    identity: ToolOutputIdentity
  ): Promise<AIToolOutputEntity | null> {
    return await this.outputs.findOne({
      where: {
        profileId: identity.profileId,
        conversationId: identity.conversationId,
        outputEpoch: identity.outputEpoch,
        executionId: identity.executionId,
        streamKey: identity.streamKey,
      },
    });
  }

  async saveOutput(output: AIToolOutputEntity): Promise<AIToolOutputEntity> {
    return await this.outputs.save(output);
  }

  /**
   * Fenced state transition.
   *
   * The update only applies when the row is still in one of `expectedStates`,
   * which is what makes "reject a stale writer" enforceable in the database
   * rather than in a check-then-write race.
   */
  async transitionOutputState(input: {
    outputId: string;
    expectedStates: readonly string[];
    nextState: string;
    patch?: Partial<AIToolOutputEntity>;
  }): Promise<boolean> {
    // An explicit QueryBuilder is required here: `Repository.update` cannot
    // express "state is one of N", and silently matching the wrong set would
    // defeat the whole point of the fence. The SET map is accumulated and
    // applied once because a second `set()` REPLACES the first rather than
    // merging into it.
    const patch: Record<string, unknown> = { outputState: input.nextState };
    for (const [key, value] of Object.entries(input.patch ?? {})) {
      if (value === undefined) continue;
      patch[key] = value;
    }
    const result = await this.outputs
      .createQueryBuilder()
      .update(AIToolOutputEntity)
      .set(patch as never)
      .where("outputId = :outputId", { outputId: input.outputId })
      .andWhere("outputState IN (:...states)", { states: [...input.expectedStates] })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** Keyset page of non-terminal outputs, bounded by row count. */
  async listRecoverableOutputs(
    states: readonly string[],
    limit: number
  ): Promise<AIToolOutputEntity[]> {
    const query = this.outputs
      .createQueryBuilder("o")
      .where("o.outputState IN (:...states)", { states: [...states] })
      .orderBy("o.id", "ASC")
      .take(limit);
    return await query.getMany();
  }

  /** Committed artifacts for one scope, oldest first. */
  async listOutputsForScope(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    limit: number;
  }): Promise<AIToolOutputEntity[]> {
    const query = this.outputs
      .createQueryBuilder("o")
      .where("o.profileId = :profileId", { profileId: input.profileId })
      .andWhere("o.conversationId = :conversationId", {
        conversationId: input.conversationId,
      })
      .andWhere("o.outputEpoch = :outputEpoch", {
        outputEpoch: input.outputEpoch,
      })
      .andWhere("o.outputState IN (:...states)", {
        states: ["committed", "unavailable", "failed", "deleting"],
      })
      .orderBy("o.id", "ASC")
      .take(input.limit);
    return await query.getMany();
  }

  // ------------------------------------------------------------- quotas --

  /**
   * Bytes actually committed for a scope, plus bytes currently reserved.
   *
   * Reservations are included so concurrent in-flight captures are charged
   * BEFORE they write, which is what stops N parallel writers from each
   * individually passing a quota check and collectively overrunning it.
   */
  async quotaUsage(input: {
    profileId: string;
    conversationId: string;
  }): Promise<QuotaUsage> {
    const committedRaw = await this.outputs
      .createQueryBuilder("o")
      .select("COALESCE(SUM(o.capturedBytes), 0)", "sum")
      .where("o.profileId = :profileId", { profileId: input.profileId })
      .andWhere("o.conversationId = :conversationId", {
        conversationId: input.conversationId,
      })
      .andWhere("o.outputState IN (:...states)", {
        states: ["committed", "unavailable", "deleting"],
      })
      .getRawOne<{ sum: number }>();
    const reservedRaw = await this.reservations
      .createQueryBuilder("r")
      .select("COALESCE(SUM(r.reservedBytes - r.usedBytes), 0)", "sum")
      .where("r.profileId = :profileId", { profileId: input.profileId })
      .andWhere("r.conversationId = :conversationId", {
        conversationId: input.conversationId,
      })
      .andWhere("r.reservationState = :state", { state: "held" })
      .getRawOne<{ sum: number }>();

    const profileRaw = await this.outputs
      .createQueryBuilder("o")
      .select("COALESCE(SUM(o.capturedBytes), 0)", "sum")
      .where("o.profileId = :profileId", { profileId: input.profileId })
      .andWhere("o.outputState IN (:...states)", {
        states: ["committed", "unavailable", "deleting"],
      })
      .getRawOne<{ sum: number }>();

    const profileReservedRaw = await this.reservations
      .createQueryBuilder("r")
      .select("COALESCE(SUM(r.reservedBytes - r.usedBytes), 0)", "sum")
      .where("r.profileId = :profileId", { profileId: input.profileId })
      .andWhere("r.reservationState = :state", { state: "held" })
      .getRawOne<{ sum: number }>();

    return {
      conversationBytes: Number(committedRaw?.sum ?? 0) + Number(reservedRaw?.sum ?? 0),
      profileBytes: Number(profileRaw?.sum ?? 0) + Number(profileReservedRaw?.sum ?? 0),
    };
  }

  async saveReservation(
    reservation: AIToolOutputReservationEntity
  ): Promise<AIToolOutputReservationEntity> {
    return await this.reservations.save(reservation);
  }

  async findReservation(
    reservationId: string
  ): Promise<AIToolOutputReservationEntity | null> {
    return await this.reservations.findOne({ where: { reservationId } });
  }

  async findReservationByExecution(
    executionId: string
  ): Promise<AIToolOutputReservationEntity | null> {
    return await this.reservations.findOne({
      where: { executionId, reservationState: "held" },
    });
  }

  async releaseReservation(
    reservationId: string,
    usedBytes: number
  ): Promise<void> {
    await this.reservations.update(
      { reservationId },
      { reservationState: "released", usedBytes, reservedBytes: usedBytes }
    );
  }

  /** Reservations whose lease expired; the recovery sweep reclaims them. */
  async listExpiredReservations(
    now: Date,
    limit: number
  ): Promise<AIToolOutputReservationEntity[]> {
    const query = this.reservations
      .createQueryBuilder("r")
      .where("r.reservationState = :state", { state: "held" })
      .andWhere("r.leaseExpiresAt IS NOT NULL")
      .andWhere("r.leaseExpiresAt < :now", { now })
      .orderBy("r.id", "ASC")
      .take(limit);
    return await query.getMany();
  }

  // ------------------------------------------------------------- grants --

  async findGrant(input: {
    outputId: string;
    granteeConversationId: string;
    granteeAgentId?: string;
  }): Promise<AIToolOutputGrantEntity | null> {
    return await this.grants.findOne({
      where: {
        outputId: input.outputId,
        granteeConversationId: input.granteeConversationId,
        granteeAgentId: input.granteeAgentId ?? "",
      },
    });
  }

  async saveGrant(grant: AIToolOutputGrantEntity): Promise<AIToolOutputGrantEntity> {
    return await this.grants.save(grant);
  }

  async revokeGrantsForOutput(outputId: string): Promise<number> {
    const result = await this.grants.update(
      { outputId },
      { revokedAt: new Date() }
    );
    return result.affected ?? 0;
  }

  // ------------------------------------------------- retrieval budgeting --

  async findRetrievalBudget(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    agentId: string;
    turnId: string;
  }): Promise<AIToolOutputRetrievalBudgetEntity | null> {
    return await this.retrievalBudgets.findOne({
      where: {
        profileId: input.profileId,
        conversationId: input.conversationId,
        outputEpoch: input.outputEpoch,
        agentId: input.agentId,
        turnId: input.turnId,
      },
    });
  }

  async saveRetrievalBudget(
    budget: AIToolOutputRetrievalBudgetEntity
  ): Promise<AIToolOutputRetrievalBudgetEntity> {
    return await this.retrievalBudgets.save(budget);
  }

  /**
   * Conditional reserve. Applies only when the row is still at `expectedVersion`,
   * so two concurrent retrieval calls cannot both observe "one call left" and
   * both spend it.
   */
  async reserveRetrievalCalls(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    agentId: string;
    turnId: string;
    expectedVersion: number;
    additionalCalls: number;
  }): Promise<boolean> {
    const result = await this.retrievalBudgets.update(
      {
        profileId: input.profileId,
        conversationId: input.conversationId,
        outputEpoch: input.outputEpoch,
        agentId: input.agentId,
        turnId: input.turnId,
        version: input.expectedVersion,
      },
      {
        reservedCalls: () => `reservedCalls + ${Number(input.additionalCalls)}`,
        version: input.expectedVersion + 1,
      } as never
    );
    return (result.affected ?? 0) > 0;
  }

  async settleRetrievalWork(input: {
    profileId: string;
    conversationId: string;
    outputEpoch: string;
    agentId: string;
    turnId: string;
    calls: number;
    tokens: number;
  }): Promise<void> {
    await this.retrievalBudgets.update(
      {
        profileId: input.profileId,
        conversationId: input.conversationId,
        outputEpoch: input.outputEpoch,
        agentId: input.agentId,
        turnId: input.turnId,
      },
      {
        settledCalls: () => `settledCalls + ${Number(input.calls)}`,
        settledTokens: () => `settledTokens + ${Number(input.tokens)}`,
        version: () => `version + 1`,
      } as never
    );
  }

  // --------------------------------------------------------- projections --

  async findProjection(input: {
    profileId: string;
    sourceRowKey: string;
    outputEpoch: string;
    policyVersion: string;
  }): Promise<AIToolResultProjectionEntity | null> {
    return await this.projections.findOne({ where: { ...input } });
  }

  async saveProjection(
    projection: AIToolResultProjectionEntity
  ): Promise<AIToolResultProjectionEntity> {
    return await this.projections.save(projection);
  }
}
