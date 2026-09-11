/**
 * PromptSkillInvocationModule — durable conversation invocation state
 * (design §10.10, §14.2). Business rules over PromptSkillInvocationModel.
 *
 * Persistence happens BEFORE the next model completion (§21.3). Same-hash
 * invocation is idempotent (`already-loaded`); a verified new hash creates a
 * new context revision and emits a change signal. Conversation deletion
 * clears state through this module (§17.3).
 */

import { BaseModule } from "@/modules/baseModule";
import {
  PromptSkillInvocationModel,
  type PromptSkillInvocationSaveInput,
} from "@/model/PromptSkillInvocation.model";
import { PromptSkillInvocationEntity } from "@/entity/PromptSkillInvocation.entity";

export interface ActiveInvocationView {
  readonly runtimeId: string;
  readonly contentHash: string;
  readonly contextRevision: number;
  readonly normalizedInstructions: string;
  readonly tokenEstimate: number;
  readonly invokedAt: string;
  readonly invocationSource: string;
}

export class PromptSkillInvocationModule extends BaseModule {
  private model: PromptSkillInvocationModel | null = null;

  private async getModel(): Promise<PromptSkillInvocationModel> {
    await this.ensureConnection();
    if (!this.model) {
      this.model = new PromptSkillInvocationModel(this.dbpath);
    }
    return this.model;
  }

  /**
   * Persist one invocation. Returns `alreadyActive: true` when the same
   * runtime id + content hash is already active (idempotent re-invocation —
   * no duplicate hidden instruction block, NFR/DoD).
   */
  async recordInvocation(
    input: Omit<PromptSkillInvocationSaveInput, "contextRevision">
  ): Promise<{ entity: PromptSkillInvocationEntity; alreadyActive: boolean }> {
    const model = await this.getModel();
    const existing = await model.findByIdentity(
      input.conversationId,
      input.agentScope,
      input.runtimeId,
      input.contentHash
    );
    if (existing && existing.active) {
      return { entity: existing, alreadyActive: true };
    }

    // Revision = number of distinct hashes ever activated for this runtime
    // in this scope (existing superseded rows + 1).
    const revision = await this.nextRevision(
      model,
      input.conversationId,
      input.agentScope,
      input.runtimeId
    );
    const entity = await model.saveInvocation({
      ...input,
      contextRevision: revision,
    });
    return { entity, alreadyActive: false };
  }

  /** Deterministic-order active invocations for context reattachment. */
  async listActive(
    conversationId: string,
    agentScope = ""
  ): Promise<ActiveInvocationView[]> {
    const model = await this.getModel();
    const rows = await model.findActive(conversationId, agentScope);
    return rows.map((row) => ({
      runtimeId: row.runtimeId,
      contentHash: row.contentHash,
      contextRevision: row.contextRevision,
      normalizedInstructions: row.normalizedInstructions,
      tokenEstimate: row.tokenEstimate,
      invokedAt: row.invokedAt.toISOString(),
      invocationSource: row.invocationSource,
    }));
  }

  /**
   * FR-23 / §14.6 compaction-recovery reconciliation: validate every ACTIVE
   * invocation against the CURRENT installation/catalog state. Still-valid
   * skills reattach their immutable verified snapshot; invocations whose
   * skill is uninstalled, disabled, or hash-changed (linked source edited)
   * are DEACTIVATED and produce a bounded structured diagnostic — never
   * silently restored, never silently dropped.
   */
  async reconcileForRecovery(
    conversationId: string,
    agentScope = ""
  ): Promise<{
    readonly reattach: ActiveInvocationView[];
    readonly diagnostics: readonly {
      readonly runtimeId: string;
      readonly code:
        | "SKILL_UNINSTALLED"
        | "SKILL_DISABLED"
        | "SKILL_HASH_CHANGED";
      readonly message: string;
    }[];
  }> {
    const active = await this.listActive(conversationId, agentScope);
    const { getDefaultPromptSkillCatalog } = await import(
      "@/service/PromptSkillCatalog"
    );
    const catalog = getDefaultPromptSkillCatalog();
    const reattach: ActiveInvocationView[] = [];
    const diagnostics: {
      runtimeId: string;
      code: "SKILL_UNINSTALLED" | "SKILL_DISABLED" | "SKILL_HASH_CHANGED";
      message: string;
    }[] = [];
    for (const invocation of active) {
      const definition = catalog.get(invocation.runtimeId);
      if (!definition) {
        diagnostics.push({
          runtimeId: invocation.runtimeId,
          code: "SKILL_UNINSTALLED",
          message:
            `A skill invoked in this conversation was uninstalled; its ` +
            `instructions are no longer active. Reinstall it and invoke it ` +
            `again if you still need it.`,
        });
      } else if (!definition.enabled) {
        diagnostics.push({
          runtimeId: invocation.runtimeId,
          code: "SKILL_DISABLED",
          message:
            `Skill '${definition.name}' was disabled; its instructions are ` +
            `no longer active in this conversation.`,
        });
      } else if (definition.contentHash !== invocation.contentHash) {
        diagnostics.push({
          runtimeId: invocation.runtimeId,
          code: "SKILL_HASH_CHANGED",
          message:
            `Skill '${definition.name}' changed since it was invoked ` +
            `(linked installs can change externally). The previous ` +
            `instructions were deactivated — invoke the skill again to ` +
            `review the new content before it takes effect.`,
        });
      } else {
        reattach.push(invocation);
        continue;
      }
      // Deactivate the invalid invocation so recovery is not repeated.
      await this.deactivateRuntime(
        conversationId,
        invocation.runtimeId,
        agentScope
      );
    }
    return { reattach, diagnostics };
  }

  /** Conversation deletion clears invocation state through this module. */
  async deleteByConversation(conversationId: string): Promise<number> {
    const model = await this.getModel();
    return model.deleteByConversation(conversationId);
  }

  /** Skill disable/uninstall marks matching active invocations inactive. */
  async deactivateRuntime(
    conversationId: string,
    runtimeId: string,
    agentScope = ""
  ): Promise<number> {
    const model = await this.getModel();
    return model.deactivate(conversationId, agentScope, runtimeId);
  }

  /**
   * FR-19: deactivate a runtime's durable invocations across ALL
   * conversations (skill disable/uninstall). Returns affected row and
   * conversation counts for structured diagnostics.
   */
  async deactivateByRuntimeId(
    runtimeId: string
  ): Promise<{ affectedRows: number; conversationIds: readonly string[] }> {
    const model = await this.getModel();
    return model.deactivateByRuntimeId(runtimeId);
  }

  private async nextRevision(
    model: PromptSkillInvocationModel,
    conversationId: string,
    agentScope: string,
    runtimeId: string
  ): Promise<number> {
    // Any prior record (active or superseded) for this runtime id counts
    // toward the revision sequence.
    const rows = await model.repository.find({
      where: { conversationId, agentScope, runtimeId },
    });
    return rows.length + 1;
  }
}
