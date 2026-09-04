import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import {
  outboundEmailIntentWriteSchema,
  outboundEmailIntentDecisionPatchSchema,
} from "@/schemas/entity/outboundEmailIntent";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

/**
 * Decision fields overwritten when a cached intent is re-resolved (its stored
 * sourceTextHash or resolverVersion no longer matches the current turn). The
 * identity columns (conversationId, sourceUserMessageId) are immutable — the
 * unique index keeps the decision idempotent per user message.
 */
export interface OutboundEmailIntentDecisionPatch {
  mode: OutboundEmailIntentEntity["mode"];
  reasonCode: OutboundEmailIntentEntity["reasonCode"];
  confidence: number;
  evidenceJson: string;
  sourceTextHash: string;
  resolverVersion: string;
}

export class OutboundEmailIntentModel extends BaseDb {
  private repository: Repository<OutboundEmailIntentEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("OutboundEmailIntentModel");
    this.repository = this.sqliteDb.connection.getRepository(
      OutboundEmailIntentEntity
    );
  }

  async create(
    entity: OutboundEmailIntentEntity
  ): Promise<OutboundEmailIntentEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailIntentWriteSchema()
    ) as unknown as OutboundEmailIntentEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<OutboundEmailIntentEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Load the persisted decision for a user message. The unique index on
   * (conversationId, sourceUserMessageId) guarantees at most one row, so a
   * stream retry / restart reuses the existing decision instead of re-deciding.
   */
  async findBySource(
    conversationId: string,
    sourceUserMessageId: string
  ): Promise<OutboundEmailIntentEntity | null> {
    return await this.repository.findOne({
      where: { conversationId, sourceUserMessageId },
    });
  }

  /**
   * Overwrite the decision fields of an existing intent row (§9 re-check).
   * Used when a cached decision's sourceTextHash or resolverVersion no longer
   * matches the current turn: the re-resolved decision replaces the stale one
   * in place so the unique (conversationId, sourceUserMessageId) row keeps
   * reflecting the decision that downstream authorization actually uses.
   */
  async updateDecision(
    id: number,
    patch: OutboundEmailIntentDecisionPatch
  ): Promise<void> {
    const stripped = parseAndStrip(
      { ...patch },
      outboundEmailIntentDecisionPatchSchema()
    ) as unknown as OutboundEmailIntentDecisionPatch;
    await this.repository.update(id, stripped);
  }
}
